/**
 * InsCode daily check-in.
 *
 * The taotoken gateway's exact check-in endpoint is NOT verified (see README).
 * To stay honest and non-destructive, the hook only acts when the user wires a
 * real endpoint through `INCODE2API_CHECKIN_URL` (POST, Bearer auth). Without
 * it the hook reports `inactive` — no retries, no log spam, no wrong claims.
 * When the real endpoint is confirmed, set that env var (or hard-code it here).
 *
 * @module magpie-inscode/checkin
 */

import { fill } from "./i18n.mjs";

/** Build the `auth.checkin` hook, localized with an i18n table. */
export function createCheckin(t) {
  return async function checkin(getAuth) {
    const url = process.env.INCODE2API_CHECKIN_URL;
    if (!url) return { outcome: "inactive", message: t.checkinNotConfigured };
    const auth = await getAuth();
    if (auth?.type !== "api") return { outcome: "failed", message: t.noAccount };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${auth.key}`,
          "content-type": "application/json",
        },
      });
      if (!res.ok) return { outcome: "failed", message: fill(t.checkinFailedHttp, { status: res.status }) };
      const body = await res.json().catch(() => ({}));
      if (body && (body.claimed === true || body.code === 0)) {
        return {
          outcome: "claimed",
          ...(num(body.credit) !== undefined ? { credit: num(body.credit) } : {}),
          ...(num(body.streak) !== undefined ? { streak: num(body.streak) } : {}),
          ...(body.message ? { message: body.message } : {}),
        };
      }
      return { outcome: "done", message: body?.message || t.checkinDone };
    } catch (e) {
      return { outcome: "failed", message: (e && e.message) || String(e) };
    }
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}