/**
 * InsCode / taotoken OAuth login helpers.
 *
 * The flow is a **browser OAuth with sid keyed session binding**:
 *
 *   1. the plugin generates a random `sid`, points the user's browser at
 *      `${oauthUrl}?sid=<sid>` (e.g. `https://taotoken.net/oauth?sid=…`);
 *   2. the user signs in on the taotoken page; that page itself POSTs
 *      `https://taotoken.net/api/v1/codex/session/<sid>/bind` **with the user's
 *      console session** and then shows taotoken's own `/oauth/success` page
 *      (which deep-links into `inscode://`, so a plugin cannot read the browser);
 *   3. the plugin polls the *app-side* endpoint
 *      `POST https://api.taotoken.net/v1/codex/session/<sid>/complete?deviceId=…`
 *      with an `X-Tt-Device-Id` header. It is **unauthenticated** and answers
 *      `data.status: "WAITING"` until the browser has bound the session, then
 *      `"SUCCESS"` with the credentials (`apiKey`, `username`, `nickname`,
 *      `codingPlan`, `signKey`). Claiming is idempotent, so the InsCode desktop
 *      app may claim the same session without starving the plugin.
 *
 * Model requests then go to the gateway (`https://taotoken.net/api/v1`) with
 * `Authorization: Bearer <api_key>`; chat POSTs additionally carry the `X-Tt`
 * client signature (see `sign.mjs`), `GET /models` is pure Bearer.
 *
 * @module magpie-inscode/oauth
 */

import { randomUUID } from "node:crypto";

/** The InsCode browser sign-in page. */
export const DEFAULT_OAUTH_URL = "https://taotoken.net/oauth";

/** Where the app-side session endpoint lives (the codex API host, not the console). */
export const DEFAULT_BIND_BASE = "https://api.taotoken.net";

/** Session-complete endpoint, with `{sid}` to fill in. */
export const DEFAULT_BIND_PATH = "/v1/codex/session/{sid}/complete";

/** A random v4 sid — what `oauth?sid=` the browser opens must match. */
export function newSid() {
  return randomUUID();
}

/**
 * A random v4 device id.
 *
 * The `complete` endpoint accepts any id; reusing the desktop app's `device_id`
 * (from `~/.config/inscode/device.json`) keeps magpie and the app on one device,
 * but generating one works just as well.
 */
export function newDeviceId() {
  return randomUUID();
}

/**
 * Build the browser authorize URL.
 *
 * @param {{oauthUrl?: string, sid: string}} opts
 */
export function buildAuthorizeUrl({ oauthUrl = DEFAULT_OAUTH_URL, sid } = {}) {
  const u = new URL(oauthUrl);
  u.searchParams.set("sid", sid);
  return u.toString();
}

/**
 * The full session-complete URL for one sid.
 *
 * @param {{bindBase?: string, bindPath?: string, sid: string, deviceId?: string}} opts
 */
export function buildBindUrl({ bindBase = DEFAULT_BIND_BASE, bindPath = DEFAULT_BIND_PATH, sid, deviceId } = {}) {
  const u = new URL(`${bindBase}${bindPath.replace("{sid}", encodeURIComponent(sid))}`);
  if (deviceId) u.searchParams.set("deviceId", deviceId);
  return u.toString();
}

/**
 * Normalize a session-complete response into what the plugin stores.
 *
 * Accepts either the full `{ code, msg, data }` envelope or `data` directly.
 * `data.codingPlan` / `data.signKey` are optional; only `apiKey` is required.
 *
 * @param {object} payload
 * @returns {{sid: string, username: string, nickname: string, avatar: string, status: string,
 *            apiKey: string, plan: string, planTier: string, models: string[], buckets: object[],
 *            periodStart?: string, periodEnd?: string, signKey?: object}|null}
 *          null when no apiKey.
 */
export function mapBindPayload(payload = {}) {
  if (!payload || typeof payload !== "object") return null;
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const apiKey = typeof data.apiKey === "string" ? data.apiKey.trim() : "";
  if (!apiKey) return null;
  const cp = data.codingPlan && typeof data.codingPlan === "object" ? data.codingPlan : {};
  const sk = data.signKey && typeof data.signKey === "object" ? data.signKey : undefined;
  return {
    sid: typeof data.sid === "string" ? data.sid : "",
    username: typeof data.username === "string" ? data.username : "",
    nickname: typeof data.nickname === "string" ? data.nickname : "",
    avatar: typeof data.avatar === "string" ? data.avatar : "",
    status: typeof data.status === "string" ? data.status : "",
    apiKey,
    plan: cp.goodsName || cp.showPlanTier || cp.planType || "",
    planTier: typeof cp.planTier === "string" ? cp.planTier : "",
    models: Array.isArray(cp.supportModels) ? cp.supportModels.filter((m) => typeof m === "string") : [],
    buckets: Array.isArray(cp.buckets) ? cp.buckets : [],
    ...(typeof cp.periodStart === "string" ? { periodStart: cp.periodStart } : {}),
    ...(typeof cp.periodEnd === "string" ? { periodEnd: cp.periodEnd } : {}),
    ...(sk && (sk.keyId || sk.signKey)
      ? {
          signKey: {
            ...(typeof sk.keyId === "string" ? { keyId: sk.keyId } : {}),
            ...(typeof sk.signKey === "string" ? { signKey: sk.signKey } : {}),
            ...(typeof sk.expireAt === "string" ? { expireAt: sk.expireAt } : {}),
          },
        }
      : {}),
  };
}

