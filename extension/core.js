export const WINDOW_MS = 12000;
export const MODEL = "jev-1.13.0";
// TypeSafe AI model reference, checked 2026-09-27: https://docs.typesafe.ai/models
export const JEV_INPUT_USD_PER_MILLION = 0.042;

export function isProbeVisible(probe) { return probe.enabled !== false; }

export function selectedVisibleProbeId(probes, requestedId) {
  return probes.find((probe) => probe.id === requestedId && isProbeVisible(probe))?.id
    || probes.find(isProbeVisible)?.id || null;
}

export function parseTimestamp(value) {
  const match = String(value).trim().replace(',', '.').match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) throw new Error(`无效时间戳：${value}`);
  const [, hours = "0", minutes, seconds, millis = "0"] = match;
  if (+minutes > 59 || +seconds > 59) throw new Error(`无效时间戳：${value}`);
  return ((+hours * 3600 + +minutes * 60 + +seconds) * 1000) + +millis.padEnd(3, "0");
}

export function parseCaptions(input) {
  const text = String(input).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blocks = text.replace(/^WEBVTT[^\n]*\n/, "").split(/\n\s*\n/);
  const segments = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const index = lines.findIndex((line) => line.includes("-->"));
    if (index < 0) continue;
    const [startRaw, endRaw] = lines[index].split("-->");
    const startMs = parseTimestamp(startRaw);
    const endMs = parseTimestamp(endRaw.trim().split(/\s+/)[0]);
    const content = lines.slice(index + 1).join(" ").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    if (content && endMs > startMs) segments.push({ startMs, endMs, text: content });
  }
  if (!segments.length) throw new Error("没有找到有效的带时间戳 SRT/VTT 字幕");
  return normalizeSegments(segments);
}

export function normalizeSegments(segments) {
  const normalized = segments.map((s) => ({ startMs: Number(s.startMs), endMs: Number(s.endMs), text: String(s.text || "").trim() }))
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.startMs >= 0 && s.endMs > s.startMs && s.text)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (!normalized.length) throw new Error("字幕没有有效的文本与时间戳");
  return normalized.map((s, i) => ({ id: `s${i}`, ...s }));
}

export function buildWindows(segments, durationMs, widthMs = WINDOW_MS) {
  if (!segments.length) return [];
  const end = Math.max(durationMs || 0, segments.at(-1).endMs);
  const windows = [];
  for (let startMs = 0; startMs < end; startMs += widthMs) {
    const endMs = Math.min(startMs + widthMs, end);
    const target = segments.filter((s) => s.startMs < endMs && s.endMs > startMs);
    const context = segments.filter((s) => s.startMs < startMs && s.endMs > Math.max(0, startMs - 30000));
    windows.push({ id: `w${startMs}`, startMs, endMs, segmentIds: target.map((s) => s.id), text: target.map((s) => s.text).join(" "), context: context.map((s) => s.text).join(" "), status: target.length ? "pending" : "no_text" });
  }
  return windows;
}

export function subtitleCoverageMs(segments, durationMs) {
  const limit = Math.max(0, durationMs || segments.at(-1)?.endMs || 0);
  let total = 0; let end = 0;
  for (const segment of segments) {
    const start = Math.min(limit, Math.max(0, segment.startMs));
    const next = Math.min(limit, segment.endMs);
    if (next > end) total += next - Math.max(start, end);
    end = Math.max(end, next);
  }
  return { coveredMs: total, durationMs: limit, percent: limit ? Math.round(total / limit * 100) : 0 };
}

