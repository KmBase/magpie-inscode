/**
 * magpie-inscode — CSDN InsCode free quota as a Magpie provider.
 *
 * **Login**: browser OAuth at `https://taotoken.net/oauth?sid=<uuid>`. The user
 * authorizes there; that page binds the session itself and then deep-links to
 * the InsCode app, so the plugin cannot read the browser. Instead the plugin
 * polls the app-side endpoint
 * `POST https://api.taotoken.net/v1/codex/session/<sid>/complete?deviceId=…`
 * (no auth, `X-Tt-Device-Id` header) until `data.status === "SUCCESS"`, then
 * takes `data.apiKey` plus `username`, `nickname` and the `codingPlan` (models +
 * usage buckets). Requests then go to the gateway `https://taotoken.net/api/v1`:
 * `Authorization: Bearer <api_key>`, with chat POSTs additionally signed via the
 * account's `X-Tt` client signature (`sign.mjs`; `GET /models` is pure Bearer).
 *
 * A "本机凭据" fallback method reads the InsCode client's local files for
 * machines where it has already signed in.
 *
 * Magpie-specific hooks (ignored by OpenCode): `auth.usage` (from the
 * `codingPlan.buckets`, re-polled from the idempotent session-complete
 * endpoint when the stored `sid` allows it, falling back to the login
 * snapshot and then the local InsCode credentials) and `auth.checkin`
 * (daily top-up, opt-in via `INCODE2API_CHECKIN_URL`).
 *
 * @module magpie-inscode
 */

import { PROVIDER, ICON, DEFAULT_API_BASE, readAuth, credentialsOf, accountKey, fellBack } from "./internal.mjs";
import {
  DEFAULT_OAUTH_URL, DEFAULT_BIND_BASE, DEFAULT_BIND_PATH,
  newSid, newDeviceId, buildAuthorizeUrl, pollSession, fetchSession,
} from "./oauth.mjs";
import { loadFreeAccount, accountName } from "./creds.mjs";
import { usageFromCreds, usageFromBind } from "./quota.mjs";
import { createCheckin } from "./checkin.mjs";
import { buildSignHeaders } from "./sign.mjs";
import { NPM, seedModels, normalizeRow, toProviderModel, createCatalog, DEFAULT_OUTPUT } from "./models.mjs";
import { strings, resolveLocale, fill } from "./i18n.mjs";

/**
 * Plugin entry. OpenCode calls every function exported by this module, so all
 * real logic lives in the imported helpers and returned hooks.
 */
