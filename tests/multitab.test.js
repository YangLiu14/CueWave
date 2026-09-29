import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { buildWindows } from "../extension/core.js";

test("each YouTube tab receives a dedicated side panel instead of a global fallback", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.side_panel?.default_path, undefined, "a global panel can retain another tab's UI");
  const listeners = {};
  const options = [];
  const tabs = [
    { id: 1, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { id: 2, url: "https://www.youtube.com/watch?v=9bZkp7q19f0" }
  ];
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {}, setOptions: async (value) => { options.push(value); } },
    action: { onClicked: { addListener: (callback) => { listeners.clicked = callback; } } },
    tabs: {
      query: async () => tabs,
      get: async (id) => tabs.find((tab) => tab.id === id),
      onUpdated: { addListener: (callback) => { listeners.updated = callback; } },
      onActivated: { addListener: (callback) => { listeners.activated = callback; } }
    },
    runtime: { onInstalled: { addListener: (callback) => { listeners.installed = callback; } },
      onStartup: { addListener: (callback) => { listeners.startup = callback; } } }
  };
  runInNewContext(readFileSync(new URL("../extension/background.js", import.meta.url), "utf8"), { chrome, URL });
  assert.equal(typeof listeners.updated, "function");
  await listeners.updated(1, { status: "complete" }, tabs[0]);
  await listeners.updated(2, { status: "complete" }, tabs[1]);
  assert.ok(options.some((item) => item.tabId === 1 && item.path === "sidepanel.html?tabId=1" && item.enabled));
  assert.ok(options.some((item) => item.tabId === 2 && item.path === "sidepanel.html?tabId=2" && item.enabled));
  await listeners.updated(2, { url: "https://example.org" }, { id: 2, url: "https://example.org" });
  assert.equal(options.at(-1).tabId, 2);
  assert.equal(options.at(-1).enabled, false);
});

test("a side panel binds to its own tab even if another YouTube tab is active", async () => {
  const nodes = new Map();
  const element = () => ({ textContent: "", style: {}, classList: { toggle() {}, add() {} }, replaceChildren() {},
    append() {}, addEventListener() {}, setAttribute() {}, remove() {} });
  globalThis.document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    querySelectorAll() { return []; }, createElement: element };
  globalThis.location = { search: "?tabId=1" };
  const tabs = [
    { id: 1, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "视频 A" },
    { id: 2, url: "https://www.youtube.com/watch?v=9bZkp7q19f0", title: "视频 B" }
  ];
  globalThis.chrome = {
    tabs: { query: async () => [tabs[1]], get: async (id) => tabs.find((tab) => tab.id === id),
      sendMessage: async (id, message) => message.action === "cuewave:info"
        ? { videoId: new URL(tabs.find((tab) => tab.id === id).url).searchParams.get("v"),
            title: tabs.find((tab) => tab.id === id).title, durationMs: 120000 } : {} },
    storage: { local: { get: async () => ({}), getBytesInUse: async () => 0, QUOTA_BYTES: 10485760 } },
    runtime: { onMessage: { addListener() {} } }
  };
  globalThis.fetch = async () => ({ json: async () => ({ capabilities: { manualProbes: true, jev: false, supadata: false } }) });
  await import(`../extension/sidepanel.js?tab-identity-${Date.now()}`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(nodes.get("video-title").textContent, "视频 A");
  assert.equal(nodes.get("video-meta").textContent.startsWith("dQw4w9WgXcQ"), true);
});