export function readingValue(answer, probe) {
  if (!answer || answer.type !== probe.primitive) throw new Error("Jev 返回了不匹配的读数类型");
  if (probe.primitive === "score") {
    const max = probe.criteria.length - 1;
    if (!Number.isFinite(answer.score) || answer.score < 0 || answer.score > max) throw new Error("Jev Score 越界或缺失");
    return { raw: answer.score, value: answer.score / max, label: `${Math.round(answer.score / max * 100)}/100 强度`, confidence: validConfidence(answer.confidence) };
  }
  if (!Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw new Error("Jev Noul 越界或缺失");
  return { raw: answer.noul, value: answer.noul, label: `${Math.round(answer.noul * 100)}% 命题概率`, confidence: null };
}

function validConfidence(value) { return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null; }

export function rankHotspots(readings, probe) {
  const threshold = probe.primitive === "score" ? .75 : .8;
  const hits = readings.filter((r) => r.probeId === probe.id && r.status === "ok" && r.value >= threshold)
    .sort((a, b) => a.startMs - b.startMs);
  const groups = [];
  for (const hit of hits) {
    const prev = groups.at(-1);
    if (prev && hit.startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, hit.endMs);
      prev.readings.push(hit);
      if (hit.value > prev.peak.value) prev.peak = hit;
    } else groups.push({ startMs: hit.startMs, endMs: hit.endMs, readings: [hit], peak: hit });
  }
  return groups.sort((a, b) => b.peak.value - a.peak.value || a.startMs - b.startMs);
}

export function adCandidateSegments(segments, hotspots) {
  return segments.filter((segment) => hotspots.some((hotspot) => segment.startMs < hotspot.endMs && segment.endMs > hotspot.startMs));
}

export function buildAdBoundaries(segments, cueReadings, probeId, threshold = .7) {
  const scores = new Map(cueReadings.filter((reading) => reading.probeId === probeId && reading.status === "ok")
    .map((reading) => [reading.segmentId, reading.value]));
  const hits = segments.filter((segment) => (scores.get(segment.id) ?? -1) >= threshold);
  const boundaries = [];
  for (const segment of hits) {
    const previous = boundaries.at(-1);
    if (previous && segment.startMs <= previous.endMs + 1500) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      previous.segmentIds.push(segment.id);
      previous.peakValue = Math.max(previous.peakValue, scores.get(segment.id));
    } else boundaries.push({ probeId, startMs: segment.startMs, endMs: segment.endMs,
      segmentIds: [segment.id], peakValue: scores.get(segment.id), method: "subtitle_jev" });
  }
  return boundaries;
}

export function progress(windows, readings, probes) {
  const analyzable = windows.filter((w) => w.status !== "no_text");
  const total = analyzable.length * probes.length;
  const windowIds = new Set(analyzable.map((w) => w.id));
  const probeIds = new Set(probes.map((p) => p.id));
  const latest = new Map();
  for (const reading of readings) if (windowIds.has(reading.windowId) && probeIds.has(reading.probeId)) latest.set(`${reading.windowId}:${reading.probeId}`, reading);
  const active = [...latest.values()];
  const done = active.filter((r) => r.status === "ok" || r.status === "failed").length;
  return { total, done, ok: active.filter((r) => r.status === "ok").length, failed: active.filter((r) => r.status === "failed").length, noText: windows.length - analyzable.length };
}

export function hasReusableReading(readings, windowId, probeId, probeKey) {
  return readings.some((reading) => reading.windowId === windowId && reading.probeId === probeId &&
    reading.status === "ok" && (reading.probeKey === probeKey || reading.imported === true));
}

export function hasPendingAnalysis(windows, probes, readings) {
  return windows.some((window) => window.status !== "no_text" && probes.some((probe) => !readings.some((reading) =>
    reading.windowId === window.id && reading.probeId === probe.id && ["ok", "failed"].includes(reading.status))));
}

