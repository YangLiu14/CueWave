import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../extension/sidepanel.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../extension/sidepanel.css", import.meta.url), "utf8");
const js = readFileSync(new URL("../extension/sidepanel.js", import.meta.url), "utf8");
const contentCss = readFileSync(new URL("../extension/content.css", import.meta.url), "utf8");
const contentJs = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");

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

test("preset probes stay visible in the primary workflow and wrap instead of clipping", () => {
  assert.equal(html.match(/class="seed"/g)?.length, 7);
  assert.ok(html.indexOf('class="preset-probes"') < html.indexOf('id="probe-lines"'));
  assert.match(css, /\.seed-strip\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.doesNotMatch(css, /\.seed-strip\s*\{[^}]*overflow-x:\s*auto/);
});

test("probe definition mode exposes one destructive cancel action", () => {
  assert.match(js, /className = "cancel-definition"/);
  assert.match(js, /取消添加探针/);
  assert.match(js, /取消修改/);
  assert.match(readFileSync(new URL("../extension/manual.css", import.meta.url), "utf8"), /\.cancel-definition[^}]*var\(--danger\)/);
  assert.doesNotMatch(js, /重新输入探针|这些定义不合适/);
});

test("probe labels and histograms expose positive and negative direction", () => {
  assert.match(html, /data-value="推广信息" data-polarity="negative"/);
  assert.match(html, /推广信息[\s\S]*seed-direction[^>]*>↓</);
  assert.match(js, /反向 ↓/);
  assert.match(js, /classList\.toggle\("negative-track"/);
  assert.match(css, /\.negative-track \.cell\s*\{[^}]*top:\s*50%[^}]*bottom:\s*auto/);
  assert.match(contentJs, /cw-bar\$\{negative \? " negative" : " positive"\}/);
  assert.match(contentCss, /\.cw-bar\.negative\s*\{[^}]*top:\s*50%[^}]*bottom:\s*auto/);
});

test("the transit theme keeps histogram bars instead of reducing results to stations", () => {
  assert.match(js, /className = `peak-marker/);
  assert.match(js, /className = "cue-cursor"/);
  assert.doesNotMatch(js, /className = "station"/);
  assert.doesNotMatch(css, /\.station\s*\{/);
  assert.match(css, /:root\[data-theme="transit"\] \.peak-marker/);
});

test("user-facing video preparation copy does not expose the subtitle implementation", () => {
  assert.doesNotMatch(html, /字幕|SRT|VTT/);
  assert.match(html, /等待解析视频/);
  assert.match(html, /视频解析与播放器/);
  assert.match(js, /status\("解析视频中…"\)/);
  assert.match(js, /status\("已就绪，可以开始分析。"\)/);
  assert.doesNotMatch(js, /正在获取原生时间戳字幕|Supadata 原生字幕|已恢复此视频的字幕/);
});