export async function InsCodeAuthPlugin({ client } = {}, options = {}) {
  const t = strings(resolveLocale(options.locale));

  const opts = {
    // Model gateway (console API-key style, pure Bearer).
    apiBase: typeof options.apiBase === "string" && options.apiBase
      ? options.apiBase.replace(/\/+$/, "")
      : DEFAULT_API_BASE,
    oauthUrl: typeof options.oauthUrl === "string" && options.oauthUrl ? options.oauthUrl : DEFAULT_OAUTH_URL,
    bindBase: typeof options.bindBase === "string" && options.bindBase ? options.bindBase.replace(/\/+$/, "") : DEFAULT_BIND_BASE,
    bindPath: typeof options.bindPath === "string" && options.bindPath ? options.bindPath : DEFAULT_BIND_PATH,
    deviceId: typeof options.deviceId === "string" && options.deviceId ? options.deviceId : "",
    pollMethod: typeof options.pollMethod === "string" && options.pollMethod ? options.pollMethod : "POST",
    pollIntervalMs: Number(options.pollIntervalMs) > 0 ? Number(options.pollIntervalMs) : 1500,
    loginTimeoutMs: Number(options.loginTimeoutMs) > 0 ? Number(options.loginTimeoutMs) : 120_000,
    modelsTtlMs: Number(options.modelsTtlMs) > 0 ? Number(options.modelsTtlMs) : 10 * 60_000,
    quotaTtlMs: Number(options.quotaTtlMs) > 0 ? Number(options.quotaTtlMs) : 60_000,
    maxOutputTokens: Number(options.maxOutputTokens) > 0 ? Number(options.maxOutputTokens) : DEFAULT_OUTPUT,
    // Test hook: lets unit tests stub the session-complete refresh.
    fetchImpl: typeof options.fetchImpl === "function" ? options.fetchImpl : undefined,
  };

  const log = (level, message) => {
    try {
      client?.app?.log?.({ body: { service: PROVIDER, level, message } });
    } catch {
      /* the host's logger is best-effort */
    }
  };

  const catalog = createCatalog({ apiBase: opts.apiBase, ttlMs: opts.modelsTtlMs, output: opts.maxOutputTokens });

  /** Declared (config-hook) models, the fallback when no live list is available. */
  const declared = () => seedModels();

  /** How the provider row names this account. */
  const userLabel = (auth) => {
    if (!auth || typeof auth !== "object") return undefined;
    return auth.accountId || auth.metadata?.username || auth.metadata?.email || auth.email;
  };

  /** Cache quota per account so a polled usage hook stays cheap. */
  const quotaCache = new Map();

  /** Keep the bind/plan name when the local free-quota snapshot lacks one. */
  const withPlan = (free, plan) => {
    const f = free && typeof free === "object" ? { ...free } : {};
    if (!f.plan_name && !f.plan && plan) f.plan_name = plan;
    return f;
  };

  /**
   * Re-poll the idempotent session-complete endpoint for a fresh
   * `codingPlan` — the login snapshot goes stale (a 5-hour bucket may only
   * appear once the window has usage). Returns null when there is no sid to
   * refresh with, or when the refresh fails; the caller then keeps the
   * snapshot. Throttled by the `quotaTtlMs` cache around the `usage` hook.
   */
  const refreshBind = async (meta) => {
    if (!meta.sid) return null;
    try {
      return await fetchSession(meta.sid, {
        bindBase: opts.bindBase,
        bindPath: opts.bindPath,
        deviceId: meta.deviceId,
        method: opts.pollMethod,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      });
    } catch (error) {
      log("warn", `${PROVIDER}: usage refresh: ${error.message}`);
      return null;
    }
  };

  /** The bearer key one account needs, out of its auth record. */
  const keyOf = (auth) => {
    const c = credentialsOf(auth);
    return c?.key;
  };

  return {
    /** Declare the provider and its fallback models. */
    config: async (cfg) => {
      cfg.provider ??= {};
      const was = cfg.provider[PROVIDER] ?? {};
      cfg.provider[PROVIDER] = {
        name: "InsCode",
        npm: NPM,
        api: opts.apiBase,
        ...was,
        models: { ...declared(), ...(was.models ?? {}) },
      };
    },

    provider: {
      id: PROVIDER,
      /**
       * The models this account can actually use. When the OAuth bind response
       * listed `codingPlan.supportModels`, that is authoritative; otherwise it
       * is fetched from `GET /v1/models` (pure Bearer). Falling back keeps the
       * declared list marked `fellBack`, so the provider never vanishes.
       */
      async models(provider, { auth } = {}) {
        const declaredModels = provider?.models ?? declared();
        const meta = auth?.metadata && typeof auth.metadata === "object" ? auth.metadata : {};

        if (Array.isArray(meta.models) && meta.models.length) {
          const list = meta.models.map((id) => normalizeRow({ id, name: id })).filter(Boolean);
          return Object.fromEntries(list.map((m) => [m.key, toProviderModel(m, PROVIDER, { baseURL: opts.apiBase, npm: NPM })]));
        }

        const key = keyOf(auth);
        if (!key) return fellBack(declaredModels);
        try {
          const list = await catalog.load({ key, accountId: auth?.accountId, configDir: meta.configDir });
          if (!list.length) {
            log("warn", `${PROVIDER}: ${t.modelListEmpty}`);
            return fellBack(declaredModels);
          }
          return Object.fromEntries(list.map((m) => [m.key, toProviderModel(m, PROVIDER, { baseURL: opts.apiBase, npm: NPM })]));
        } catch (error) {
          if (error.signIn === "expired") {
            const expired = new Error(t.reloginRequired);
            expired.signIn = "expired";
            throw expired;
          }
          log("warn", `${PROVIDER}: ${t.modelsUnavailable}: ${error.message}`);
          return fellBack(declaredModels);
        }
      },
    },

    auth: {
      provider: PROVIDER,
      ...(ICON === undefined ? {} : { icon: ICON }),

      methods: [
        // --- Primary: browser OAuth keyed by sid, then poll the complete endpoint.
        {
          type: "oauth",
          label: t.methodLabel,
          async authorize() {
            const sid = newSid();
            // Reuse the desktop app's device id when it is on disk, else mint one.
            const deviceId = opts.deviceId || loadFreeAccount().deviceId || newDeviceId();
            const url = buildAuthorizeUrl({ oauthUrl: opts.oauthUrl, sid });
            return {
              url,
              instructions: fill(t.loginInstructions, { url }),
              method: "auto",
              async callback() {
                try {
                  const m = await pollSession(sid, {
                    bindBase: opts.bindBase,
                    bindPath: opts.bindPath,
                    deviceId,
                    method: opts.pollMethod,
                    intervalMs: opts.pollIntervalMs,
                    timeoutMs: opts.loginTimeoutMs,
                  });
                  const meta = {
                    apiBase: opts.apiBase,
                    // Kept so `auth.usage` can re-poll the (idempotent)
                    // complete endpoint and refresh the quota buckets.
                    ...(m.sid ? { sid: m.sid } : {}),
                    username: m.username,
                    ...(m.nickname ? { nickname: m.nickname } : {}),
                    ...(m.avatar ? { avatar: m.avatar } : {}),
                    plan: m.plan,
                    planTier: m.planTier,
                    models: m.models,
                    buckets: m.buckets,
                    periodStart: m.periodStart,
                    periodEnd: m.periodEnd,
                    deviceId,
                    ...(m.signKey ? { signKey: m.signKey } : {}),
                  };
                  return {
                    type: "success",
                    key: m.apiKey,
                    ...(m.username ? { accountId: m.username } : {}),
                    ...(m.nickname ? { name: m.nickname } : {}),
                    metadata: meta,
                  };
                } catch (error) {
                  const code = String(error?.code || "").toUpperCase();
                  const message = /EXPIRED|BOUND|CONSUMED/.test(code)
                    ? t.sessionExpired
                    : /UNAUTHORIZED|INVALID/.test(code)
                      ? t.bindUnauthorized
                      : error && error.message
                        ? error.message
                        : t.bindFailed;
                  return { type: "failed", error: message };
                }
              },
            };
          },
        },

        // --- Fallback: reuse the local InsCode client credentials on disk.
        {
          type: "api",
          label: t.methodLabelLocal,
          prompts: [
            {
              type: "text",
              key: "configDir",
              message: t.configDirPrompt,
              placeholder: t.configDirPlaceholder,
            },
          ],
          async authorize(inputs) {
            const dir = inputs?.configDir?.trim() || undefined;
            const c = loadFreeAccount(dir);
            if (!c.key) return { type: "failed", error: fill(t.missingKey, { dir: c.configDir }) };
            return {
              type: "success",
              key: c.key,
              ...(accountName(c.account) ? { accountId: accountName(c.account) } : {}),
              ...(c.account?.email ? { email: c.account.email } : {}),
              metadata: { configDir: c.configDir, free: c.free, ...(c.deviceId ? { deviceId: c.deviceId } : {}) },
            };
          },
        },
      ],

      /**
       * Per-account request loader: baseURL + a Bearer fetch that signs chat
       * POSTs with the account's `X-Tt` client signature (GETs are pure
       * Bearer — the gateway only checks the signature on POSTs).
       */
      async loader(getAuth) {
        const c = credentialsOf(await readAuth(getAuth));
        if (!c?.key) return {};
        const key = c.key;
        // Local-credential accounts re-read the (rotatable) sign key from disk
        // per request, so a fresh `taotoken.json` is picked up without re-login.
        let { keyId, signKeyB64, deviceId } = c;
        if ((!keyId || !signKeyB64) && c.configDir) {
          const local = loadFreeAccount(c.configDir);
          keyId = keyId || local.keyId;
          signKeyB64 = signKeyB64 || local.signKeyB64;
          deviceId = deviceId || local.deviceId;
        }
        return {
          baseURL: opts.apiBase,
          async fetch(input, init) {
            const headers = new Headers(init?.headers);
            headers.set("authorization", `Bearer ${key}`);
            headers.set("content-type", "application/json");
            headers.set("user-agent", "magpie-inscode/0.1");
            const method = String(init?.method ?? input?.method ?? "GET").toUpperCase();
            if (method === "POST") {
              const url = new URL(
                typeof input === "string" || input instanceof URL ? input : input?.url ?? "",
                opts.apiBase,
              );
              for (const [name, value] of Object.entries(buildSignHeaders({
                keyId,
                signKeyB64,
                deviceId,
                method,
                path: url.pathname,
                body: init?.body,
              }))) {
                headers.set(name, value);
              }
            }
            return fetch(input, { ...init, headers });
          },
        };
      },

      /** Free-quota windows: bind buckets refreshed via the complete endpoint, else the local creds; cached. */
      async usage(getAuth) {
        const raw = await readAuth(getAuth);
        const user = userLabel(raw);
        const c = credentialsOf(raw);
        const cacheKey = accountKey(c);
        const meta = raw?.metadata && typeof raw.metadata === "object" ? raw.metadata : {};

        if (!c?.key) {
          const value = { plan: t.planFallback, error: t.noAccount, windows: [] };
          quotaCache.set(cacheKey, { at: Date.now() - opts.quotaTtlMs + 15_000, value });
          return value;
        }

        const hit = quotaCache.get(cacheKey);
        if (hit && Date.now() - hit.at < opts.quotaTtlMs) return hit.value;
        try {
          const fresh = await refreshBind(meta);
          const m = fresh
            ? {
                ...meta,
                plan: fresh.plan || meta.plan,
                ...(Array.isArray(fresh.buckets) && fresh.buckets.length ? { buckets: fresh.buckets } : {}),
                ...(fresh.periodEnd ? { periodEnd: fresh.periodEnd } : {}),
                ...(fresh.username ? { username: fresh.username } : {}),
              }
            : meta;
          let value;
          if (Array.isArray(m.buckets) && m.buckets.length) {
            value = usageFromBind(m, { t, user: user || m.username || meta.username });
          } else if (meta.free && typeof meta.free === "object") {
            value = usageFromCreds({ free: withPlan(meta.free, meta.plan) }, { t, user: user || meta.username || meta.email });
          } else {
            // OAuth logins keep no `free` snapshot: fall back to the InsCode
            // client's local taotoken.json (explicit dir for local logins,
            // the default dir otherwise) so its 5-hour window still shows.
            const local = loadFreeAccount(meta.configDir);
            value = usageFromCreds({ free: withPlan(local.free, meta.plan) }, { t, user: user || meta.username || meta.email });
          }
          quotaCache.set(cacheKey, { at: Date.now(), value });
          return value;
        } catch (error) {
          const value = { plan: t.planFallback, ...(user ? { user } : {}), error: fill(t.usageFailed, { detail: error.message }), windows: [] };
          quotaCache.set(cacheKey, { at: Date.now() - opts.quotaTtlMs + 15_000, value });
          log("warn", `${PROVIDER}: usage: ${error.message}`);
          return value;
        }
      },

      /** Daily check-in (opt-in via INCODE2API_CHECKIN_URL). */
      checkin: createCheckin(t),
    },
  };
}

// Community convention: expose internals for unit tests without letting
// OpenCode treat them as plugins — tests import this object, not the entry's
// other functions. (Not read by Magpie; kept explicit for `bun test`.)
export const _internal = Object.freeze({
  PROVIDER,
  DEFAULT_API_BASE,
  ICON,
  credentialsOf,
  readAuth,
  accountKey,
  fellBack,
  newSid,
  newDeviceId,
  buildAuthorizeUrl,
  pollSession,
  fetchSession,
  mapBindPayload: null, // placeholder kept out of the tight API; use oauth directly
  usageFromCreds,
  usageFromBind,
  seedModels,
  toProviderModel,
  createCatalog,
  loadFreeAccount,
  accountName,
});