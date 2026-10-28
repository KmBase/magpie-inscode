import { test } from "node:test";
import assert from "node:assert/strict";

import {
  newSid, newDeviceId, buildAuthorizeUrl, buildBindUrl, mapBindPayload, pollSession, fetchSession,
  DEFAULT_OAUTH_URL, DEFAULT_BIND_BASE, DEFAULT_BIND_PATH,
} from "../oauth.mjs";

/** A session-complete response shaped exactly like the real endpoint's `data`. */
const SUCCESS_DATA = {
  sid: "66eb9f3b-9c4e-40b9-8481-eeac6449ed9f",
  status: "SUCCESS",
  token: "jwt.ignored",
  username: "csdn_qq_25262697",
  nickname: "KmBase",
  avatar: "https://example.com/a.jpg",
  tokenExpiresAt: 1794119766000,
  apiKey: "sk-zzzz",
  codingPlan: {
    goodsId: "coding_plan_codex_free",
    goodsName: "Coding Plan Free",
    planType: "free",
    planTier: "codex_free",
    showPlanTier: "Free",
    supportModels: ["deepseek-v4-flash", "deepseek-flash", "qwen3-vl-8b-instruct"],
    buckets: [{ quotaCode: "5_hour", startTime: "2026-10-28 22:30:05", endTime: "2026-10-29 03:30:05", usagePercent: 43.33 }],
    periodStart: "2026-08-03 16:30:05",
    periodEnd: "2027-08-03 16:30:05",
  },
  signKey: { keyId: "kid-1", signKey: "sig-1", expireAt: "2026-11-28 00:11:56" },
};
const ENVELOPE = { code: 200, msg: "success", data: SUCCESS_DATA };

test("newSid / newDeviceId 返回 UUID v4", () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.match(newSid(), uuid);
  assert.match(newDeviceId(), uuid);
});

test("buildAuthorizeUrl 仅带 sid（无 redirect_uri）", () => {
  const u = new URL(buildAuthorizeUrl({ sid: "s-1" }));
  assert.equal(u.origin, new URL(DEFAULT_OAUTH_URL).origin);
  assert.equal(u.pathname, "/oauth");
  assert.equal(u.searchParams.get("sid"), "s-1");
  assert.equal(u.searchParams.has("redirect_uri"), false);
});

test("buildBindUrl 指向 api 主机的 complete 端点，并带 deviceId", () => {
  assert.equal(DEFAULT_BIND_BASE, "https://api.taotoken.net");
  assert.equal(
    buildBindUrl({ sid: "s-1" }),
    `${DEFAULT_BIND_BASE}/v1/codex/session/s-1/complete`,
  );
  assert.equal(
    buildBindUrl({ sid: "a/b" }),
    `${DEFAULT_BIND_BASE}/v1/codex/session/a%2Fb/complete`,
  );
  const withDevice = new URL(buildBindUrl({ sid: "s-1", deviceId: "dev-1" }));
  assert.equal(withDevice.searchParams.get("deviceId"), "dev-1");
  assert.equal(
    buildBindUrl({ bindBase: "https://h", bindPath: "/x/{sid}", sid: "a" }),
    "https://h/x/a",
  );
});

test("mapBindPayload：取 apiKey/username/nickname/signKey/models/buckets/plan；无 apiKey 为 null", () => {
  const m = mapBindPayload(ENVELOPE);
  assert.equal(m.apiKey, "sk-zzzz");
  assert.equal(m.username, "csdn_qq_25262697");
  assert.equal(m.nickname, "KmBase");
  assert.equal(m.plan, "Coding Plan Free");
  assert.equal(m.planTier, "codex_free");
  assert.deepEqual(m.models, ["deepseek-v4-flash", "deepseek-flash", "qwen3-vl-8b-instruct"]);
  assert.equal(m.buckets.length, 1);
  assert.equal(m.periodEnd, "2027-08-03 16:30:05");
  assert.deepEqual(m.signKey, { keyId: "kid-1", signKey: "sig-1", expireAt: "2026-11-28 00:11:56" });
  // 直接传 data 亦可
  assert.equal(mapBindPayload(SUCCESS_DATA).apiKey, "sk-zzzz");
  assert.equal(mapBindPayload({ data: {} }), null);
  assert.equal(mapBindPayload({}), null);
  assert.equal(mapBindPayload(null), null);
});

