/**
 * UI strings, zh and en.
 *
 * These labels land in Magpie's own account card, in `magpie quota`, and in the
 * sign-in flow, so they are user-visible, not decoration. The language is the
 * plugin's `locale` option, defaulting to following the machine.
 *
 * @module magpie-inscode/i18n
 */

/** The languages with a string table here. */
export const LOCALES = ["zh", "en"];

const ZH = {
  locale: "zh",

  methodLabel: "InsCode 浏览器登录",
  methodLabelLocal: "InsCode 本机凭据",
  configDirPrompt: "InsCode 凭据目录",
  configDirPlaceholder: "默认 ~/.config/inscode",
  missingKey: "未找到 free.api_key（taotoken.json，目录 {dir}），请先在本机用 InsCode 客户端登录",
  loginInstructions: "浏览器将打开 {url} 完成授权；授权完成后会自动回到这里。",
  loginNotBound: "会话正在绑定中，请保持浏览器页面并稍候",
  loginTimedOut: "登录超时（等待会话绑定超时），请重试",
  bindFailed: "无法绑定 InsCode 会话，请重试",
  sessionExpired: "授权链接已过期或已被使用，请重新登录",
  bindUnauthorized: "无法确认授权会话（设备未通过），请更新插件后重试",
  reloginRequired: "InsCode 登录已失效，请重新登录",
  noAccount: "没有已登录的 InsCode 账号",
  planFallback: "InsCode 免费套餐",

  usageFailed: "读取额度失败：{detail}",

  windowHours: "{hours} 小时额度",
  callsOf: "{used} / {total} 次",
  bucketFiveHour: "5 小时窗口",
  bucketWeek: "7 天窗口",
  bucketMonth: "30 天窗口",
  bucketGeneric: "{code} 窗口",

  modelsUnavailable: "模型目录暂时不可用，沿用内置列表",
  modelListEmpty: "模型目录为空，沿用内置列表",

  checkinNotConfigured: "未配置签到端点（INCODE2API_CHECKIN_URL）",
  checkinDone: "今天已签到",
  checkinFailedHttp: "签到返回 {status}",
};

const EN = {
  locale: "en",

  methodLabel: "InsCode sign-in (browser)",
  methodLabelLocal: "InsCode local credentials",
  configDirPrompt: "InsCode credential directory",
  configDirPlaceholder: "defaults to ~/.config/inscode",
  missingKey: "No free.api_key (taotoken.json, dir {dir}); sign in with the InsCode client on this machine first",
  loginInstructions: "Your browser will open {url} to authorize; after authorizing it comes back here automatically.",
  loginNotBound: "The session is still binding; keep the browser page open",
  loginTimedOut: "Sign-in timed out (waiting for the session to bind); please retry",
  bindFailed: "Could not bind the InsCode session; please retry",
  sessionExpired: "The authorization link expired or was already used; please sign in again",
  bindUnauthorized: "Could not confirm the authorization session (device rejected); update the plugin and retry",
  reloginRequired: "The InsCode sign-in has expired; please sign in again",
  noAccount: "No signed-in InsCode account",
  planFallback: "InsCode free plan",

  usageFailed: "Reading the quota failed: {detail}",

  windowHours: "{hours}h window",
  callsOf: "{used} / {total} calls",
  bucketFiveHour: "5h window",
  bucketWeek: "7d window",
  bucketMonth: "30d window",
  bucketGeneric: "{code} window",

  modelsUnavailable: "The model catalog is unavailable; keeping the built-in list",
  modelListEmpty: "The model catalog is empty; keeping the built-in list",

  checkinNotConfigured: "No check-in endpoint configured (INCODE2API_CHECKIN_URL)",
  checkinDone: "Already checked in today",
  checkinFailedHttp: "Check-in returned {status}",
};

const TABLES = { zh: ZH, en: EN };

/**
 * Fill `{name}` placeholders. Unknown names are left as they are, so a missing
 * string shows up in the UI instead of turning into "undefined".
 */
export function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
    key in values ? String(values[key]) : whole
  );
}

/** The table for a resolved locale. */
export function strings(locale = "zh") {
  return TABLES[locale] ?? ZH;
}

/** The OS locale as Node reports it, or "" when there is nothing to report. */
function osLocale() {
  try {
    return typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function"
      ? Intl.DateTimeFormat().resolvedOptions().locale
      : "";
  } catch {
    return "";
  }
}

/**
 * Decide the locale.
 *
 * `Intl` first (reflects OS settings on every platform including Windows, where
 * `LANG` is usually unset), then the environment as a fallback for a Node built
 * without ICU; a POSIX `C`/`POSIX` value is skipped rather than misread.
 *
 * @param {string|undefined} value - the `locale` option: `"auto"`, `"zh"`, or `"en"`.
 * @param {object} [env] - environment to read, injected for testing.
 * @param {string} [intl] - the OS locale, injected for testing.
 * @returns {"zh"|"en"}
 */
export function resolveLocale(value, env = process.env, intl = osLocale()) {
  if (value === "zh" || value === "en") return value;
  if (value && value !== "auto") {
    const explicit = String(value).toLowerCase();
    if (explicit.startsWith("zh")) return "zh";
    if (explicit.startsWith("en")) return "en";
  }

  if (/^zh/i.test(intl)) return "zh";
  if (/^en/i.test(intl)) return "en";

  for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const raw = env?.[key];
    if (typeof raw !== "string") continue;
    const tag = raw.trim().split(".")[0].split("_")[0].toLowerCase();
    if (!tag || tag === "c" || tag === "posix") continue;
    if (tag.startsWith("zh")) return "zh";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}