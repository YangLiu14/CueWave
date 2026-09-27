import test from "node:test";
import assert from "node:assert/strict";
import { parseCaptions, buildWindows, subtitleCoverageMs, readingValue, rankHotspots, progress } from "../extension/core.js";

test("SRT/VTT retain milliseconds and expose gaps as no_text", () => {
  const srt = `1\n00:00:00,250 --> 00:00:02,750\n具体方法是先测量\n\n2\n00:00:26,100 --> 00:00:29,900\n然后再复测\n`;
  const segments = parseCaptions(srt);
  assert.equal(segments[0].startMs, 250);
  assert.equal(segments[1].endMs, 29900);
  const windows = buildWindows(segments, 36000);
  assert.deepEqual(windows.map((w) => w.status), ["pending", "no_text", "pending"]);
  assert.equal(windows[2].text, "然后再复测");
  assert.deepEqual(subtitleCoverageMs(segments, 36000), { coveredMs: 6300, durationMs: 36000, percent: 18 });
  assert.equal(parseCaptions("WEBVTT\n\n00:00:01.125 --> 00:00:02.500\nHello")[0].startMs, 1125);
});

test("Score and Noul retain different meaning; missing values fail", () => {
  const score = { id: "a", primitive: "score", criteria: ["low", "mid", "high"] };
  const noul = { id: "b", primitive: "noul" };
  assert.deepEqual(readingValue({ type: "score", score: 1.5, confidence: .8 }, score), { raw: 1.5, value: .75, label: "75/100 强度", confidence: .8 });
  assert.deepEqual(readingValue({ type: "noul", noul: .8 }, noul), { raw: .8, value: .8, label: "80% 命题概率", confidence: null });
  assert.throws(() => readingValue({ type: "noul" }, noul));
  assert.throws(() => readingValue({ type: "score", score: 3 }, score));
});

test("each probe ranks independently and merges adjacent hit windows", () => {
  const readings = [
    { probeId: "a", status: "ok", startMs: 0, endMs: 12000, value: .8 },
    { probeId: "a", status: "ok", startMs: 12000, endMs: 24000, value: .9 },
    { probeId: "a", status: "ok", startMs: 24000, endMs: 36000, value: .1 },
    { probeId: "a", status: "ok", startMs: 36000, endMs: 48000, value: .95 },
    { probeId: "b", status: "ok", startMs: 24000, endMs: 36000, value: .99 }
  ];
  const a = rankHotspots(readings, { id: "a", primitive: "score" });
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((h) => h.startMs), [36000, 0]);
  assert.equal(a[1].endMs, 24000);
  assert.deepEqual(rankHotspots(readings, { id: "b", primitive: "noul" }).map((h) => h.startMs), [24000]);
  assert.deepEqual(progress([{ id: "w0", status: "pending" }, { id: "w1", status: "no_text" }], [{ windowId: "w0", probeId: "a", status: "ok" }, { windowId: "w0", probeId: "b", status: "failed" }, { windowId: "old", probeId: "a", status: "ok" }], [{ id: "a" }, { id: "b" }]), { total: 2, done: 2, ok: 1, failed: 1, noText: 1 });
});
