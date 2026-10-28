import { test } from "node:test";
import assert from "node:assert/strict";

import { fill, resolveLocale, strings, LOCALES } from "../i18n.mjs";

test("zh 表在列", () => {
  assert.ok(LOCALES.includes("zh"));
  assert.ok(LOCALES.includes("en"));
  assert.equal(strings("zh").locale, "zh");
  assert.equal(strings("en").locale, "en");
});

test("fill 替换已知占位符、保留未知占位符", () => {
  assert.equal(fill("读取额度失败：{detail}", { detail: "boom" }), "读取额度失败：boom");
  assert.equal(fill("a {missing} b", {}), "a {missing} b");
});

test("resolveLocale：显式 zh/en 优先；auto 跟随机器", () => {
  assert.equal(resolveLocale("zh"), "zh");
  assert.equal(resolveLocale("en"), "en");
  assert.ok(["zh", "en"].includes(resolveLocale("auto")));
});

test("resolveLocale：从 Intl 判断", () => {
  assert.equal(resolveLocale(undefined, {}, "zh-CN"), "zh");
  assert.equal(resolveLocale(undefined, {}, "en-US"), "en");
});

test("resolveLocale：从环境变量判断（需注入 intl='' 跳过 OS 皮肤）", () => {
  assert.equal(resolveLocale(undefined, { LANG: "zh_CN.UTF-8" }, ""), "zh");
  assert.equal(resolveLocale(undefined, { LANG: "en_US.UTF-8" }, ""), "en");
  assert.equal(resolveLocale(undefined, { LANG: "C" }, ""), "en"); // POSIX 值跳过 → 兜底 en
});

test("未知 locale 回退 zh", () => {
  assert.equal(strings("fr").locale, "zh");
});