/** Statuses that end the wait as a failure instead of continuing to poll. */
const TERMINAL_FAIL_RE = /FAIL|ERROR|EXPIRED|REJECTED?|DENIED|CONSUMED|UNAUTHORIZED|INVALID|BOUND/i;

/**
 * Poll the session-complete endpoint until the session reports `SUCCESS`.
 *
 * A non-`SUCCESS` status of `WAITING` (the normal case until the user authorizes)
 * keeps polling; `EXPIRED` / `CONSUMED` / `INVALID` abort with `error.code` set
 * to the status so callers can localize the message.
 *
 * @param {string} sid
 * @param {{bindBase?: string, bindPath?: string, deviceId?: string, intervalMs?: number,
 *          timeoutMs?: number, method?: string, fetchImpl?: Function, onStatus?: Function}} opts
 * @returns {Promise<ReturnType<typeof mapBindPayload>>}
 * @throws on a terminal failure or when the timeout elapses.
 */
export async function pollSession(sid, {
  bindBase = DEFAULT_BIND_BASE,
  bindPath = DEFAULT_BIND_PATH,
  deviceId,
  intervalMs = 1500,
  timeoutMs = 120_000,
  method = "POST",
  fetchImpl,
  onStatus,
} = {}) {
  const url = buildBindUrl({ bindBase, bindPath, sid, deviceId });
  const headers = { accept: "application/json", "content-type": "application/json" };
  if (deviceId) headers["x-tt-device-id"] = deviceId;
  const fetchNow = fetchImpl ?? ((...args) => fetch(...args));
  const deadline = Date.now() + timeoutMs;
  const timeoutMsg = "timed out waiting for the session to bind";
  let lastError = "";

  while (Date.now() < deadline) {
    let res;
    try {
      res = await fetchNow(url, { method, headers });
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      await sleep(intervalMs);
      continue;
    }

    // The endpoint is unauthenticated; 401/403 means the endpoint moved or the
    // device header was rejected, which will not fix itself by retrying.
    if (res.status === 401 || res.status === 403) {
      const error = new Error(`session complete unauthorized: HTTP ${res.status}`);
      error.code = "UNAUTHORIZED";
      throw error;
    }
    if (!res.ok) {
      lastError = `HTTP ${res.status}`;
      await sleep(intervalMs);
      continue;
    }

    let json;
    try {
      json = await res.json();
    } catch {
      json = {};
    }
    const data = json?.data && typeof json.data === "object" ? json.data : json;
    const status = typeof data?.status === "string" ? data.status.toUpperCase() : "";
    onStatus?.(status, json);

    if (status === "SUCCESS") {
      const mapped = mapBindPayload(json);
      if (mapped?.apiKey) return mapped;
    } else if (status && TERMINAL_FAIL_RE.test(status)) {
      const error = new Error(`session complete failed: ${status}`);
      error.code = status;
      throw error;
    }
    await sleep(intervalMs);
  }
  throw new Error(lastError ? `${timeoutMsg}: ${lastError}` : timeoutMsg);
}

/** Small sleep helper (kept outside the loop so pauses are uniform). */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One session-complete request — the single-shot variant of `pollSession`.
 *
 * Claiming is idempotent (see the README), so an already-bound session answers
 * `SUCCESS` with the same payload; this is how `auth.usage` refreshes the
 * `codingPlan.buckets` snapshot after login. Unlike `pollSession` there is no
 * loop: anything that is not an immediately usable `SUCCESS` payload throws,
 * with `error.code` naming the reason (`UNAUTHORIZED` / `HTTP` / `NETWORK` /
 * the raw status such as `WAITING` or `EXPIRED`).
 *
 * @param {string} sid
 * @param {{bindBase?: string, bindPath?: string, deviceId?: string, method?: string,
 *          fetchImpl?: Function}} opts
 * @returns {Promise<ReturnType<typeof mapBindPayload>>}
 */
export async function fetchSession(sid, {
  bindBase = DEFAULT_BIND_BASE,
  bindPath = DEFAULT_BIND_PATH,
  deviceId,
  method = "POST",
  fetchImpl,
} = {}) {
  const url = buildBindUrl({ bindBase, bindPath, sid, deviceId });
  const headers = { accept: "application/json", "content-type": "application/json" };
  if (deviceId) headers["x-tt-device-id"] = deviceId;
  const fetchNow = fetchImpl ?? ((...args) => fetch(...args));

  let res;
  try {
    res = await fetchNow(url, { method, headers });
  } catch (error) {
    const wrapped = new Error(error && error.message ? error.message : String(error));
    wrapped.code = "NETWORK";
    throw wrapped;
  }
  // 401/403 means the endpoint moved or the device header was rejected.
  if (res.status === 401 || res.status === 403) {
    const error = new Error(`session complete unauthorized: HTTP ${res.status}`);
    error.code = "UNAUTHORIZED";
    throw error;
  }
  if (!res.ok) {
    const error = new Error(`session complete: HTTP ${res.status}`);
    error.code = "HTTP";
    throw error;
  }
  let json;
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  const data = json?.data && typeof json.data === "object" ? json.data : json;
  const status = typeof data?.status === "string" ? data.status.toUpperCase() : "";
  if (status !== "SUCCESS") {
    const error = new Error(`session not ready: ${status || "no status"}`);
    error.code = status || "WAITING";
    throw error;
  }
  const mapped = mapBindPayload(json);
  if (!mapped?.apiKey) {
    const error = new Error("session complete reported SUCCESS without an apiKey");
    error.code = "NO_KEY";
    throw error;
  }
  return mapped;
}
