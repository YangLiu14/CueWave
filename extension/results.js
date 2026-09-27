import { rankHotspots } from "./core.js";
import { liveProjectView, liveProbeSummary } from "./live-core.js";
import { createLiveStore } from "./live-store.js";

const $ = (id) => document.getElementById(id);
const store = createLiveStore(chrome.storage.local);
const query = new URLSearchParams(location.search);
let records = [];
let selectedId = query.get("sessionId");
let selectedProjectId = query.get("projectId") || "all";
let refreshVersion = 0;
const fmt = (ms) => `${String(Math.floor(Math.max(0, ms) / 60000)).padStart(2, "0")}:${String(Math.floor(Math.max(0, ms) % 60000 / 1000)).padStart(2, "0")}`;
const pct = (value) => `${Math.round(value * 100)}/100`;
function element(tag, className = "", value = "") {
  const node = document.createElement(tag); node.className = className; node.textContent = value; return node;
}
function note(message, error = false) {
  const box = $("result-notice"); box.textContent = message; box.hidden = !message; box.classList.toggle("error", error);
}
function selectedRecord() { return records.find((record) => record.id === selectedId); }
function syncUrl() {
  const url = new URL(location.href);
  if (selectedId) url.searchParams.set("sessionId", selectedId); else url.searchParams.delete("sessionId");
  url.searchParams.set("projectId", selectedProjectId);
  history.replaceState(null, "", url);
}
function showEvidence(item, probe = null) {
  const box = $("result-evidence"); box.replaceChildren();
  const meta = element("div", "evidence-meta", `${probe?.name || "最终字幕"} · ${fmt(item.startMs)}–${fmt(item.endMs)}`);
  box.append(meta);
  if (item.status === "ok" && probe) box.append(element("div", "evidence-score", item.label || pct(item.value)));
  box.append(element("p", "evidence-text", item.text || "无原文"));
  box.append(element("p", "hint", item.status === "failed" ? `判断失败：${item.error || "未知原因"}`
    : "时间来自本机采集时钟的近似定位；此模式没有录音回放。"));
}
function renderSessions() {
  const box = $("sessions"); box.replaceChildren();
  if (!records.length) { box.append(element("p", "empty", "尚无已保存的实时判断记录。完成一次转写后，结果会自动出现在这里。")); return; }
  for (const record of records) {
    const button = element("button", `session-item${record.id === selectedId ? " active" : ""}`);
    button.append(element("strong", "", new Date(record.startedAt).toLocaleString("zh-CN")));
    button.append(element("small", "", `${record.projects?.length || 0} 个项目 · ${record.segments?.length || 0} 条最终字幕 · ${record.endedAt ? "已结束" : "未标记结束"}`));
    button.addEventListener("click", () => { selectedId = record.id; selectedProjectId = "all"; syncUrl(); render(); });
    box.append(button);
  }
}
function renderProjectTabs(record) {
  const box = $("project-tabs"); box.replaceChildren();
  const options = [{ id: "all", name: "整场结果" }, ...(record.projects || [])];
  if (!options.some((option) => option.id === selectedProjectId)) selectedProjectId = "all";
  for (const project of options) {
    const button = element("button", project.id === selectedProjectId ? "active" : "", project.name);
    button.setAttribute("aria-current", project.id === selectedProjectId ? "page" : "false");
    button.addEventListener("click", () => { selectedProjectId = project.id; syncUrl(); render(); });
    box.append(button);
  }
}
function renderOverview(view, record) {
  const box = $("overview"); box.replaceChildren();
  const completed = new Set(view.readings.filter((reading) => reading.status === "ok").map((reading) => reading.windowId)).size;
  const pending = view.segments.filter((segment) => !view.readings.some((reading) => reading.projectId === segment.projectId
    && reading.startMs <= segment.startMs && reading.endMs >= segment.endMs)).length;
  const items = [
    ["本段时长", fmt(view.durationMs)],
    ["最终字幕", String(view.segments.length)],
    ["已分析窗口", String(completed)],
    ["等待读数的字幕", record.probes?.length ? String(pending) : "未配置探针"]
  ];
  for (const [label, value] of items) {
    const card = element("div", "metric"); card.append(element("small", "", label), element("strong", "", value)); box.append(card);
  }
  note(pending && record.probes?.length ? `还有 ${pending} 条最终字幕未匹配到正式读数；若实时判断页仍在分析，结果会自动更新。` : "");
}
function renderProbeResults(view, record) {
  const box = $("probe-results"); box.replaceChildren();
  if (!record.probes?.length) { box.append(element("p", "empty", "此场次没有已配置的语义探针，最终字幕仍可查看。")); return; }
  const duration = Math.max(1, view.durationMs);
  for (const probe of record.probes) {
    const summary = liveProbeSummary(view.readings, probe);
    const section = element("div", "probe-result");
    const top = element("div", "probe-top");
    const title = element("div", "probe-title");
    const dot = element("i", "probe-dot"); dot.style.background = probe.color || "#68d7c9";
    title.append(dot, document.createTextNode(probe.name));
    const stats = element("div", "probe-stats", summary.average == null ? "尚无正式读数"
      : `均值 ${pct(summary.average)} · 峰值 ${pct(summary.peak.value)} · ${summary.count} 个读数${summary.failed ? ` · ${summary.failed} 个失败` : ""}`);
    top.append(title, stats); section.append(top);
    const chart = element("div", "probe-chart");
    const matches = view.readings.filter((reading) => reading.probeId === probe.id);
    if (!matches.length) chart.append(element("div", "chart-empty", "等待此探针的正式判断…"));
    for (const reading of matches) {
      const bar = element("button", reading.status === "ok" ? "probe-bar" : "failed-bar");
      const start = Math.max(view.startMs, reading.startMs);
      const end = Math.min(view.endMs, reading.endMs);
      bar.style.left = `${Math.max(0, (start - view.startMs) / duration * 100)}%`;
      bar.style.width = `${Math.max(.35, (end - start) / duration * 100)}%`;
      if (reading.status === "ok") { bar.style.height = `${Math.max(5, reading.value * 100)}%`; bar.style.background = probe.color || "#68d7c9"; }
      bar.title = `${fmt(reading.startMs)}–${fmt(reading.endMs)} · ${reading.label || "判断失败"}`;
      bar.setAttribute("aria-label", `${probe.name} ${bar.title}`);
      bar.addEventListener("click", () => showEvidence(reading, probe)); chart.append(bar);
    }
    section.append(chart);
    const axis = element("div", "chart-axis"); axis.append(element("span", "", fmt(view.startMs)), element("span", "", fmt(view.endMs)));
    section.append(axis); box.append(section);
  }
}
function renderTranscript(view, record) {
  const box = $("result-transcript"); box.replaceChildren();
  $("transcript-count").textContent = `${view.segments.length} 条最终字幕`;
  if (!view.segments.length) { box.append(element("p", "empty", "这一段尚无最终字幕；临时字幕不会进入结果。")); return; }
  for (const segment of view.segments) {
    const row = element("button", "transcript-row");
    row.append(element("time", "", fmt(segment.startMs)));
    const content = element("div"); content.append(element("p", "", segment.text));
    const badges = element("div", "score-badges");
    for (const probe of record.probes || []) {
      const reading = view.readings.find((item) => item.probeId === probe.id && item.projectId === segment.projectId
        && item.startMs < segment.endMs && item.endMs > segment.startMs);
      if (!reading) continue;
      const badge = element("span", "score-badge", `${probe.name} ${reading.status === "ok" ? pct(reading.value) : "失败"}`);
      if (reading.status === "ok") badge.style.borderColor = probe.color || "#68d7c9";
      badges.append(badge);
    }
    if (badges.childElementCount) content.append(badges);
    row.append(content); row.addEventListener("click", () => showEvidence({ ...segment, status: "ok" })); box.append(row);
  }
}
function renderHotspots(view, record) {
  const box = $("result-hotspots"); box.replaceChildren();
  let count = 0;
  for (const probe of record.probes || []) {
    for (const hotspot of rankHotspots(view.readings, probe).slice(0, 3)) {
      const button = element("button", "result-hotspot");
      button.append(element("strong", "", `${probe.name} · ${hotspot.peak.label}`));
      button.append(element("small", "", `${fmt(hotspot.startMs)}–${fmt(hotspot.endMs)} · ${hotspot.peak.text?.slice(0, 88) || "原句待核对"}`));
      button.addEventListener("click", () => showEvidence(hotspot.peak, probe)); box.append(button); count++;
    }
  }
  if (!count) box.append(element("p", "empty", "暂无达到阈值的热点；这不代表未分析内容得分为零。"));
}
function render() {
  renderSessions();
  const record = selectedRecord();
  $("download").disabled = !record; $("delete").disabled = !record?.endedAt || record.analysisPending === true;
  $("delete").title = record?.analysisPending ? "分析仍在继续，完成后可删除" : "";
  if (!record) {
    $("result-title").textContent = "还没有实时判断结果";
    $("result-subtitle").textContent = "开始实时转写后，最终字幕与分析会自动出现在这里。";
    $("record-state").textContent = "等待记录";
    for (const id of ["project-tabs", "overview", "probe-results", "result-transcript", "result-hotspots", "result-evidence"]) $(id).replaceChildren();
    $("transcript-count").textContent = ""; note(""); return;
  }
  renderProjectTabs(record);
  const view = liveProjectView(record, selectedProjectId);
  $("result-title").textContent = view.project ? `${view.project.name} · 分析结果` : "整场判断结果";
  $("result-subtitle").textContent = `${new Date(record.startedAt).toLocaleString("zh-CN")} 开始 · ${record.projects.length} 个项目 · ${fmt(view.startMs)}–${fmt(view.endMs)}`;
  $("record-state").textContent = record.endedAt ? "采集已结束 · 已保存" : "未标记结束 · 可能仍在采集";
  renderOverview(view, record); renderProbeResults(view, record); renderTranscript(view, record); renderHotspots(view, record);
}
async function refresh() {
  const version = ++refreshVersion;
  try {
    const saved = await store.list(); if (version !== refreshVersion) return;
    records = saved;
    if (!selectedRecord()) { selectedId = records[0]?.id || null; selectedProjectId = "all"; syncUrl(); }
    render();
  } catch (error) { note(`无法读取本机实时判断记录：${error.message}`, true); }
}
$("download").addEventListener("click", () => {
  const record = selectedRecord(); if (!record) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `cuewave-live-${record.id}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("delete").addEventListener("click", async () => {
  const record = selectedRecord(); if (!record?.endedAt || record.analysisPending || !window.confirm("删除此场次在浏览器中的最终字幕和读数？已下载的 JSON 不受影响。")) return;
  try { await store.remove(record.id); await refresh(); }
  catch (error) { note(`删除失败：${error.message}`, true); }
});
$("back-live").addEventListener("click", async () => {
  const liveUrl = chrome.runtime.getURL("live.html");
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url?.split("?")[0] === liveUrl);
  if (existing) await chrome.tabs.update(existing.id, { active: true });
  else await chrome.tabs.create({ url: liveUrl });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.keys(changes).some((key) => key.startsWith("cuewave:live:"))) void refresh();
});
await refresh();