export function estimateAnalysisWork(windows, probes, readings) {
  const completed = new Set(readings.filter((reading) => reading.status === "ok").map((reading) => `${reading.windowId}:${reading.probeId}`));
  let requests = 0; let questions = 0; let estimatedInputTokens = 0;
  for (const window of windows) {
    if (window.status === "no_text") continue;
    const missing = probes.filter((probe) => !completed.has(`${window.id}:${probe.id}`));
    if (!missing.length) continue;
    requests++; questions += missing.length;
    const payload = JSON.stringify({ target: window.text, context: window.context, questions: missing.map((probe) =>
      ({ description: probe.description, criterion: probe.criterion, positive: probe.positive,
        middle: probe.middle, negative: probe.negative })) });
    estimatedInputTokens += Math.ceil(new TextEncoder().encode(payload).length / 3) + 120;
  }
  return { requests, questions, estimatedInputTokens,
    estimatedUsd: estimatedInputTokens / 1_000_000 * JEV_INPUT_USD_PER_MILLION };
}

export function buildVideoExport({ videoId, title, durationMs, source, segments, windows, probes, readings, adCueReadings = [], adBoundaries = [], usage = {}, savedAt }) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !segments.length || !windows.length) throw new Error("没有可保存的视频字幕与时间轴");
  const videoDurationMs = Math.max(durationMs || 0, segments.at(-1).endMs, windows.at(-1).endMs);
  const activeProbeIds = new Set(probes.map((probe) => probe.id));
  const windowIds = new Set(windows.map((window) => window.id));
  const byWindowAndProbe = new Map();
  for (const reading of readings) {
    if (activeProbeIds.has(reading.probeId) && windowIds.has(reading.windowId)) {
      byWindowAndProbe.set(`${reading.windowId}:${reading.probeId}`, reading);
    }
  }
  const timeline = windows.map((window) => ({
    windowId: window.id,
    startMs: window.startMs,
    endMs: window.endMs,
    text: window.text,
    context: window.context,
    segmentIds: [...window.segmentIds],
    readings: probes.map((probe) => {
      const reading = byWindowAndProbe.get(`${window.id}:${probe.id}`);
      if (window.status === "no_text") return { probeId: probe.id, status: "no_text" };
      if (!reading) return { probeId: probe.id, status: "pending" };
      if (reading.status === "failed") return { probeId: probe.id, status: "failed", error: reading.error };
      return { probeId: probe.id, status: "ok", model: reading.model, raw: reading.raw,
        value: reading.value, label: reading.label, confidence: reading.confidence };
    })
  }));
  return {
    format: "cuewave-video-analysis", version: 2, savedAt,
    video: { id: videoId, title, url: `https://www.youtube.com/watch?v=${videoId}`, durationMs: videoDurationMs },
    transcript: { source, segments: segments.map(({ id, startMs, endMs, text }) => ({ id, startMs, endMs, text })) },
    analysis: { model: MODEL, windowWidthMs: WINDOW_MS, probes: probes.map((probe) => ({ ...probe })),
      progress: progress(windows, readings, probes), timeline,
      adCueReadings: adCueReadings.map((reading) => ({ ...reading })),
      adBoundaries: adBoundaries.map((boundary) => ({ ...boundary, segmentIds: [...boundary.segmentIds] })),
      usage: { ...usage } }
  };
}

