import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addProject, commitFinal, createLiveSession, liveSessionKey, liveSessionSnapshot } from "../extension/live-core.js";

test("result and live pages expose the controls used by their scripts", () => {
  const results = readFileSync(new URL("../extension/results.html", import.meta.url), "utf8");
  const live = readFileSync(new URL("../extension/live.html", import.meta.url), "utf8");
  const sidepanel = readFileSync(new URL("../extension/sidepanel.html", import.meta.url), "utf8");
  for (const html of [results, live, sidepanel]) assert.doesNotMatch(html, /现场\s*Pitch|LIVE PITCH|每一句 Pitch/i);
  assert.match(live, /实时判断/);
  for (const id of ["sessions", "result-title", "result-subtitle", "record-state", "project-tabs", "overview",
    "probe-results", "result-transcript", "result-hotspots", "result-evidence", "download", "delete", "back-live", "result-notice"])
    assert.match(results, new RegExp(`id="${id}"`));
  for (const id of ["view-results", "storage-warning", "next-project", "stop"])
    assert.match(live, new RegExp(`id="${id}"`));
});

test("results page renders saved transcript, probe distribution and project selection", async () => {
  class Node {
    constructor(tag = "div") { this.tag = tag; this.children = []; this.listeners = {}; this.style = {}; this.hidden = false; this._text = "";
      this.classList = { toggle() {} }; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map((child) => child.textContent || "").join(""); }
    get childElementCount() { return this.children.length; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this._text = ""; this.children = children; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    setAttribute() {}
  }
  const ids = new Map();
  const document = { getElementById(id) { if (!ids.has(id)) ids.set(id, new Node()); return ids.get(id); },
    createElement(tag) { return new Node(tag); }, createTextNode(text) { const node = new Node("text"); node.textContent = text; return node; } };
  const session = createLiveSession(0);
  commitFinal(session, "第一项目：我们服务餐厅。", 2000);
  addProject(session, 3000);
  commitFinal(session, "第二项目：颠覆整个生态。", 5000);
  session.readings.push({ id: "r1", windowId: "w1", probeId: "empty", projectId: "project-1", status: "ok", value: .5,
    label: "50/100 强度", text: session.segments[0].text, startMs: 0, endMs: 2000 });
  session.readings.push({ id: "r2", windowId: "w2", probeId: "empty", projectId: "project-2", status: "ok", value: 1,
    label: "100/100 强度", text: session.segments[1].text, startMs: 3000, endMs: 5000 });
  session.endedAt = "2026-09-27T12:00:00.000Z";
  const record = liveSessionSnapshot(session, [{ id: "empty", name: "空洞概念", color: "#a895f2", primitive: "score" }], 6000);
  const storage = new Map([[liveSessionKey(session.id), record]]);
  let onStorageChange;
  const previous = { document: globalThis.document, chrome: globalThis.chrome, location: globalThis.location,
    history: globalThis.history, window: globalThis.window };
  globalThis.document = document;
  globalThis.chrome = { storage: { local: { async get() { return Object.fromEntries(storage); }, async remove(key) { storage.delete(key); } },
    onChanged: { addListener(callback) { onStorageChange = callback; } } }, runtime: { getURL(path) { return `chrome-extension://test/${path}`; } }, tabs: { async query() { return []; } } };
  globalThis.location = { search: `?sessionId=${session.id}&projectId=project-1`, href: `chrome-extension://test/results.html?sessionId=${session.id}&projectId=project-1` };
  globalThis.history = { replaceState() {} };
  globalThis.window = { confirm() { return false; } };
  try {
    await import("../extension/results.js?results-page-test");
    assert.match(ids.get("result-title").textContent, /项目 1/);
    assert.equal(ids.get("result-transcript").children.length, 1);
    assert.match(ids.get("result-transcript").textContent, /第一项目/);
    assert.match(ids.get("probe-results").textContent, /均值 50\/100/);
    assert.equal(ids.get("probe-results").children[0].children[1].children.length, 1, "the saved Jev reading has a timeline bar");
    assert.equal(ids.get("delete").disabled, false);
    ids.get("project-tabs").children[2].listeners.click();
    assert.match(ids.get("result-title").textContent, /项目 2/);
    assert.match(ids.get("result-transcript").textContent, /第二项目/);
    assert.doesNotMatch(ids.get("result-transcript").textContent, /第一项目/);
    assert.match(ids.get("probe-results").textContent, /均值 100\/100/);
    storage.set(liveSessionKey(session.id), { ...record, analysisPending: true, readings: [...record.readings,
      { id: "r3", windowId: "w3", probeId: "empty", projectId: "project-2", status: "ok", value: .5,
        label: "50/100 强度", text: "补充说明", startMs: 5000, endMs: 5500 }] });
    onStorageChange({ [liveSessionKey(session.id)]: {} }, "local");
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(ids.get("probe-results").textContent, /均值 75\/100/, "results refresh as later Jev readings arrive");
    assert.equal(ids.get("delete").disabled, true, "a result cannot be deleted while Jev may still write it");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
