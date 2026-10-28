/**
 * Free-quota → Magpie `auth.usage` mapping.
 *
 * The taotoken gateway only exposes an OpenAI-compatible chat API; a dedicated
 * quota/usage endpoint is NOT verified (see README). Rather than fabricate
 * numbers, this builds a usage payload from the free-quota counters that DO
 * live in the local `taotoken.json`, and degrades to `windows: []` when none
 * are present. Magpie renders the plan row either way, so the account still
 * shows up under `magpie quota`.
 *
 * `auth.usage` percentages may legitimately exceed 100 — Magpie renders that.
 *
 * @module magpie-inscode/quota
 */

import { fill } from "./i18n.mjs";

/** Numeric if finite (0 included), else undefined. */
export function num(v) {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** The default rolling window taotoken free quota is known to use (5 hours). */
export const DEFAULT_WINDOW_SECONDS = 5 * 3600;
export const DEFAULT_WINDOW_HOURS = 5;

/** Scan an object for the first `{ used, limit }`-shaped quota pair. */
function findWindow(obj) {
  if (!obj || typeof obj !== "object") return null;
  const rawUsed = num(obj.used) ?? num(obj.usage);
  const limit = num(obj.limit) ?? num(obj.total) ?? num(obj.quota);
  if (rawUsed !== undefined && limit !== undefined) {
    return { used: rawUsed, limit };
  }
  return null;
}

/** The `auth.usage` payload for one account, derived from its local creds. */
export function usageFromCreds(c, { t, user } = {}) {
  const free = c?.free ?? {};
  const plan = free.plan_name || free.plan || t?.planFallback || "";
  const windows = [];

  const pushWindow = (w) => {
    if (t) {
      windows.push({
        name: fill(t.windowHours, { hours: DEFAULT_WINDOW_HOURS }),
        used: (w.used / w.limit) * 100,
        span: DEFAULT_WINDOW_SECONDS,
        amount: w.used,
        ...(t ? { display: fill(t.callsOf, { used: w.used, total: w.limit }) } : {}),
        ...(w.limit ? { limit: w.limit } : {}),
        unit: "calls",
      });
    } else {
      windows.push({
        name: `${DEFAULT_WINDOW_HOURS}h window`,
        used: (w.used / w.limit) * 100,
        span: DEFAULT_WINDOW_SECONDS,
        amount: w.used,
        limit: w.limit,
        unit: "calls",
      });
    }
  };

  // 1) A used/limit pair directly on `free`.
  const w = findWindow(free);
  if (w) pushWindow(w);

  // 2) A used/limit pair inside `free.model_meta` (if the client records it).
  const meta = free.model_meta && typeof free.model_meta === "object" ? free.model_meta : null;
  if (!windows.length && meta) {
    const mw = findWindow(meta);
    if (mw) pushWindow(mw);
  }

  return {
    plan: String(plan || t?.planFallback || ""),
    ...(user ? { user } : {}),
    windows,
  };
}

/** Map a `codingPlan.quotaCode` to its rolling-window label key and length. */
const BUCKET_LABELS = { "5_hour": "bucketFiveHour", "1_week": "bucketWeek", "1_month": "bucketMonth" };
const BUCKET_HOURS = { "5_hour": 5, "1_week": 168, "1_month": 720 };

/**
 * The `auth.usage` payload for an account signed in via OAuth: map the
 * `codingPlan.buckets` (5-hour / 7-day / 30-day windows with `usagePercent`)
 * onto Magpie quota windows.
 *
 * `used` may legitimately exceed 100 — Magpie renders that. `until` is the
 * plan period end.
 *
 * @param {{plan?: string, planTier?: string, buckets?: object[], periodEnd?: string}} meta
 * @param {{t?: object, user?: string}} [ctx]
 */
export function usageFromBind(meta = {}, { t, user } = {}) {
  const buckets = Array.isArray(meta.buckets) ? meta.buckets : [];
  const windows = buckets
    .map((b) => {
      if (!b || typeof b !== "object") return null;
      const code = String(b.quotaCode || "");
      const hours = BUCKET_HOURS[code];
      const labelKey = BUCKET_LABELS[code];
      const name = t?.[labelKey]
        ? t[labelKey]
        : fill(t?.bucketGeneric || "{code} window", { code });
      const used = num(b.usagePercent);
      return {
        name,
        ...(used !== undefined ? { used } : {}),
        ...(hours ? { span: hours * 3600 } : {}),
        ...(typeof b.endTime === "string" && b.endTime ? { resetsAt: b.endTime } : {}),
      };
    })
    .filter(Boolean);

  return {
    plan: meta.plan || meta.planTier || t?.planFallback || "",
    ...(user ? { user } : {}),
    ...(typeof meta.periodEnd === "string" && meta.periodEnd ? { until: meta.periodEnd } : {}),
    windows,
  };
}