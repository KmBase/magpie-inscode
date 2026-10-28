import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeRow, sanitizeModelKey, toConfigModel, toProviderModel, seedModels, createCatalog, FALLBACK_MODELS, NPM } from "../models.mjs";
import { PROVIDER, DEFAULT_API_BASE } from "../internal.mjs";

test("sanitizeModelKey 规整 key", () => {
  assert.equal(sanitizeModelKey("deepseek-v4-flash"), "deepseek-v4-flash");
  assert.equal(sanitizeModelKey("a/b c"), "a_b_c");
});

test("normalizeRow 取 id/model/name, 缺省输出长度", () => {
  const m = normalizeRow({ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" });
  assert.equal(m.key, "deepseek-v4-flash");
  assert.equal(m.name, "DeepSeek V4 Flash");
  assert.equal(m.output, 8192);
  assert.equal(normalizeRow({ model: "x", name: "" }).name, "x"); // name 缺省用 id
  assert.equal(normalizeRow({}), null);
});

test("toConfigModel / toProviderModel 形状", () => {
  const m = normalizeRow(FALLBACK_MODELS[0]);
  const cfg = toConfigModel(m);
  assert.equal(cfg.tool_call, true);
  assert.equal(cfg.limit.context, 128000);
  const p = toProviderModel(m, PROVIDER);
  assert.equal(p.providerID, PROVIDER);
  assert.equal(p.api.id, "deepseek-v4-flash");
  assert.equal(p.api.npm, NPM);
  assert.equal(p.api.url, DEFAULT_API_BASE);
  assert.equal(p.capabilities.toolcall, true);
});

test("seedModels 从 fallback 生成 config 映射", () => {
  const s = seedModels();
  assert.ok("deepseek-v4-flash" in s);
});

test("createCatalog 拉取并按账号缓存；401 → signIn expired", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    return new Response(JSON.stringify({ data: [{ id: "deepseek-v4-flash", name: "DS4" }] }), { status: 200 });
  };
  const c = createCatalog({ apiBase: "https://tt.test/v1", fetchImpl });
  const list1 = await c.load({ key: "k1", accountId: "a1" });
  assert.equal(list1.length, 1);
  assert.equal(list1[0].id, "deepseek-v4-flash");
  const list2 = await c.load({ key: "k1", accountId: "a1" }); // 命中缓存
  assert.equal(list2.length, 1);
  assert.equal(calls.length, 1, "同一账号不应重复拉取");

  const err401 = createCatalog({ apiBase: "https://tt.test/v1", fetchImpl: async () => new Response("{}", { status: 401 }) });
  await assert.rejects(() => err401.load({ key: "k", accountId: "a2" }), (e) => e.signIn === "expired");
});

test("createCatalog 无 key 返回空", async () => {
  const c = createCatalog({ apiBase: "https://tt.test/v1", fetchImpl: async () => { throw new Error("不应调用"); } });
  assert.deepEqual(await c.load({}), []);
});