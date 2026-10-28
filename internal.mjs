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
 * The console API-key gateway base used for model requests (pure Bearer; the
 * X-Tt client signature is not used). `loader.baseURL` and per-model
 * `api.url` default to it; magpie appends `/chat/completions`
 * (OpenAI-compatible) → `https://api.taotoken.net/v1/chat/completions`.
 */
export const DEFAULT_API_BASE = "https://api.taotoken.net/v1";

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
 * ride on `metadata`; a record without a key cannot sign at all.
 */
export function credentialsOf(auth) {
  if (!auth || typeof auth !== "object") return undefined;
  const key = typeof auth.key === "string" && auth.key ? auth.key : undefined;
  if (!key) return undefined;
  const metadata = auth.metadata && typeof auth.metadata === "object" ? auth.metadata : {};
  return {
    type: auth.type,
    key,
    configDir: typeof metadata.configDir === "string" ? metadata.configDir : undefined,
    keyId: typeof metadata.keyId === "string" ? metadata.keyId : undefined,
    signKeyB64: typeof metadata.signKeyB64 === "string" ? metadata.signKeyB64 : undefined,
    deviceId: typeof metadata.deviceId === "string" ? metadata.deviceId : undefined,
    accountId: typeof auth.accountId === "string" ? auth.accountId : undefined,
  };
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