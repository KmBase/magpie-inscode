/**
 * Loading and parsing the local InsCode credentials.
 *
 * InsCode (CSDN) writes its sign-in state to `~/.config/inscode/`:
 *
 *   - `taotoken.json` → `{ free: { api_key, enabled_models, sign_key:
 *     { key_id, sign_key, expire_at }, model_meta }, pros: [...] }`
 *   - `device.json`   → `{ device_id }`
 *   - `auth.json`     → the login state (JWT / account fields)
 *
 * Everything here stays on this machine — the plugin only sends these values
 * to the taotoken.net gateway as Authorization / X-Tt headers.
 *
 * @module magpie-inscode/creds
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Default credential directory (same one the InsCode client uses). */
export function defaultConfigDir() {
  return (
    process.env.INCODE2API_CONFIG_DIR ||
    path.join(homedir(), ".config", "inscode")
  );
}

/** Read one JSON file, tolerant of a missing file. */
function readJson(dir, name) {
  try {
    return JSON.parse(readFileSync(path.join(dir, name), "utf8"));
  } catch {
    return {};
  }
}

/**
 * Load the primary (free) InsCode account from the local credential files.
 *
 * @param {string} [dir] credential directory (defaults to `defaultConfigDir()`).
 * @returns {{ key: string, keyId: string, signKeyB64: string, deviceId: string,
 *            configDir: string, account?: object, free?: object, signKeyExpireAt?: string }}
 *          with every field set to "" when it is missing.
 */
export function loadFreeAccount(dir = defaultConfigDir()) {
  const taotoken = readJson(dir, "taotoken.json");
  const device = readJson(dir, "device.json");
  const auth = readJson(dir, "auth.json");

  const free = taotoken.free && typeof taotoken.free === "object" ? taotoken.free : {};
  const signKey = free.sign_key && typeof free.sign_key === "object" ? free.sign_key : {};

  return {
    configDir: dir,
    key: (free.api_key || "").trim(),
    keyId: (signKey.key_id || "").trim(),
    signKeyB64: (signKey.sign_key || "").trim(),
    signKeyExpireAt: signKey.expire_at != null ? String(signKey.expire_at) : "",
    deviceId: (device.device_id || "").trim(),
    account: auth && typeof auth === "object" ? auth : {},
    free,
  };
}

/**
 * Best-effort display name for the account — what the row shows in Magpie.
 * Order follows the Magpie convention: `accountId`, then `email` first of the
 * free-text labels.
 */
export function accountName(account = {}) {
  return (
    account.accountId ||
    account.account_id ||
    account.email ||
    account.nickname ||
    account.name ||
    account.username ||
    account.uid ||
    ""
  );
}