function stubFetch(script) {
  let n = 0;
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET", headers: init?.headers ?? {} });
      const response = script(n++);
      return response instanceof Response
        ? response
        : new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
    },
  };
}

test("pollSession：首轮即 SUCCESS → 返回凭据，POST 到 complete 并带设备头", async () => {
  const { fetchImpl, calls } = stubFetch(() => ({ status: 200, body: ENVELOPE }));
  const m = await pollSession("sid-x", { deviceId: "dev-x", fetchImpl });
  assert.equal(m.apiKey, "sk-zzzz");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${DEFAULT_BIND_BASE}/v1/codex/session/sid-x/complete?deviceId=dev-x`);
  assert.equal(calls[0].headers["x-tt-device-id"], "dev-x");
});

test("pollSession：WAITING → SUCCESS", async () => {
  const waiting = { code: 200, data: { sid: "s", status: "WAITING" } };
  const { fetchImpl } = stubFetch((n) => ({ status: 200, body: n < 2 ? waiting : ENVELOPE }));
  const m = await pollSession("s", { intervalMs: 10, timeoutMs: 500, fetchImpl });
  assert.equal(m.apiKey, "sk-zzzz");
});

test("pollSession：EXPIRED / CONSUMED → 终态失败并带 code", async () => {
  for (const status of ["EXPIRED", "CONSUMED", "INVALID"]) {
    const { fetchImpl } = stubFetch(() => ({ status: 200, body: { code: 200, data: { status } } }));
    await assert.rejects(
      () => pollSession("s", { intervalMs: 10, timeoutMs: 500, fetchImpl }),
      (error) => error.code === status,
    );
  }
});

test("pollSession：HTTP 401 → 立即抛出 UNAUTHORIZED", async () => {
  const { fetchImpl } = stubFetch(() => ({ status: 401, body: { status: "401", error: "Unauthorized" } }));
  await assert.rejects(() => pollSession("s", { intervalMs: 10, timeoutMs: 500, fetchImpl }), (error) =>
    error.code === "UNAUTHORIZED");
});

test("pollSession：超时仍 WAITING → 抛错", async () => {
  const { fetchImpl } = stubFetch(() => ({ status: 200, body: { code: 200, data: { status: "WAITING" } } }));
  await assert.rejects(() => pollSession("s", { intervalMs: 20, timeoutMs: 80, fetchImpl }), /timed out/);
});

test("pollSession：网络异常继续轮询，最终超时", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNRESET");
  };
  await assert.rejects(() => pollSession("s", { intervalMs: 20, timeoutMs: 80, fetchImpl }), /timed out/);
});

test("fetchSession：SUCCESS → 单次返回凭据，POST 到 complete 并带设备头", async () => {
  const { fetchImpl, calls } = stubFetch(() => ({ status: 200, body: ENVELOPE }));
  const m = await fetchSession("sid-f", { deviceId: "dev-f", fetchImpl });
  assert.equal(m.apiKey, "sk-zzzz");
  assert.equal(m.plan, "Coding Plan Free");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/v1\/codex\/session\/sid-f\/complete\?deviceId=dev-f$/);
  assert.equal(calls[0].headers["x-tt-device-id"], "dev-f");
});

test("fetchSession：WAITING → 抛错且只请求一次（不轮询）", async () => {
  const { fetchImpl, calls } = stubFetch(() => ({ status: 200, body: { code: 200, data: { status: "WAITING" } } }));
  await assert.rejects(() => fetchSession("s", { fetchImpl }), (error) => error.code === "WAITING");
  assert.equal(calls.length, 1);
});

test("fetchSession：HTTP 401 → UNAUTHORIZED；HTTP 500 → HTTP", async () => {
  const a = stubFetch(() => ({ status: 401, body: {} }));
  await assert.rejects(() => fetchSession("s", { fetchImpl: a.fetchImpl }), (error) =>
    error.code === "UNAUTHORIZED");
  const b = stubFetch(() => ({ status: 500, body: {} }));
  await assert.rejects(() => fetchSession("s", { fetchImpl: b.fetchImpl }), (error) =>
    error.code === "HTTP" && /HTTP 500/.test(error.message));
});

test("fetchSession：网络异常 → NETWORK", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNRESET");
  };
  await assert.rejects(() => fetchSession("s", { fetchImpl }), (error) =>
    error.code === "NETWORK" && error.message === "ECONNRESET");
});
