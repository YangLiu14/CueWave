import test from "node:test";
import assert from "node:assert/strict";
import { parseCaptions, buildWindows, buildVideoExport, parseVideoExport, adCandidateSegments, buildAdBoundaries, estimateAnalysisWork, hasReusableReading, hasPendingAnalysis, isProbeVisible, selectedVisibleProbeId, JEV_INPUT_USD_PER_MILLION, subtitleCoverageMs, readingValue, rankHotspots, progress } from "../extension/core.js";

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
  const probes = [{ id: "steps", name: "实操步骤", color: "#5ddbc8", primitive: "noul", description: "操作", criterion: "有具体动作", positive: "有", negative: "无" },
    { id: "detail", name: "具体程度", color: "#f4b860", enabled: false, primitive: "score", description: "细节", criterion: "有具体细节", positive: "高", negative: "低", criteria: ["低", "中", "高"] }];
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
  const restored = parseVideoExport(saved);
  assert.equal(restored.videoId, "dQw4w9WgXcQ");
  assert.equal(restored.probes[1].enabled, false);
  assert.deepEqual(restored.windows.map((window) => window.startMs), [0, 12000, 24000]);
  assert.deepEqual(restored.readings.map((reading) => [reading.probeId, reading.windowId, reading.status]),
    [["steps", "w0", "ok"], ["detail", "w0", "ok"], ["detail", "w24000", "failed"]]);
  assert.equal(hasReusableReading(restored.readings, "w0", "steps", "a-new-fingerprint"), true);
  assert.equal(hasReusableReading(restored.readings, "w24000", "detail", "a-new-fingerprint"), false);
  assert.equal(hasReusableReading([{ windowId: "w0", probeId: "steps", status: "ok", probeKey: "old" }], "w0", "steps", "new"), false);
  const older = structuredClone(saved); older.version = 1; delete older.analysis.adBoundaries;
  assert.deepEqual(parseVideoExport(older).adBoundaries, []);
  const mismatch = structuredClone(saved); mismatch.analysis.timeline[0].startMs = 1000;
  assert.throws(() => parseVideoExport(mismatch), /时间轴不匹配/);
  const wrongWidth = structuredClone(saved); wrongWidth.analysis.windowWidthMs = 6000;
  assert.throws(() => parseVideoExport(wrongWidth), /不兼容/);
  assert.throws(() => buildVideoExport({ videoId: "bad", segments: [], windows: [] }), /没有可保存/);
});

test("probe visibility falls back to a visible selection without affecting analysis progress", () => {
  const probes = [{ id: "a", enabled: false }, { id: "b" }, { id: "c", enabled: true }];
  assert.equal(isProbeVisible(probes[0]), false);
  assert.equal(isProbeVisible(probes[1]), true);
  assert.equal(selectedVisibleProbeId(probes, "a"), "b");
  assert.equal(selectedVisibleProbeId(probes, "c"), "c");
  assert.equal(selectedVisibleProbeId([{ id: "a", enabled: false }], "a"), null);
  assert.equal(progress([{ id: "w0", status: "pending" }], [], probes).total, 3);
});

test("automatic continuation only considers windows with no terminal reading", () => {
  const windows = [{ id: "w0", status: "pending" }, { id: "w12000", status: "pending" }, { id: "w24000", status: "no_text" }];
  const probes = [{ id: "a" }];
  assert.equal(hasPendingAnalysis(windows, probes, [{ windowId: "w0", probeId: "a", status: "ok" }]), true);
  assert.equal(hasPendingAnalysis(windows, probes, [{ windowId: "w0", probeId: "a", status: "ok" },
    { windowId: "w12000", probeId: "a", status: "failed" }]), false);
});

test("ad boundaries use evaluated subtitle cues rather than coarse 12-second windows", () => {
  const segments = [
    { id: "s0", startMs: 2000, endMs: 5000, text: "正常介绍" },
    { id: "s1", startMs: 5100, endMs: 7600, text: "本期由某品牌赞助" },
    { id: "s2", startMs: 7800, endMs: 10000, text: "优惠码在简介里" },
    { id: "s3", startMs: 14000, endMs: 17000, text: "回到教程" }
  ];
  assert.deepEqual(adCandidateSegments(segments, [{ startMs: 0, endMs: 12000 }]).map((segment) => segment.id), ["s0", "s1", "s2"]);
  const readings = [
    { probeId: "ad", segmentId: "s0", status: "ok", value: .1 },
    { probeId: "ad", segmentId: "s1", status: "ok", value: .96 },
    { probeId: "ad", segmentId: "s2", status: "ok", value: .91 },
    { probeId: "ad", segmentId: "s3", status: "ok", value: .05 }
  ];
  assert.deepEqual(buildAdBoundaries(segments, readings, "ad"), [{ probeId: "ad", startMs: 5100, endMs: 10000,
    segmentIds: ["s1", "s2"], peakValue: .96, method: "subtitle_jev" }]);
});

test("Jev work estimate counts batched requests and keeps price explicitly approximate", () => {
  const windows = [{ id: "w0", status: "pending", text: "讲解方法", context: "" },
    { id: "w12000", status: "pending", text: "继续讲解", context: "前文" },
    { id: "w24000", status: "no_text", text: "", context: "" }];
  const probes = [{ id: "a", description: "具体程度", criterion: "具体方法", positive: "高", negative: "低" },
    { id: "b", description: "推广信息", criterion: "广告", positive: "有", negative: "无" }];
  const estimate = estimateAnalysisWork(windows, probes, [{ windowId: "w0", probeId: "a", status: "ok" }]);
  assert.equal(estimate.requests, 2);
  assert.equal(estimate.questions, 3);
  assert.ok(estimate.estimatedInputTokens > 0);
  assert.equal(estimate.estimatedUsd, estimate.estimatedInputTokens / 1_000_000 * JEV_INPUT_USD_PER_MILLION);
});
