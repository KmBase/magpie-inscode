import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { InsCodeAuthPlugin } from "../index.mjs";

/** A plugin instance with a fixed locale so the window names are assertable. */
async function plugin() {
  return InsCodeAuthPlugin({ client: {} }, { locale: "zh" });
}

/** Write a minimal InsCode credential dir and return its path. */
function credDir(free) {
  const dir = mkdtempSync(path.join(tmpdir(), "inscode-usage-"));
  writeFileSync(path.join(dir, "taotoken.json"), JSON.stringify({ free }));
  return dir;
}

test("usage：OAuth 登录无 buckets 时回退本机 taotoken.json，显示 5 小时额度", async () => {
  const dir = credDir({ api_key: "k", plan_name: "", used: 30, limit: 100 });
  const p = await plugin();
  const auth = {
    type: "oauth",
    key: "k",
    accountId: "oauth-no-buckets",
    metadata: { plan: "Coding Plan Free" },
  };
  const r = await p.auth.usage(async () => ({ ...auth, metadata: { ...auth.metadata, configDir: dir } }));
  assert.equal(r.plan, "Coding Plan Free");
  assert.equal(r.windows.length, 1);
  assert.equal(r.windows[0].name, "5 小时");
  assert.equal(r.windows[0].used, 30);
  assert.equal(r.windows[0].limit, 100);
  assert.equal(r.windows[0].span, 5 * 3600);
});

test("usage：本机快照也没有 used/limit → plan 保留、窗口为空", async () => {
  const dir = credDir({ api_key: "k" });
  const p = await plugin();
  const r = await p.auth.usage(async () => ({
    type: "oauth",
    key: "k",
    accountId: "oauth-empty",
    metadata: { plan: "Coding Plan Free", configDir: dir },
  }));
  assert.equal(r.plan, "Coding Plan Free");
  assert.deepEqual(r.windows, []);
});

test("usage：本机凭据登录（metadata.free）仍走快照，窗口照常显示", async () => {
  const p = await plugin();
  const r = await p.auth.usage(async () => ({
    type: "api",
    key: "k",
    accountId: "local-free",
    metadata: { configDir: "unused", free: { plan_name: "Pro", used: 10, limit: 40 } },
  }));
  assert.equal(r.plan, "Pro");
  assert.equal(r.windows.length, 1);
  assert.equal(r.windows[0].used, 25);
});

test("usage：buckets 存在时优先用绑定桶，不读本机文件", async () => {
  const dir = credDir({ api_key: "k", used: 1, limit: 2 });
  const p = await plugin();
  const r = await p.auth.usage(async () => ({
    type: "oauth",
    key: "k",
    accountId: "oauth-buckets",
    metadata: {
      plan: "Coding Plan Free",
      configDir: dir,
      buckets: [{ quotaCode: "5_hour", usagePercent: 43.33, endTime: "2026-10-29 03:30:05" }],
    },
  }));
  assert.equal(r.windows.length, 1);
  assert.equal(r.windows[0].name, "5 小时");
  assert.equal(r.windows[0].used, 43.33);
});

test("usage：带 sid 时重 poll complete 刷新 buckets，后来才出现的 5h 桶能看到", async () => {
  const calls = [];
  const p = await InsCodeAuthPlugin({ client: {} }, {
    locale: "zh",
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method, headers: init?.headers ?? {} });
      return new Response(JSON.stringify({
        code: 200,
        data: {
          status: "SUCCESS",
          apiKey: "k",
          username: "u1",
          codingPlan: {
            goodsName: "Coding Plan Free",
            buckets: [
              { quotaCode: "5_hour", usagePercent: 12.5, endTime: "2026-10-29 03:30:05" },
              { quotaCode: "1_week", usagePercent: 40 },
            ],
          },
        },
      }), { status: 200 });
    },
  });
  const r = await p.auth.usage(async () => ({
    type: "oauth",
    key: "k",
    accountId: "oauth-refresh",
    metadata: {
      sid: "sid-r1",
      deviceId: "dev-r1",
      plan: "Coding Plan Free",
      // 登录快照里没有 5h 桶——正是线上观察到的问题
      buckets: [{ quotaCode: "1_week", usagePercent: 40 }],
    },
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/v1\/codex\/session\/sid-r1\/complete\?deviceId=dev-r1$/);
  assert.equal(calls[0].headers["x-tt-device-id"], "dev-r1");
  assert.equal(r.windows.length, 1);
  assert.equal(r.windows[0].name, "5 小时");
  assert.equal(r.windows[0].used, 12.5);
});

test("usage：刷新失败 → 回退登录快照的窗口", async () => {
  const p = await InsCodeAuthPlugin({ client: {} }, {
    locale: "zh",
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  const r = await p.auth.usage(async () => ({
    type: "oauth",
    key: "k",
    accountId: "oauth-refresh-fail",
    metadata: {
      sid: "sid-r2",
      deviceId: "dev-r2",
      plan: "Coding Plan Free",
      buckets: [{ quotaCode: "5_hour", usagePercent: 8, endTime: "2026-10-29 03:30:05" }],
    },
  }));
  assert.equal(r.windows.length, 1);
  assert.equal(r.windows[0].name, "5 小时");
  assert.equal(r.windows[0].used, 8);
});

test("usage：没有 sid（本机凭据或旧登录记录）→ 不发刷新请求", async () => {
  let calls = 0;
  const p = await InsCodeAuthPlugin({ client: {} }, {
    locale: "zh",
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  });
  const r = await p.auth.usage(async () => ({
    type: "api",
    key: "k",
    accountId: "local-no-sid",
    metadata: { configDir: "unused", free: { plan_name: "Pro", used: 10, limit: 40 } },
  }));
  assert.equal(calls, 0);
  assert.equal(r.windows.length, 1);
  assert.equal(r.windows[0].used, 25);
});
