import test from "node:test";
import assert from "node:assert/strict";
import { parseCaptions, buildWindows, buildVideoExport, subtitleCoverageMs, readingValue, rankHotspots, progress } from "../extension/core.js";

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

test("saved video export aligns full subtitles and per-probe readings on one millisecond timeline", () => {
  const segments = parseCaptions("1\n00:00:00,250 --> 00:00:02,750\n先点击设置\n\n2\n00:00:26,100 --> 00:00:29,900\n然后点击保存\n");
  const windows = buildWindows(segments, 36000);
  const probes = [{ id: "steps", name: "实操步骤", primitive: "noul", criterion: "有具体动作" },
    { id: "detail", name: "具体程度", primitive: "score", criterion: "有具体细节", criteria: ["低", "中", "高"] }];
  const readings = [
    { windowId: "w0", probeId: "steps", status: "ok", model: "jev-1.13.0", raw: .98, value: .98, label: "98% 命题概率", confidence: null },
    { windowId: "w0", probeId: "detail", status: "ok", model: "jev-1.13.0", raw: 1.5, value: .75, label: "75/100 强度", confidence: .9 },
    { windowId: "w24000", probeId: "detail", status: "failed", error: "供应商请求失败" },
    { windowId: "w0", probeId: "removed-probe", status: "ok", raw: .8, value: .8 }
  ];
  const exported = buildVideoExport({ videoId: "dQw4w9WgXcQ", title: "演示视频", durationMs: 36000, source: "SRT", segments, windows,
    probes, readings, savedAt: "2026-09-27T00:00:00.000Z" });
  const saved = JSON.parse(JSON.stringify(exported));
  assert.equal(saved.video.durationMs, 36000);
  assert.deepEqual(saved.transcript.segments.map((s) => [s.startMs, s.endMs]), [[250, 2750], [26100, 29900]]);
  assert.deepEqual(saved.analysis.timeline.map((w) => [w.startMs, w.endMs]), [[0, 12000], [12000, 24000], [24000, 36000]]);
  assert.deepEqual(saved.analysis.timeline.map((w) => w.segmentIds), [["s0"], [], ["s1"]]);
  assert.equal(saved.analysis.timeline[0].readings[0].raw, .98);
  assert.equal(saved.analysis.timeline[0].readings[1].raw, 1.5);
  assert.equal(saved.analysis.timeline[1].readings[0].status, "no_text");
  assert.equal(saved.analysis.timeline[2].readings[0].status, "pending");
  assert.equal(saved.analysis.timeline[2].readings[1].status, "failed");
  assert.deepEqual(saved.analysis.progress, { total: 4, done: 3, ok: 2, failed: 1, noText: 1 });
  assert.throws(() => buildVideoExport({ videoId: "bad", segments: [], windows: [] }), /没有可保存/);
});