test("reopening a partial analysis resumes only pending windows", async () => {
  const nodes = new Map();
  const element = () => ({ textContent: "", style: {}, listeners: {}, classList: { toggle() {}, add() {} }, replaceChildren() {},
    append() {}, addEventListener(type, listener) { this.listeners[type] = listener; }, setAttribute() {}, remove() {} });
  globalThis.document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    querySelectorAll() { return []; }, createElement: element };
  globalThis.location = { search: "?tabId=1" };
  const tab = { id: 1, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "断点续跑视频" };
  const segments = [{ id: "s0", startMs: 0, endMs: 5000, text: "已完成片段" },
    { id: "s1", startMs: 12000, endMs: 17000, text: "待分析片段" }];
  const windows = buildWindows(segments, 24000);
  const probe = { id: "p", name: "具体程度", input: "具体程度", color: "#5ddbc8", enabled: true,
    primitive: "noul", description: "是否具体", criterion: "具体才命中", positive: "具体", negative: "空泛" };
  const record = { videoId: "dQw4w9WgXcQ", title: tab.title, durationMs: 24000, source: "SRT", segments, windows,
    probes: [probe], selectedId: "p", readings: [{ id: "w0:p", windowId: "w0", probeId: "p", imported: true,
      startMs: 0, endMs: 12000, text: "已完成片段", status: "ok", value: .8, raw: .8, label: "80% 命题概率" }],
    adCueReadings: [], adBoundaries: [], usage: { inputTokens: 20, requests: 1, reportedRequests: 1 },
    resumeOnOpen: true, savedAt: "2026-09-27T00:00:00.000Z" };
  const storage = { "cuewave:video:dQw4w9WgXcQ": record, "cuewave:historyIndex": [] };
  const requests = [];
  let onMessage;
  let releaseDecision;
  let decisionReady = new Promise((resolve) => { releaseDecision = resolve; });
  globalThis.chrome = {
    tabs: { get: async () => tab, sendMessage: async (_id, message) => message.action === "cuewave:info"
      ? { videoId: "dQw4w9WgXcQ", title: tab.title, durationMs: 24000 } : {} },
    storage: { local: { get: async (key) => Object.fromEntries((Array.isArray(key) ? key : [key]).map((name) => [name, storage[name]])),
      set: async (items) => { Object.assign(storage, items); }, getBytesInUse: async () => 100, QUOTA_BYTES: 10485760 } },
    runtime: { onMessage: { addListener(listener) { onMessage = listener; } } }
  };
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/health")) return { ok: true, json: async () => ({ capabilities: { manualProbes: true, jev: true, supadata: false } }) };
    requests.push(JSON.parse(options.body));
    await decisionReady;
    return { ok: true, json: async () => ({ answers: [{ probeId: "p", model: "jev-1.13.0", raw: .9,
      value: .9, label: "90% 命题概率", confidence: null }], usage: { inputTokens: 50 } }) };
  };
  await import(`../extension/sidepanel.js?resume-${Date.now()}`);
  for (let attempt = 0; attempt < 30 && !requests.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(requests.length, 1);
  onMessage({ action: "cuewave:navigated", videoId: "9bZkp7q19f0" }, { tab: { id: 2 } });
  releaseDecision();
  for (let attempt = 0; attempt < 30 && storage["cuewave:video:dQw4w9WgXcQ"].readings.length < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(requests.map((request) => request.window.text), ["待分析片段"]);
  assert.equal(storage["cuewave:video:dQw4w9WgXcQ"].readings.length, 2);
  assert.equal(storage["cuewave:video:dQw4w9WgXcQ"].resumeOnOpen, false);
  storage["cuewave:video:dQw4w9WgXcQ"] = { ...record, resumeOnOpen: false };
  requests.length = 0;
  await import(`../extension/sidepanel.js?paused-${Date.now()}`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(requests, [], "a manually paused analysis must not restart when reopened");
  decisionReady = new Promise((resolve) => { releaseDecision = resolve; });
  nodes.get("analyze-button").listeners.click();
  for (let attempt = 0; attempt < 30 && !requests.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(requests.length, 1);
  nodes.get("cancel-button").listeners.click();
  for (let attempt = 0; attempt < 30 && storage["cuewave:video:dQw4w9WgXcQ"].resumeOnOpen; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(storage["cuewave:video:dQw4w9WgXcQ"].resumeOnOpen, false);
  releaseDecision();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(storage["cuewave:video:dQw4w9WgXcQ"].readings.length, 1);
});

test("a saved hotspot restores the YouTube receiver before drawing and seeking", async () => {
  const nodes = new Map();
  const element = (tagName = "div") => ({ tagName: tagName.toUpperCase(), textContent: "", style: {}, children: [], listeners: {},
    classList: { toggle() {}, add() {} }, replaceChildren(...items) { this.children = items; },
    append(...items) { this.children.push(...items); }, addEventListener(type, listener) { this.listeners[type] = listener; },
    setAttribute() {}, remove() {} });
  globalThis.document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    querySelectorAll() { return []; }, createElement: element };
  globalThis.location = { search: "?tabId=1" };
  const videoId = "7xTGNNLPyMI";
  const durationMs = 12683321;
  const tab = { id: 1, url: `https://www.youtube.com/watch?v=${videoId}`, title: "长视频" };
  const segments = [{ id: "s0", startMs: 0, endMs: 5000, text: "已分析的开头" }];
  const windows = buildWindows(segments, durationMs);
  const probe = { id: "p", name: "具体程度", color: "#5ddbc8", enabled: true, primitive: "noul",
    criterion: "具体", description: "是否具体", positive: "是", negative: "否" };
  const record = { videoId, title: tab.title, durationMs, source: "SRT", segments, windows,
    probes: [probe], selectedId: "p", readings: [{ id: "w0:p", windowId: "w0", probeId: "p", imported: true,
      startMs: 0, endMs: 12000, text: "已分析的开头", status: "ok", value: .95, raw: .95, label: "95% 命题概率" }],
    resumeOnOpen: false, savedAt: "2026-09-27T00:00:00.000Z" };
  const storage = { [`cuewave:video:${videoId}`]: record };
  let receiverInstalled = false;
  let injections = 0;
  let graphDelivered = 0;
  let seekDelivered = 0;
  let seekAcknowledged = true;
  globalThis.chrome = {
    tabs: { get: async () => tab, sendMessage: async (_id, message) => {
      if (!receiverInstalled) throw new Error("Could not establish connection. Receiving end does not exist.");
      if (message.action === "cuewave:info") return { videoId, title: tab.title, durationMs };
      if (message.action === "cuewave:graph") { graphDelivered++; return { ok: true }; }
      if (message.action === "cuewave:seek") { seekDelivered++; return { ok: seekAcknowledged }; }
      return { ok: true };
    } },
    scripting: { insertCSS: async ({ target, files }) => {
      assert.equal(target.tabId, 1);
      assert.deepEqual(files, ["content.css"]);
    }, executeScript: async ({ target, files }) => {
      assert.equal(target.tabId, 1);
      assert.deepEqual(files, ["content.js"]);
      injections++;
      receiverInstalled = true;
    } },
    storage: { local: { get: async (key) => key == null ? storage : Object.fromEntries((Array.isArray(key) ? key : [key]).map((name) => [name, storage[name]])),
      set: async (items) => { Object.assign(storage, items); }, getBytesInUse: async () => 100, QUOTA_BYTES: 10485760 } },
    runtime: { onMessage: { addListener() {} } }
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ capabilities: { manualProbes: true, jev: false, supadata: false } }) });
  await import(`../extension/sidepanel.js?missing-receiver-${Date.now()}`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const rankings = nodes.get("rankings");
  assert.ok(rankings.children[0]?.children.some((item) => item.className === "hotspot"), "saved hotspot should remain visible");
  const hotspot = rankings.children[0].children.find((item) => item.className === "hotspot");
  hotspot.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(graphDelivered > 0, true, "saved readings should reach the player after recovering its receiver");
  assert.equal(injections, 1, "a missing receiver should only be injected once");
  assert.equal(seekDelivered, 1, "clicking the saved hotspot should seek the player");
  const firstCell = nodes.get("tracks").children[0].children[1].children[0];
  assert.equal(nodes.get("tracks").children[0].children[1].tagName, "BUTTON", "the full timeline lane is the accessible hit target");
  assert.ok(nodes.get("tracks").children[0].children[1].children.some((item) => item.className === "station"), "transit stations must come from ranked hotspots");
  assert.equal(firstCell.tagName, "SPAN", "narrow histogram bars must not pretend to be standalone tap targets");
  assert.ok(parseFloat(firstCell.style.minWidth) >= 8, "an analyzed long-video window stays visible without distorting time alignment");
  assert.ok(Number(firstCell.style.zIndex) > 0, "pending windows must not cover the completed one");
  firstCell.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(seekDelivered, 2, "clicking the completed timeline window should seek the player");
  seekAcknowledged = false;
  hotspot.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(seekDelivered, 3);
  assert.equal(nodes.get("player-status").hidden, false, "rejected seeks need a visible error");
  assert.match(nodes.get("player-status").textContent, /播放器跳转失败/);
});