export function parseVideoExport(data) {
  if (!data || data.format !== "cuewave-video-analysis" || ![1, 2].includes(data.version)) throw new Error("不是受支持的 CueWave 分析文件");
  const videoId = data.video?.id;
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !Number.isFinite(data.video.durationMs) || data.video.durationMs <= 0 || data.video.durationMs > 24 * 60 * 60 * 1000) throw new Error("保存文件中的视频信息无效");
  if (!Array.isArray(data.transcript?.segments) || !data.transcript.segments.length) throw new Error("保存文件缺少时间戳字幕");
  const segments = normalizeSegments(data.transcript.segments);
  if (segments.some((segment, index) => segment.id !== data.transcript.segments[index]?.id)) throw new Error("保存文件的字幕顺序或标识无效");
  const probes = data.analysis?.probes;
  if (!Array.isArray(probes) || !probes.length || probes.length > 5 ||
    new Set(probes.map((probe) => probe.id)).size !== probes.length ||
    probes.some((probe) => !probe.id || !/^#[0-9a-fA-F]{6}$/.test(probe.color) || ["name", "description", "criterion", "positive", "negative"].some((key) => typeof probe[key] !== "string") ||
      !["noul", "score"].includes(probe.primitive) ||
      (probe.primitive === "score" && (!Array.isArray(probe.criteria) || probe.criteria.length < 2 || probe.criteria.some((item) => typeof item !== "string"))))) throw new Error("保存文件中的探针定义无效");
  const widthMs = data.analysis.windowWidthMs;
  if (widthMs !== WINDOW_MS) throw new Error("保存文件的分析窗口与当前版本不兼容");
  const windows = buildWindows(segments, data.video.durationMs, widthMs);
  const timeline = data.analysis.timeline;
  if (!Array.isArray(timeline) || timeline.length !== windows.length || timeline.some((row, index) =>
    row.windowId !== windows[index].id || row.startMs !== windows[index].startMs || row.endMs !== windows[index].endMs ||
    row.text !== windows[index].text || !Array.isArray(row.readings))) throw new Error("保存文件的分析结果与字幕时间轴不匹配");
  const probeIds = new Set(probes.map((probe) => probe.id));
  const readings = [];
  for (const row of timeline) for (const reading of row.readings) {
    if (!probeIds.has(reading.probeId) || !["ok", "failed", "pending", "no_text"].includes(reading.status)) throw new Error("保存文件中的读数无效");
    if (reading.status === "ok") {
      if (!Number.isFinite(reading.value) || reading.value < 0 || reading.value > 1 || !Number.isFinite(reading.raw)) throw new Error("保存文件中的读数数值无效");
      readings.push({ id: `${row.windowId}:${reading.probeId}`, windowId: row.windowId, probeId: reading.probeId, imported: true,
        startMs: row.startMs, endMs: row.endMs, text: row.text, status: "ok", model: reading.model,
        raw: reading.raw, value: reading.value, label: reading.label, confidence: reading.confidence ?? null });
    } else if (reading.status === "failed") readings.push({ id: `${row.windowId}:${reading.probeId}`, windowId: row.windowId,
      probeId: reading.probeId, startMs: row.startMs, endMs: row.endMs, status: "failed", error: String(reading.error || "分析失败") });
  }
  const segmentIds = new Set(segments.map((segment) => segment.id));
  const adCueReadings = Array.isArray(data.analysis.adCueReadings) ? data.analysis.adCueReadings.filter((reading) =>
    probeIds.has(reading.probeId) && segmentIds.has(reading.segmentId) && Number.isFinite(reading.value) && reading.value >= 0 && reading.value <= 1) : [];
  const adBoundaries = Array.isArray(data.analysis.adBoundaries) ? data.analysis.adBoundaries.filter((boundary) =>
    probeIds.has(boundary.probeId) && Number.isFinite(boundary.startMs) && Number.isFinite(boundary.endMs) &&
    boundary.startMs >= 0 && boundary.endMs > boundary.startMs && boundary.endMs <= data.video.durationMs &&
    Number.isFinite(boundary.peakValue) && boundary.peakValue >= 0 && boundary.peakValue <= 1 &&
    Array.isArray(boundary.segmentIds) && boundary.segmentIds.every((id) => segmentIds.has(id))) : [];
  const savedUsage = data.analysis.usage;
  const usage = { inputTokens: Number.isFinite(savedUsage?.inputTokens) && savedUsage.inputTokens >= 0 ? savedUsage.inputTokens : 0,
    requests: Number.isFinite(savedUsage?.requests) && savedUsage.requests >= 0 ? savedUsage.requests : 0,
    reportedRequests: Number.isFinite(savedUsage?.reportedRequests) && savedUsage.reportedRequests >= 0 ? savedUsage.reportedRequests : 0 };
  return { videoId, title: String(data.video.title || ""), durationMs: data.video.durationMs,
    source: String(data.transcript.source || "导入 CueWave 分析"), segments, windows, probes, readings,
    adCueReadings, adBoundaries, usage, savedAt: String(data.savedAt || "") };
}

export async function fingerprint(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
