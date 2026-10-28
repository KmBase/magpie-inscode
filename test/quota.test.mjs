import { test } from "node:test";
import assert from "node:assert/strict";

import { usageFromCreds, usageFromBind, num } from "../quota.mjs";
import { strings } from "../i18n.mjs";

const t = strings("zh");

test("num：数字保留，否则 undefined", () => {
  assert.equal(num(0), 0);
  assert.equal(num(37.5), 37.5);
  assert.equal(num("42"), 42);
  assert.equal(num("abc"), undefined);
  assert.equal(num(null), undefined);
});

test("free 带 used/limit → 一个 5h 窗口", () => {
  const r = usageFromCreds({ free: { plan_name: "Pro", used: 100, limit: 200 } }, { t, user: "ada" });
  assert.equal(r.plan, "Pro");
  assert.equal(r.user, "ada");
  assert.equal(r.windows.length, 1);
  assert.equal(r.windows[0].used, 50); // 100/200 → 50%
  assert.equal(r.windows[0].limit, 200);
  assert.equal(r.windows[0].span, 5 * 3600);
  assert.equal(r.windows[0].name, "5 小时");
  assert.equal(r.windows[0].display, "100 / 200 次");
});

test("free 无配额 → plan 保留、窗口为空", () => {
  const r = usageFromCreds({ free: { plan_name: "Lite" } }, { t });
  assert.equal(r.plan, "Lite");
  assert.deepEqual(r.windows, []);
});

test("free 无 used/limit → 从 model_meta 找窗口", () => {
  const r = usageFromCreds({ free: { model_meta: { used: 10, total: 1000 } } }, { t });
  assert.equal(r.windows.length, 1);
  assert.equal(r.windows[0].used, 1); // 10/1000
});

test("无 t 时降级为英文硬编码名", () => {
  const r = usageFromCreds({ free: { used: 1, limit: 2 } }, {});
  assert.equal(r.windows[0].name, "5h");
});

test("plan 缺省用 t.planFallback", () => {
  const r = usageFromCreds({ free: {} }, { t });
  assert.equal(r.plan, "InsCode 免费套餐");
});
test("usageFromBind：只保留 5 小时桶，周/月桶丢弃", () => {
  const r = usageFromBind({
    plan: "Coding Plan Free",
    planTier: "codex_free",
    periodEnd: "2027-08-03 16:30:05",
    buckets: [
      { quotaCode: "5_hour", usagePercent: 43.33, endTime: "2026-10-29 03:30:05" },
      { quotaCode: "1_week", usagePercent: 47.22, endTime: "2026-11-02 16:30:05" },
      { quotaCode: "1_month", usagePercent: 29.4, endTime: "2026-11-03 16:30:05" },
    ],
  }, { t, user: "u1" });
  assert.equal(r.plan, "Coding Plan Free");
  assert.equal(r.user, "u1");
  assert.equal(r.until, "2027-08-03 16:30:05");
  assert.equal(r.windows.length, 1);
  assert.equal(r.windows[0].name, "5 小时");
  assert.equal(r.windows[0].used, 43.33);
  assert.equal(r.windows[0].span, 5 * 3600);
  assert.equal(r.windows[0].resetsAt, "2026-10-29 03:30:05");
});

test("usageFromBind：非 5 小时桶（含未知桶名）→ 空窗口；无桶 → 空窗口", () => {
  const weird = usageFromBind({ buckets: [{ quotaCode: "x_weird", usagePercent: 10 }] }, { t });
  assert.deepEqual(weird.windows, []);
  const empty = usageFromBind({ plan: "P" }, { t });
  assert.deepEqual(empty.windows, []);
});

test("usageFromBind：used 可超 100，span 按已知桶", () => {
  const r = usageFromBind({ buckets: [{ quotaCode: "5_hour", usagePercent: 120 }] }, { t });
  assert.equal(r.windows[0].used, 120);
});
