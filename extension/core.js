export const WINDOW_MS = 12000;
export const MODEL = "jev-1.13.0";

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

export function buildVideoExport({ videoId, title, durationMs, source, segments, windows, probes, readings, savedAt }) {
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
    format: "cuewave-video-analysis", version: 1, savedAt,
    video: { id: videoId, title, url: `https://www.youtube.com/watch?v=${videoId}`, durationMs: videoDurationMs },
    transcript: { source, segments: segments.map(({ id, startMs, endMs, text }) => ({ id, startMs, endMs, text })) },
    analysis: { model: MODEL, windowWidthMs: WINDOW_MS, probes: probes.map((probe) => ({ ...probe })),
      progress: progress(windows, readings, probes), timeline }
  };
}

export async function fingerprint(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
