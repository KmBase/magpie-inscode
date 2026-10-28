import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSignHeaders, SIGN_VERSION } from "../sign.mjs";
import { credentialsOf, DEFAULT_API_BASE } from "../internal.mjs";
import { InsCodeAuthPlugin } from "../index.mjs";

// 独立参考值：用 Python 的 hmac/hashlib 按 canonical 公式预先算出，
// 避免"实现自己验证自己"。
const KEY_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="; // 32 字节 0x00..0x1f
const KEY_ID = "0123456789abcdef0123456789abcdef";
const TS = "1700000000000";
const NONCE = "AAAAAAAAAAAAAAAAAAAAAA=="; // 16 个 0 字节的 base64
const BODY = '{"hello":"world"}';
const SIGN = "9767d716cee17edef4ff22f92dc33d29324c2ff3286b795eea5391dd8b4e2d54";
const PATH = "/api/v1/chat/completions";

test("buildSignHeaders：POST 按 canonical 计算 HMAC-SHA256（对齐独立参考值）", () => {
  const h = buildSignHeaders({
    keyId: KEY_ID,
    signKeyB64: KEY_B64,
    deviceId: "dev-1",
    method: "POST",
    path: PATH,
    body: BODY,
    ts: TS,
    nonce: NONCE,
  });
  assert.equal(h["x-tt-sign"], SIGN);
  assert.equal(h["x-tt-keyid"], KEY_ID);
  assert.equal(h["x-tt-ts"], TS);
  assert.equal(h["x-tt-nonce"], NONCE);
  assert.equal(h["x-tt-sign-version"], SIGN_VERSION);
  assert.equal(h["x-tt-device-id"], "dev-1");
});

test("buildSignHeaders：缺 body 等价空体", () => {
  const noBody = buildSignHeaders({ keyId: KEY_ID, signKeyB64: KEY_B64, method: "POST", path: PATH, ts: TS, nonce: NONCE });
  const empty = buildSignHeaders({ keyId: KEY_ID, signKeyB64: KEY_B64, method: "POST", path: PATH, body: "", ts: TS, nonce: NONCE });
  assert.equal(noBody["x-tt-sign"], empty["x-tt-sign"]);
  assert.notEqual(noBody["x-tt-sign"], SIGN); // 空体与示例 body 的签名不同
});

test("buildSignHeaders：GET / 缺密钥材料时不签名", () => {
  const base = { keyId: KEY_ID, signKeyB64: KEY_B64, path: PATH, ts: TS, nonce: NONCE };
  assert.deepEqual(buildSignHeaders({ ...base, method: "GET" }), {});
  assert.deepEqual(buildSignHeaders({ ...base, method: "POST", keyId: "" }), {});
  assert.deepEqual(buildSignHeaders({ ...base, method: "POST", signKeyB64: "" }), {});
});

test("credentialsOf：三种 metadata 存放位置都能取出签名材料", () => {
  const flat = credentialsOf({ key: "k", metadata: { keyId: KEY_ID, signKeyB64: KEY_B64, deviceId: "d" } });
  assert.equal(flat.keyId, KEY_ID);
  assert.equal(flat.signKeyB64, KEY_B64);

  const oauth = credentialsOf({ key: "k", metadata: { signKey: { keyId: KEY_ID, signKey: KEY_B64 } } });
  assert.equal(oauth.keyId, KEY_ID);
  assert.equal(oauth.signKeyB64, KEY_B64);

  const local = credentialsOf({ key: "k", metadata: { free: { sign_key: { key_id: KEY_ID, sign_key: KEY_B64 } } } });
  assert.equal(local.keyId, KEY_ID);
  assert.equal(local.signKeyB64, KEY_B64);

  assert.equal(credentialsOf({ key: "k", metadata: {} }).keyId, undefined);
  assert.equal(credentialsOf({ key: "k", metadata: {} }).signKeyB64, undefined);
});

test("loader：chat POST 带 X-Tt 签名头，models GET 保持纯 Bearer", async () => {
  const calls = [];
  const plugin = await InsCodeAuthPlugin({}, {});
  const globalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), headers: new Headers(init?.headers), method: String(init?.method ?? "GET").toUpperCase() });
    return new Response("{}", { status: 200 });
  };
  try {
    const { fetch } = await plugin.auth.loader(async () => ({
      key: "ak-1",
      metadata: { signKey: { keyId: KEY_ID, signKey: KEY_B64 }, deviceId: "dev-9" },
    }));

    await fetch(`${DEFAULT_API_BASE}/chat/completions`, { method: "POST", body: BODY });
    await fetch(`${DEFAULT_API_BASE}/models`, { headers: { accept: "application/json" } });
  } finally {
    globalThis.fetch = globalFetch;
  }

  const [chat, models] = calls;
  assert.equal(chat.method, "POST");
  assert.equal(chat.headers.get("authorization"), "Bearer ak-1");
  assert.equal(chat.headers.get("x-tt-keyid"), KEY_ID);
  assert.equal(chat.headers.get("x-tt-sign-version"), SIGN_VERSION);
  assert.equal(chat.headers.get("x-tt-device-id"), "dev-9");
  assert.ok(chat.headers.get("x-tt-sign").match(/^[0-9a-f]{64}$/));
  assert.ok(chat.headers.get("x-tt-ts").match(/^\d+$/));

  assert.equal(models.method, "GET");
  assert.equal(models.headers.get("authorization"), "Bearer ak-1");
  assert.equal(models.headers.get("x-tt-sign"), null);
});

test("loader：无签名材料的账号回落为纯 Bearer（不报错）", async () => {
  const calls = [];
  const plugin = await InsCodeAuthPlugin({}, {});
  const globalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ headers: new Headers(init?.headers) });
    return new Response("{}", { status: 200 });
  };
  try {
    const { fetch } = await plugin.auth.loader(async () => ({ key: "ak-2", metadata: {} }));
    await fetch(`${DEFAULT_API_BASE}/chat/completions`, { method: "POST", body: BODY });
  } finally {
    globalThis.fetch = globalFetch;
  }
  assert.equal(calls[0].headers.get("authorization"), "Bearer ak-2");
  assert.equal(calls[0].headers.get("x-tt-sign"), null);
});
