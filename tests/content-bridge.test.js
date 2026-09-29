import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("the injected YouTube receiver draws a saved graph and acknowledges seeks", () => {
  let onMessage;
  let onMutation;
  let progressReady = false;
  const element = () => ({ id: "", style: {}, children: [], parentElement: null, isConnected: true,
    classList: { add() {}, remove() {} }, listeners: {},
    append(child) { child.parentElement = this; this.children.push(child); },
    replaceChildren(...children) { this.children = []; children.forEach((child) => this.append(child)); },
    addEventListener(type, callback) { this.listeners[type] = callback; },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); this.parentElement = null; } });
  const progress = element();
  const video = { duration: 12683.321, currentTime: 0 };
  const document = { documentElement: element(), querySelector(selector) {
    if (selector === ".ytp-progress-bar-container") return progressReady ? progress : null;
    if (selector === "video.html5-main-video") return video;
    return null;
  }, createElement: element, addEventListener() {} };
  const chrome = { runtime: { sendMessage: async () => {}, onMessage: { addListener(callback) { onMessage = callback; } } } };
  class MutationObserver { constructor(callback) { onMutation = callback; } observe() {} }
  runInNewContext(readFileSync(new URL("../extension/content.js", import.meta.url), "utf8"), {
    document, chrome, MutationObserver, URL, location: { href: "https://www.youtube.com/watch?v=7xTGNNLPyMI" },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}
  });
  const graph = { videoId: "7xTGNNLPyMI", durationMs: 12683321, selectedId: "p",
    probes: [{ id: "p", name: "具体程度", color: "#5ddbc8" }],
    readings: [{ id: "w12000:p", probeId: "p", status: "ok", startMs: 12000, endMs: 24000, value: .9, label: "90%" }] };
  let response;
  onMessage({ action: "cuewave:graph", graph }, {}, (value) => { response = value; });
  assert.equal(response.ok, true);
  assert.equal(progress.children.length, 0, "the graph waits for YouTube's progress node");
  progressReady = true;
  onMutation();
  assert.equal(progress.children[0].id, "cuewave-histogram");
  const bars = progress.children[0].children.filter((child) => child.className?.startsWith("cw-bar"));
  assert.equal(bars.length, 1);
  assert.equal(bars[0].className, "cw-bar positive");
  onMessage({ action: "cuewave:seek", videoId: graph.videoId, ms: 70000 }, {}, (value) => { response = value; });
  assert.equal(response.ok, true);
  assert.equal(video.currentTime, 70);
});

test("a stale YouTube content script survives an invalidated extension context", () => {
  let navigated;
  let sends = 0;
  const location = { href: "https://www.youtube.com/watch?v=7xTGNNLPyMI" };
  const document = { documentElement: {}, querySelector() { return null; },
    addEventListener(type, callback) { if (type === "yt-navigate-finish") navigated = callback; } };
  const chrome = { runtime: { sendMessage() { sends++; throw new Error("Extension context invalidated."); },
    onMessage: { addListener() {} } } };
  class MutationObserver { observe() {} }
  assert.doesNotThrow(() => runInNewContext(readFileSync(new URL("../extension/content.js", import.meta.url), "utf8"), {
    document, chrome, MutationObserver, URL, location, clearInterval() {}
  }));
  location.href = "https://www.youtube.com/watch?v=9bZkp7q19f0";
  assert.doesNotThrow(() => navigated());
  assert.equal(sends, 1, "do not keep calling a dead extension runtime");
});
