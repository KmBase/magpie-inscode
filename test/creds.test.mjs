import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadFreeAccount, accountName, defaultConfigDir } from "../creds.mjs";

function tempCreds(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "magpie-inscode-"));
  for (const [name, obj] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), JSON.stringify(obj), "utf8");
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("loadFreeAccount 解析免费账号字段", () => {
  const { dir, cleanup } = tempCreds({
    "taotoken.json": { free: { api_key: "ak-123", sign_key: { key_id: "kid1", sign_key: "c2lnbmtleQ==", expire_at: 1710000000 }, enabled_models: ["deepseek-v4-flash"] } },
    "device.json": { device_id: "dev-1" },
    "auth.json": { email: "ada@example.com", name: "Ada" },
  });
  try {
    const c = loadFreeAccount(dir);
    assert.equal(c.key, "ak-123");
    assert.equal(c.keyId, "kid1");
    assert.equal(c.deviceId, "dev-1");
    assert.equal(c.signKeyExpireAt, "1710000000");
    assert.equal(accountName(c.account), "ada@example.com");
  } finally {
    cleanup();
  }
});

test("loadFreeAccount 缺失文件返回空字段而非抛错", () => {
  const { dir, cleanup } = tempCreds({});
  try {
    const c = loadFreeAccount(dir);
    assert.equal(c.key, "");
    assert.equal(c.keyId, "");
    assert.equal(c.deviceId, "");
  } finally {
    cleanup();
  }
});

test("accountName 顺序：accountId > account_id > name > email", () => {
  assert.equal(accountName({ accountId: "u1", email: "x@y" }), "u1");
  assert.equal(accountName({ account_id: "u2", email: "x@y" }), "u2");
  assert.equal(accountName({ email: "x@y" }), "x@y");
  assert.equal(accountName({}), "");
});

test("defaultConfigDir 尊重 INCODE2API_CONFIG_DIR", () => {
  const prev = process.env.INCODE2API_CONFIG_DIR;
  try {
    process.env.INCODE2API_CONFIG_DIR = "/tmp/zzz";
    assert.equal(defaultConfigDir(), "/tmp/zzz");
  } finally {
    if (prev === undefined) delete process.env.INCODE2API_CONFIG_DIR;
    else process.env.INCODE2API_CONFIG_DIR = prev;
  }
});