/**
 * Taotoken `X-Tt` client signature (chat requests).
 *
 * The gateway answers `401 invalid_client_signature` on a signed-in chat
 * request that carries only the Bearer key, so POSTs must be signed:
 *
 *   - HMAC key: `sign_key.sign_key` **base64-decoded** (32 raw bytes);
 *   - canonical string: `POST\n{path}\n{ts_ms}\n{nonce_b64}\n{key_id}\n{body_sha256_hex}`;
 *   - `X-Tt-Sign` = HMAC-SHA256(key, canonical), lowercase hex.
 *
 * The signature rides on six `X-Tt-*` headers; `GET` endpoints (e.g.
 * `/v1/models`) are pure Bearer and must NOT be signed. Algorithm per the
 * InsCode client's `signer.rs`, verified against the live gateway — see
 * NOTICE.md.
 *
 * @module magpie-inscode/sign
 */

import { createHash, createHmac, randomBytes } from "node:crypto";

/** The `X-Tt-Sign-Version` value the gateway expects. */
export const SIGN_VERSION = "v1";

/**
 * Build the `X-Tt-*` signature headers for one upstream request.
 *
 * Only POST requests are signed; anything else (and any request missing the
 * key id or the sign key) returns `{}`, i.e. plain Bearer.
 *
 * @param {{keyId?: string, signKeyB64?: string, deviceId?: string,
 *          method: string, path: string, body?: bodyInit,
 *          ts?: string, nonce?: string}} req
 *   `path` is the URL path the gateway sees (e.g. `/api/v1/chat/completions`);
 *   `body` is the raw request body (string or bytes); absent means empty.
 *   `ts`/`nonce` override the generated timestamp/nonce — test hooks only.
 * @returns {Record<string, string>} the `X-Tt-*` headers to merge in.
 */
export function buildSignHeaders({ keyId, signKeyB64, deviceId, method, path, body, ts, nonce } = {}) {
  if (String(method || "").toUpperCase() !== "POST") return {};
  if (!keyId || !signKeyB64) return {};

  let key;
  try {
    key = Buffer.from(signKeyB64, "base64");
  } catch {
    return {};
  }
  if (key.length === 0) return {};

  const tsMs = ts ?? String(Date.now());
  const nonceB64 = nonce ?? randomBytes(16).toString("base64");
  const bodySha = createHash("sha256").update(toBytes(body)).digest("hex");
  const canonical = `POST\n${path}\n${tsMs}\n${nonceB64}\n${keyId}\n${bodySha}`;
  const sign = createHmac("sha256", key).update(canonical, "utf8").digest("hex");

  return {
    "x-tt-keyid": keyId,
    "x-tt-ts": tsMs,
    "x-tt-nonce": nonceB64,
    "x-tt-sign": sign,
    "x-tt-sign-version": SIGN_VERSION,
    ...(deviceId ? { "x-tt-device-id": deviceId } : {}),
  };
}

/** Coerce a fetch body init into the bytes the gateway will hash. */
function toBytes(body) {
  if (body == null) return Buffer.alloc(0);
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  // Blob / URLSearchParams / stream bodies are not expected on this path
  // (the AI SDK posts strings); treat anything else as empty.
  return Buffer.alloc(0);
}
