import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../extension/sidepanel.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../extension/sidepanel.css", import.meta.url), "utf8");
const js = readFileSync(new URL("../extension/sidepanel.js", import.meta.url), "utf8");

test("side panel defaults to the boarding-pass theme and exposes the transit dark theme", () => {
  assert.match(html, /<html[^>]+data-theme="gate"/);
  assert.match(html, /id="theme-gate"[^>]+aria-pressed="true"/);
  assert.match(html, /id="theme-transit"[^>]+aria-pressed="false"/);
  assert.match(css, /:root\[data-theme="transit"\]/);
  assert.match(js, /const THEME_KEY = "cuewave:theme"/);
  assert.match(js, /chrome\.storage\.local\.set\(\{ \[THEME_KEY\]: value \}\)/);
});

test("both skins keep one shared semantic workflow", () => {
  for (const id of ["probe-form", "analyze-button", "tracks", "rankings", "evidence"]) {
    assert.equal(html.match(new RegExp(`id="${id}"`, "g"))?.length, 1);
  }
  assert.doesNotMatch(html, /data-theme="transit"[^>]*>[\s\S]*id="probe-form"/);
});

test("user-facing video preparation copy does not expose the subtitle implementation", () => {
  assert.doesNotMatch(html, /字幕|SRT|VTT/);
  assert.match(html, /等待解析视频/);
  assert.match(html, /视频解析与播放器/);
  assert.match(js, /status\("解析视频中…"\)/);
  assert.match(js, /status\("已就绪，可以开始分析。"\)/);
  assert.doesNotMatch(js, /正在获取原生时间戳字幕|Supadata 原生字幕|已恢复此视频的字幕/);
});
