/**
 * Model discovery for InsCode free quota.
 *
 * The taotoken gateway reports what an account can use at `GET /v1/models`
 * (plain Bearer, no signing) — `{ data: [{ id, model, name, type }] }`. The
 * live list is the source of truth once a signed-in account exists; for a
 * low-tier account it is smaller.
 *
 * `FALLBACK_MODELS` is the snapshot that keeps the provider selectable before a
 * sign-in or when the fetch fails. The model *key* (what agents address by) is
 * sanitized; the original id rides along as `api.id` because that is the id the
 * upstream gateway expects in request bodies.
 *
 * @module magpie-inscode/models
 */

import { DEFAULT_API_BASE } from "./internal.mjs";

/** The AI SDK package that speaks the OpenAI-compatible dialect. */
export const NPM = "@ai-sdk/openai-compatible";

/** ChatGPT gateway root; loader requests and `api.url` default to it. */
export const DEFAULT_BASE_URL = DEFAULT_API_BASE;

/** Fallbacks when a row lacks a context/output window. */
export const DEFAULT_CONTEXT = 128000;
export const DEFAULT_OUTPUT = 8192;

/** How long one account's fetched list is trusted. */
export const MODELS_TTL_MS = 10 * 60_000;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Model keys may contain `/` or other characters that complicate addressing;
 * the unsanitized id stays in `api.id`, so the wire never sees the mangled one.
 */
export function sanitizeModelKey(value) {
  const id = String(value ?? "").trim();
  const key = id.replace(/[^A-Za-z0-9._-]/g, "_");
  return key || id;
}

/** The snapshot kept before sign-in / on fetch failure (observed free quota). */
export const FALLBACK_MODELS = [
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", context: 128000, output: 8192 },
];

/**
 * Normalize one `/v1/models` row (or a `FALLBACK_MODELS` entry, same shape).
 *
 * @returns {{id: string, key: string, name: string, context: number, output: number}|null}
 */
export function normalizeRow(raw = {}, { output = DEFAULT_OUTPUT } = {}) {
  const id = String(raw?.id ?? raw?.model ?? "").trim();
  if (!id) return null;
  const name = String(raw?.name ?? "").trim() || id;
  return {
    id,
    key: sanitizeModelKey(id),
    name,
    context: num(raw.context_window) > 0 ? num(raw.context_window) : DEFAULT_CONTEXT,
    output,
  };
}

/** The `config` hook's entry declaring one model. */
export function toConfigModel(m = {}) {
  return {
    name: m.name ?? m.id ?? m.key,
    tool_call: true,
    limit: { context: m.context ?? DEFAULT_CONTEXT, output: m.output ?? DEFAULT_OUTPUT },
    ...(m.key && m.id && m.key !== m.id ? { id: m.id } : {}),
  };
}

/** The `provider.models` entry for one model, in Magpie's model shape. */
export function toProviderModel(m = {}, providerID, { baseURL = DEFAULT_BASE_URL, npm = NPM } = {}) {
  return {
    id: m.key,
    providerID,
    name: m.name ?? m.id ?? m.key,
    api: { id: m.id ?? m.key, url: baseURL, npm },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: m.context ?? DEFAULT_CONTEXT, output: m.output ?? DEFAULT_OUTPUT },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  };
}

/** Declared (config-hook) models from rows in `FALLBACK_MODELS` shape. */
export function seedModels(rows = FALLBACK_MODELS) {
  return Object.fromEntries(
    rows
      .map((raw) => normalizeRow(raw))
      .filter(Boolean)
      .map((m) => [m.key, toConfigModel(m)]),
  );
}

/**
 * One account's catalog, fetched once and cached.
 *
 * Only the account's own key hits the wire, so two accounts never share a cache
 * entry. Non-2xx throws (with `signIn: "expired"` on 401 so the caller can mark
 * the account); the provider hook decides between fallback and account marking.
 *
 * @param {{apiBase?: string, ttlMs?: number, output?: number, fetchImpl?: Function}} opts
 */
export function createCatalog({
  apiBase = DEFAULT_BASE_URL,
  ttlMs = MODELS_TTL_MS,
  output = DEFAULT_OUTPUT,
  fetchImpl,
} = {}) {
  const cache = new Map();
  const inflight = new Map();
  const fetchNow = fetchImpl ?? ((...args) => fetch(...args));

  async function load(credentials, { output: outputOverride = output } = {}) {
    if (!credentials?.key) return [];
    const key = credentials.accountId || credentials.configDir || credentials.key;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.models;
    const pending = inflight.get(key);
    if (pending) return pending;

    const p = (async () => {
      const res = await fetchNow(`${apiBase}/models`, {
        headers: { authorization: `Bearer ${credentials.key}`, accept: "application/json" },
      });
      if (res.status === 401) {
        throw Object.assign(new Error(`GET /v1/models -> 401`), { signIn: "expired" });
      }
      if (!res.ok) throw new Error(`GET /v1/models -> ${res.status}`);
      const { data } = await res.json().catch(() => ({}));
      const models = (Array.isArray(data) ? data : [])
        .map((row) => normalizeRow(row, { output: outputOverride }))
        .filter(Boolean);
      if (models.length) cache.set(key, { at: Date.now(), models });
      return models;
    })().finally(() => inflight.delete(key));

    inflight.set(key, p);
    return p;
  }

  return { load };
}