/**
 * Helpers shared by the plugin entry and its tests.
 *
 * Kept out of `index.mjs` because OpenCode is a compatibility host and it calls
 * every function the entry module exports. See that file's header.
 *
 * @module magpie-inscode/internal
 */

import { readFileSync } from "node:fs";

/** The provider id, which is also what agents address models by: `inscode/<model>`. */
export const PROVIDER = "inscode";

/**
 * The gateway base used for model + chat requests. Chat POSTs additionally
 * carry the `X-Tt` client signature (see `sign.mjs`); `GET /models` is pure
 * Bearer. `https://taotoken.net/api/v1` is the host+path combination the
 * InsCode client itself uses and the one the signature algorithm was verified
 * against; `api.taotoken.net/v1` also serves the models list but rejects
 * signed-less chat POSTs with `401 invalid_client_signature`. `loader.baseURL`
 * and per-model `api.url` default to it; magpie appends `/chat/completions`
 * (OpenAI-compatible).
 */
export const DEFAULT_API_BASE = "https://taotoken.net/api/v1";

/** Inlined so the provider stays identifiable with no network. */
export const ICON = readIcon();

/** The provider's own icon, vendored into `assets/icon.svg`, inlined as a data URI. */
function readIcon() {
  try {
    const svg = readFileSync(new URL("./assets/icon.svg", import.meta.url));
    return `data:image/svg+xml;base64,${svg.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** Read the stored sign-in, tolerating a host that has none. */
export async function readAuth(getAuth) {
  if (typeof getAuth !== "function") return undefined;
  try {
    return await getAuth();
  } catch {
    return undefined;
  }
}

/**
 * The fields a signed request needs, out of a stored auth record.
 *
 * InsCode logs in with a local API key whose companions (sign keys, device id)
 * ride on `metadata`; a record without a key cannot sign at all. The sign key
 * may be stored three ways — flat (`keyId`/`signKeyB64`), the OAuth session
 * payload (`signKey: { keyId, signKey }`), or the local client snapshot
 * (`free.sign_key: { key_id, sign_key }`) — so all three are accepted here.
 */
export function credentialsOf(auth) {
  if (!auth || typeof auth !== "object") return undefined;
  const key = typeof auth.key === "string" && auth.key ? auth.key : undefined;
  if (!key) return undefined;
  const metadata = auth.metadata && typeof auth.metadata === "object" ? auth.metadata : {};
  const sk = metadata.signKey && typeof metadata.signKey === "object" ? metadata.signKey : {};
  const freeKey = metadata.free?.sign_key && typeof metadata.free.sign_key === "object" ? metadata.free.sign_key : {};
  return {
    type: auth.type,
    key,
    configDir: typeof metadata.configDir === "string" ? metadata.configDir : undefined,
    keyId: str(metadata.keyId) || str(sk.keyId) || str(freeKey.key_id),
    signKeyB64: str(metadata.signKeyB64) || str(sk.signKey) || str(freeKey.sign_key),
    deviceId: typeof metadata.deviceId === "string" ? metadata.deviceId : undefined,
    accountId: typeof auth.accountId === "string" ? auth.accountId : undefined,
  };
}

/** First non-empty trimmed string, else undefined. */
function str(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Stable cache key for one account. */
export function accountKey(credentials) {
  return credentials?.accountId || credentials?.configDir || credentials?.key || "no-account";
}

/**
 * Mark a model list as the remembered one rather than a live one.
 *
 * @param {object} models - the list to mark.
 * @returns {object} a copy carrying the marker.
 */
export function fellBack(models) {
  return { ...models, [Symbol.for("magpie.fellBack")]: true };
}