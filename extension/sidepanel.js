import { parseCaptions, parseVideoExport, normalizeSegments, buildWindows, buildVideoExport, adCandidateSegments, buildAdBoundaries, estimateAnalysisWork, hasReusableReading, hasPendingAnalysis, isProbeVisible, selectedVisibleProbeId, JEV_INPUT_USD_PER_MILLION, subtitleCoverageMs, rankHotspots, progress, fingerprint, MODEL, WINDOW_MS } from "./core.js";

const $ = (id) => document.getElementById(id);
const COLORS = ["#5ddbc8", "#f4b860", "#a895f2", "#e879a2", "#8eb7f3"];
const API = "http://127.0.0.1:4318";
const state = { tabId: null, videoId: null, durationMs: 0, segments: [], source: "", probes: [], options: null, revisingId: null, windows: [], readings: [], adCueReadings: [], adBoundaries: [], usage: { inputTokens: 0, requests: 0, reportedRequests: 0 }, history: [], selectedId: null, subtitleEnabled: false, cacheWarning: false, resumeOnOpen: false, running: false, cancelled: false, helper: null };
let transcriptEpoch = 0;
let checkSequence = 0;
const format = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, "0")}`;
function status(message, error = false) { $("status").textContent = message; $("status").classList.toggle("error", error); }
const playerIssues = new Map();
function playerStatus(area, message = "") {
  if (message) playerIssues.set(area, message); else playerIssues.delete(area);
  const node = $("player-status"); node.textContent = [...playerIssues.values()].join("；"); node.hidden = playerIssues.size === 0;
}
let contentRecovery = null;
async function sendToContent(message, valid = (reply) => reply?.ok === true) {
  let reply;
  try { reply = await chrome.tabs.sendMessage(state.tabId, message); }
  catch (error) {
    if (!/receiving end does not exist|could not establish connection|message port closed|extension context invalidated/i.test(error.message || "")) throw error;
    if (!contentRecovery) contentRecovery = (async () => {
      const tab = await chrome.tabs.get(state.tabId).catch(() => null);
      if (new URL(tab?.url || "https://invalid.example").searchParams.get("v") !== state.videoId) throw new Error("视频已切换，无法恢复播放器连接");
      if (!chrome.scripting?.executeScript || !chrome.scripting?.insertCSS) throw new Error("扩展缺少播放器恢复权限，请重新加载扩展");
      await chrome.scripting.insertCSS({ target: { tabId: state.tabId }, files: ["content.css"] });
      await chrome.scripting.executeScript({ target: { tabId: state.tabId }, files: ["content.js"] });
    })();
    try { await contentRecovery; } finally { contentRecovery = null; }
    reply = await chrome.tabs.sendMessage(state.tabId, message);
  }
  if (!valid(reply)) throw new Error("视频页未确认操作；请核对当前视频并刷新标签页");
  return reply;
}
async function api(path, body) {
  const response = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || `本机服务错误 ${response.status}`); error.code = result.code; error.retryable = result.retryable; throw error; }
  return result;
}
function historyMeta(record) {
  return { videoId: record.videoId, title: record.title, savedAt: record.savedAt,
    source: record.source, readingCount: (record.readings || []).filter((reading) => reading.status === "ok").length };
}
function updateHistoryItem(record) {
  state.history = [historyMeta(record), ...state.history.filter((item) => item.videoId !== record.videoId)]
    .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
  renderHistory();
}
let historyRevision = 0;
async function refreshHistory() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = historyRevision;
    const stored = await chrome.storage.local.get(null);
    if (historyRevision !== before) continue;
    state.history = Object.entries(stored).filter(([key, value]) => /^cuewave:video:[A-Za-z0-9_-]{11}$/.test(key) && value && typeof value === "object")
      .map(([key, value]) => historyMeta({ ...value, videoId: key.slice("cuewave:video:".length) }))
      .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
    renderHistory();
    return;
  }
}
async function saveRecord(record) {
  await chrome.storage.local.set({ [`cuewave:video:${record.videoId}`]: record });
  updateHistoryItem(record);
  await updateStorageUsage();
}
async function save() {
  if (!state.videoId || !state.segments.length) return;
  await saveRecord({ videoId: state.videoId, title: $("video-title").textContent || "", durationMs: state.durationMs,
    source: state.source, segments: state.segments, windows: state.windows, probes: state.probes,
    readings: state.readings, adCueReadings: state.adCueReadings, adBoundaries: state.adBoundaries,
    usage: state.usage, selectedId: state.selectedId, resumeOnOpen: state.resumeOnOpen, savedAt: new Date().toISOString() });
}
async function safeSave() {
  if (state.cacheWarning) return false;
  try { await save(); return true; }
  catch { state.cacheWarning = true; status("本机缓存写入失败或已满；分析会继续，但请尽快点击「保存结果」下载 JSON，并在历史列表清理不需要的记录。", true); return false; }
}
async function loadVideo() {
  const saved = (await chrome.storage.local.get(`cuewave:video:${state.videoId}`))[`cuewave:video:${state.videoId}`];
  if (!saved) return;
  state.segments = saved.segments || []; state.source = saved.source || ""; state.readings = saved.readings || [];
  state.probes = saved.probes?.slice(0, 5) || state.probes;
  state.selectedId = selectedVisibleProbeId(state.probes, saved.selectedId);
  state.adCueReadings = saved.adCueReadings || []; state.adBoundaries = saved.adBoundaries || [];
  state.usage = saved.usage || { inputTokens: 0, requests: 0, reportedRequests: 0 };
  state.resumeOnOpen = saved.resumeOnOpen === true;
  state.durationMs = Math.max(state.durationMs, saved.durationMs || 0);
  if (state.segments.length) state.windows = saved.windows || buildWindows(state.segments, Math.max(state.durationMs, saved.durationMs || 0));
  render();
}
async function loadDefinitions() {
  const saved = (await chrome.storage.local.get("cuewave:definitions"))["cuewave:definitions"] || [];
  state.probes = saved.slice(0, 5); state.selectedId = selectedVisibleProbeId(state.probes, state.selectedId);
  render();
}
async function storeDefinitions() {
  try { await chrome.storage.local.set({ "cuewave:definitions": state.probes }); }
  catch { state.cacheWarning = true; status("本机缓存写入失败或已满；当前探针只保留在本次侧栏会话中，请清理旧记录后重试。", true); return false; }
  return safeSave();
}
function probeFromOption(input, option) {
  const id = crypto.randomUUID();
  const previous = state.probes.find((probe) => probe.id === state.revisingId);
  return { id, input, name: option.name.slice(0, 40), description: option.description, criterion: option.criterion, positive: option.positive, negative: option.negative,
    primitive: option.primitive, middle: option.primitive === "score" ? option.middle : null,
    criteria: option.primitive === "score" ? [option.negative, option.middle, option.positive] : null,
    color: previous?.color || COLORS[state.probes.length], enabled: previous?.enabled !== false, revision: (previous?.revision || 0) + 1, previousId: previous?.id || null };
}
async function checkInput(input) {
  if (state.running) return status("请等待本轮分析结束或停止后修改探针。", true);
  if (state.probes.length >= 5 && !state.revisingId) return status("最多可启用 5 个探针", true);
  const sequence = ++checkSequence;
  if (state.helper?.capabilities.gemini) {
    const cache = (await chrome.storage.local.get("cuewave:checked"))["cuewave:checked"] || {};
    if (sequence !== checkSequence) return;
    if (cache[input]) { state.options = { input, result: cache[input], cached: true }; renderOptions(); return; }
  }
  status(state.helper?.capabilities.manualProbes ? "正在准备手动探针草稿…" : "Gemini 正在检查探针含义…");
  try {
    const result = await api("/probe/check", { input });
    if (sequence !== checkSequence) return;
    const previous = state.probes.find((probe) => probe.id === state.revisingId);
    const legacyPromotion = ["推广信息", "推广信号"].includes(previous?.input)
      && ((previous.description === previous.input
        && previous.criterion === `只根据目标字幕判断是否明确表达「${previous.input}」，不核验事实真伪。`)
        || (previous.description === "目标片段是否包含与当前视频主线无关的广告推荐或销售口播。"
          && previous.criterion === "先用 videoTitle 和 context 确定视频原本介绍或评测的对象。仅当 target 明确转向推荐或推销另一独立商品或服务、形成偏离主线的插播广告时为是；即使同属一个领域，自家产品的独立销售口播也算。原本评测对象的正常介绍、优缺点及购买建议不算；无法判断是否偏离主线时不算。"));
    const legacyGeneric = ["具体程度", "实操步骤", "幽默程度", "buzzword含量", "无聊程度"].includes(previous?.input)
      && previous.description === previous.input
      && previous.criterion === `只根据目标字幕判断是否明确表达「${previous.input}」，不核验事实真伪。`;
    if (result.manual && previous?.input === input && !legacyPromotion && !legacyGeneric) {
      result.options = [{ name: previous.name, description: previous.description, criterion: previous.criterion,
        positive: previous.positive, middle: previous.middle || previous.criteria?.[1] || "", negative: previous.negative, primitive: previous.primitive }];
    }
    state.options = { input, result, cached: false }; renderOptions();
    status(result.manual ? "请手动校准判断标准和读数类型，然后确认。" : result.ambiguous ? "发现歧义：请选择最符合意图的定义。" : "请核对标准与例子，然后确认。");
  } catch (error) {
    if (sequence === checkSequence) status(error.code === "GEMINI_PAYMENT_REQUIRED" ? `${error.message}。额度恢复后再检查；已确认探针仍可使用。` : `${error.message}。请稍后重试。`, true);
  }
}
function renderOptions() {
  const box = $("options"); box.replaceChildren();
  if (!state.options) return;
  const { input, result, cached } = state.options;
  state.options.drafts ||= result.options.map((option) => ({ ...option }));
  const intro = document.createElement("p"); intro.className = "hint"; intro.textContent = `${result.manual ? "手动定义 · 未检查歧义" : result.ambiguous ? "有歧义" : "含义较明确"} · ${result.reason}${cached ? " · 已缓存检查" : ""}`; box.append(intro);
  for (const draft of state.options.drafts) {
    const card = document.createElement("div"); card.className = "option";
    let middleField;
    for (const [key, label] of [["name", "探针名称"], ["description", "观察什么"], ["criterion", "判断标准"], ["positive", "高值 / 是"], ["middle", "中值（仅 Score）"], ["negative", "低值 / 否"]]) {
      const field = document.createElement("label"); field.className = "option-field"; field.textContent = label;
      const control = document.createElement(key === "name" ? "input" : "textarea");
      control.value = draft[key] || ""; control.maxLength = key === "name" ? 40 : 800;
      if (key !== "name") control.rows = 2;
      control.addEventListener("input", () => { draft[key] = control.value; });
      if (key === "middle") middleField = field;
      field.append(control); card.append(field);
    }
    const typeField = document.createElement("label"); typeField.className = "option-field"; typeField.textContent = "Jev 读数类型";
    const primitive = document.createElement("select");
    for (const [value, label] of [["noul", "Noul · 是否明确出现"], ["score", "Score · 强度分级"]]) {
      const choice = document.createElement("option"); choice.value = value; choice.textContent = label; primitive.append(choice);
    }
    primitive.value = draft.primitive;
    middleField.hidden = draft.primitive !== "score";
    primitive.addEventListener("change", () => { draft.primitive = primitive.value; middleField.hidden = primitive.value !== "score"; });
    typeField.append(primitive); card.append(typeField);
    const button = document.createElement("button"); button.textContent = "确认此定义";
    button.addEventListener("click", async () => {
      if (state.running || !state.options || state.options.input !== input || (state.probes.length >= 5 && !state.revisingId)) return;
      const option = Object.fromEntries(["name", "description", "criterion", "positive", "middle", "negative", "primitive"].map((key) => [key, String(draft[key] || "").trim()]));
      if (["name", "description", "criterion", "positive", "negative"].some((key) => !option[key])) return status("请填写完整的名称、观察内容、标准和高低值定义。", true);
      if (option.primitive === "score" && !option.middle) return status("Score 探针还需要填写中值标准。", true);
      state.options = null; renderOptions();
      const probe = probeFromOption(input, option);
      const previous = state.probes.find((p) => p.id === state.revisingId);
      if (previous) {
        const archived = (await chrome.storage.local.get("cuewave:archivedDefinitions"))["cuewave:archivedDefinitions"] || [];
        archived.push(previous); await chrome.storage.local.set({ "cuewave:archivedDefinitions": archived });
        state.probes = state.probes.map((p) => p.id === previous.id ? probe : p);
      } else state.probes.push(probe);
      state.revisingId = null; state.selectedId = probe.id;
      if (!result.manual) {
        const cache = (await chrome.storage.local.get("cuewave:checked"))["cuewave:checked"] || {};
        cache[input] = result; await chrome.storage.local.set({ "cuewave:checked": cache });
      }
      const stored = await storeDefinitions(); $("probe-input").value = ""; render(); pushGraph();
      if (stored) status(`已确认「${probe.name}」。分析前可继续添加探针。`);
    });
    card.append(button); box.append(card);
  }
  const retry = document.createElement("button"); retry.textContent = result.manual ? "重新输入探针" : "这些定义不合适 · 改写";
  retry.addEventListener("click", () => { $("probe-input").value = input; $("probe-input").focus(); state.options = null; renderOptions(); }); box.append(retry);
  if (state.revisingId) { const cancel = document.createElement("button"); cancel.textContent = "取消修改"; cancel.addEventListener("click", () => { state.revisingId = null; state.options = null; render(); }); box.append(cancel); }
}
function renderProbes() {
  $("probe-count").textContent = `${state.probes.length} / 5`;
  const box = $("probes"); box.replaceChildren();
  for (const probe of state.probes) {
    const row = document.createElement("div"); row.className = "probe-row";
    row.classList.toggle("hidden-probe", !isProbeVisible(probe));
    const left = document.createElement("div"); left.className = "probe-left";
    const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = probe.color;
    const label = document.createElement("div"); label.textContent = probe.name;
    const type = document.createElement("small"); type.textContent = probe.primitive === "score" ? "Score · 强度" : "Noul · 命题概率"; label.append(type);
    const buttons = document.createElement("div");
    buttons.className = "probe-actions";
    const visibility = document.createElement("label"); visibility.className = "probe-visibility";
    const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", `显示「${probe.name}」的时间轴、热点和播放器柱形图`);
    toggle.checked = isProbeVisible(probe);
    const visibilityText = document.createElement("span"); visibilityText.textContent = toggle.checked ? "显示" : "不显示";
    toggle.addEventListener("change", async () => {
      probe.enabled = toggle.checked;
      state.selectedId = selectedVisibleProbeId(state.probes, state.selectedId);
      $("evidence").textContent = "点击柱形、轨道或热点可查看实际分析窗口与原句。";
      render(); await pushGraph();
      const stored = await storeDefinitions();
      if (stored) status(`「${probe.name}」已${toggle.checked ? "显示" : "隐藏"}；已有读数和分析任务不受影响。`);
    });
    visibility.append(toggle, visibilityText);
    const revise = document.createElement("button"); revise.textContent = state.revisingId === probe.id ? "取消修改" : "修改"; revise.addEventListener("click", () => { if (state.running) return; if (state.revisingId === probe.id) { state.revisingId = null; state.options = null; $("probe-input").value = ""; status("已取消修改。"); } else { state.revisingId = probe.id; state.options = null; $("probe-input").value = probe.input; $("probe-input").focus(); status(`正在修改「${probe.name}」：重新设置判断标准，旧读数会保留。`); } render(); });
    const remove = document.createElement("button"); remove.textContent = "移除"; remove.addEventListener("click", async () => { if (state.running) return; const archived = (await chrome.storage.local.get("cuewave:archivedDefinitions"))["cuewave:archivedDefinitions"] || []; archived.push(probe); await chrome.storage.local.set({ "cuewave:archivedDefinitions": archived }); state.probes = state.probes.filter((p) => p.id !== probe.id); state.selectedId = selectedVisibleProbeId(state.probes, state.selectedId); await storeDefinitions(); render(); pushGraph(); });
    buttons.append(visibility, revise, remove); left.append(dot, label); row.append(left, buttons); box.append(row);
  }
}
function renderTranscript() {
  const coverage = subtitleCoverageMs(state.segments, Math.max(state.durationMs, state.segments.at(-1)?.endMs || 0));
  $("transcript-info").textContent = state.segments.length ? `${state.source} · ${state.segments.length} 段 · 字幕时间覆盖约 ${coverage.percent}% · 末段 ${format(state.segments.at(-1).endMs)}` : "尚无字幕";
  $("analyze-button").disabled = state.running || !state.segments.length || !state.probes.length;
  $("cancel-button").hidden = !state.running;
  $("caption-toggle").checked = state.subtitleEnabled;
}
function selectedReading(id) { return state.readings.find((r) => r.id === id); }
async function showEvidence(reading) {
  const box = $("evidence"); box.replaceChildren();
  if (!reading) { box.textContent = "这段尚未有有效读数。"; return; }
  const probe = state.probes.find((p) => p.id === reading.probeId);
  const window = state.windows.find((w) => w.id === reading.windowId);
  if (!probe || !window) return;
  const heading = document.createElement("div"); heading.textContent = `${probe.name} · ${format(window.startMs)}–${format(window.endMs)} · ${reading.label}`;
  const quote = document.createElement("div"); quote.className = "quote"; quote.textContent = window.text;
  const standard = document.createElement("div"); standard.className = "subtle"; standard.textContent = `判断标准：${probe.criterion}`;
  const context = document.createElement("div"); context.className = "subtle"; context.textContent = window.context ? `前文（仅辅助理解）：${window.context}` : "无前文";
  const caveat = document.createElement("div"); caveat.className = "subtle"; caveat.textContent = probe.primitive === "score" ? `Score 原值 ${reading.raw.toFixed(2)} / ${probe.criteria.length - 1}；显示值是等级范围归一化，不是概率。${reading.confidence == null ? "" : ` 模型 confidence ${reading.confidence.toFixed(2)}，不是实测正确率。`}` : `Noul 为命题成立的模型概率；不表示文本真实性，也没有单独的 confidence。`;
  const seek = document.createElement("button"); seek.textContent = "跳回 YouTube 核对"; seek.addEventListener("click", () => jump(window.startMs));
  box.append(heading, quote, standard, context, caveat, seek);
}
async function jump(startMs) {
  if (!state.tabId || !state.videoId) return;
  const tab = await chrome.tabs.get(state.tabId).catch(() => null);
  if (new URL(tab?.url || "https://invalid.example").searchParams.get("v") !== state.videoId) return status("视频已经切换，请重新打开对应视频的侧栏。", true);
  try { await sendToContent({ action: "cuewave:seek", videoId: state.videoId, ms: Math.max(0, startMs - 2000) }); playerStatus("seek"); }
  catch (error) { playerStatus("seek", `播放器跳转失败：${error.message}`); status("跳转失败；分析读数已保留，请查看播放器连接提示。", true); }
}
async function assertBoundTab() {
  const tab = await chrome.tabs.get(state.tabId).catch(() => null);
  if (new URL(tab?.url || "https://invalid.example").searchParams.get("v") !== state.videoId) throw new Error("视频已切换，请重新打开对应视频侧栏");
}
function renderTracks() {
  const box = $("tracks"); box.replaceChildren();
  if (!state.windows.length) return;
  if (!state.probes.some(isProbeVisible)) { box.textContent = "所有探针已设为不显示；读数仍保留并继续分析。"; return; }
  const duration = Math.max(state.durationMs, state.windows.at(-1).endMs);
  for (const probe of state.probes.filter(isProbeVisible)) {
    const section = document.createElement("div"); section.className = "track";
    const head = document.createElement("div"); head.className = "track-head";
    const select = document.createElement("button"); select.textContent = `● ${probe.name}`; select.style.color = probe.color; select.classList.toggle("selected", state.selectedId === probe.id);
    select.addEventListener("click", () => { state.selectedId = probe.id; renderTracks(); pushGraph(); });
    const unit = document.createElement("small"); unit.textContent = probe.primitive === "score" ? "强度 / 100" : "命题概率 / %";
    head.append(select, unit);
    const cells = document.createElement("div"); cells.className = "cells";
    for (const window of state.windows) {
      const reading = state.readings.find((r) => r.windowId === window.id && r.probeId === probe.id);
      const cell = document.createElement("div"); cell.className = `cell ${window.status === "no_text" ? "no-text" : reading?.status === "failed" ? "failed" : reading?.status === "ok" ? "ok" : "pending"}`;
      cell.style.left = `${window.startMs / duration * 100}%`; cell.style.width = `${(window.endMs - window.startMs) / duration * 100}%`;
      if (reading?.status === "ok") { cell.style.background = probe.color; cell.style.opacity = String(Math.max(.18, reading.value)); cell.style.minWidth = "8px"; cell.style.zIndex = "2"; }
      cell.title = `${format(window.startMs)}–${format(window.endMs)} · ${window.status === "no_text" ? "无文本" : reading?.status === "ok" ? reading.label : reading?.status === "failed" ? "分析失败" : "未分析"}`;
      cell.addEventListener("click", () => { if (reading?.status === "ok") { showEvidence(reading); jump(window.startMs); } else $("evidence").textContent = cell.title; });
      cells.append(cell);
    }
    section.append(head, cells); box.append(section);
  }
}
function renderRankings() {
  const box = $("rankings"); box.replaceChildren();
  if (state.probes.length && !state.probes.some(isProbeVisible)) { box.textContent = "所有探针已设为不显示；重新打开开关即可查看原有排名。"; return; }
  for (const probe of state.probes.filter(isProbeVisible)) {
    const section = document.createElement("div"); section.className = "rank-section";
    const title = document.createElement("h4"); title.textContent = `${probe.name} · ${probe.primitive === "score" ? "强度最高" : "命题概率最高"}`; title.style.color = probe.color; section.append(title);
    const ranked = rankHotspots(state.readings, probe);
    if (!ranked.length) { const empty = document.createElement("div"); empty.className = "muted"; empty.textContent = "暂无达到阈值的热点"; section.append(empty); }
    ranked.slice(0, 5).forEach((hotspot, index) => {
      const button = document.createElement("button"); button.className = "hotspot";
      const label = document.createElement("span"); label.textContent = `#${index + 1} ${format(hotspot.startMs)}–${format(hotspot.endMs)} · ${hotspot.peak.text.slice(0, 45)}`;
      const value = document.createElement("span"); value.textContent = hotspot.peak.label;
      button.append(label, value); button.addEventListener("click", () => { showEvidence(hotspot.peak); jump(hotspot.peak.startMs); }); section.append(button);
    }); box.append(section);
    for (const boundary of state.adBoundaries.filter((item) => item.probeId === probe.id).slice(0, 10)) {
      const button = document.createElement("button"); button.className = "hotspot refined";
      button.textContent = `字幕级近似 ${format(boundary.startMs)}–${format(boundary.endMs)} · 峰值 ${Math.round(boundary.peakValue * 100)}%`;
      button.addEventListener("click", () => jump(boundary.startMs)); section.append(button);
    }
  }
}
function renderHistory() {
  const box = $("history-list"); box.replaceChildren();
  if (!state.history.length) { box.textContent = "尚无本机视频记录；也可导入此前下载的 JSON。"; return; }
  for (const item of state.history) {
    const row = document.createElement("div"); row.className = "history-row";
    const title = document.createElement("div"); title.textContent = item.title || item.videoId;
    const detail = document.createElement("small"); detail.textContent = `${item.videoId} · ${item.readingCount || 0} 个读数 · ${item.savedAt ? new Date(item.savedAt).toLocaleString() : "时间未知"}`;
    const open = document.createElement("button"); open.textContent = item.videoId === state.videoId ? "恢复" : "打开视频";
    open.addEventListener("click", async () => {
      if (state.running) return status("请先停止分析再恢复历史。", true);
      if (item.videoId !== state.videoId) { await chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${item.videoId}` }); return status("已打开原视频，请在新标签页点击 CueWave 图标查看保存结果。"); }
      await loadVideo(); await pushGraph(); await pushCaptions(); status("已恢复此视频的字幕、探针和历史读数。");
    });
    const remove = document.createElement("button"); remove.textContent = "删除本机记录";
    remove.addEventListener("click", async () => {
      if (state.running || !confirm(`删除 ${item.title || item.videoId} 的本机分析记录？已下载的 JSON 不受影响。`)) return;
      await chrome.storage.local.remove(`cuewave:video:${item.videoId}`);
      state.history = state.history.filter((entry) => entry.videoId !== item.videoId);
      state.cacheWarning = false;
      if (item.videoId === state.videoId) { state.segments = []; state.source = ""; state.windows = []; state.readings = []; state.adCueReadings = []; state.adBoundaries = []; state.usage = { inputTokens: 0, requests: 0, reportedRequests: 0 }; state.resumeOnOpen = false; await loadDefinitions(); render(); await pushGraph(); await pushCaptions(); }
      else renderHistory();
      await updateStorageUsage(); status("本机记录已删除；已下载的 JSON 文件仍可重新导入。");
    });
    const buttons = document.createElement("div"); buttons.className = "history-actions"; buttons.append(open, remove);
    row.append(title, detail, buttons); box.append(row);
  }
}
function renderProgress() {
  const p = progress(state.windows, state.readings, state.probes);
  $("save-button").disabled = !state.videoId || !state.segments.length || p.done === 0;
  const refineJobs = adRefinementJobs();
  const refineCount = refineJobs.length;
  $("refine-button").disabled = state.running || !refineCount;
  $("progress-fill").style.width = `${p.total ? p.done / p.total * 100 : 0}%`;
  $("progress-text").textContent = state.windows.length ? `${p.done}/${p.total} 个探针窗口完成 · 有效 ${p.ok} · 失败 ${p.failed} · 无文本窗口 ${p.noText} · 字幕覆盖与分析覆盖分开计算` : "确认探针并取得字幕后手动开始。";
  $("analysis-state").textContent = state.running ? "分析中" : p.total && p.done === p.total ? "已完成" : p.done ? "部分完成" : "未开始";
  const estimate = estimateAnalysisWork(state.windows, state.probes, state.readings);
  const refineTokens = refineJobs.reduce((total, { probe, segment }) => total + Math.ceil(new TextEncoder().encode(JSON.stringify({ target: segment.text,
    description: probe.description, criterion: probe.criterion, positive: probe.positive, negative: probe.negative })).length / 3) + 120, 0);
  const actualUsd = (state.usage.inputTokens || 0) / 1_000_000 * JEV_INPUT_USD_PER_MILLION;
  $("estimate-text").textContent = `待分析约 ${estimate.requests} 次 Jev 请求、${estimate.questions} 项判断；输入约 ${estimate.estimatedInputTokens.toLocaleString()} token（按文本字节粗估），参考费用约 $${estimate.estimatedUsd.toFixed(6)}。`
    + ` 成功响应累计 ${state.usage.requests || 0} 次；其中 ${state.usage.reportedRequests || 0} 次报告了 ${state.usage.inputTokens || 0} 输入 token，按当前参考价约 $${actualUsd.toFixed(6)}（未报告用量的请求不计入）。`
    + (refineCount ? ` 广告字幕级复判另需最多 ${refineCount} 次请求、粗估 ${refineTokens.toLocaleString()} 输入 token / $${(refineTokens / 1_000_000 * JEV_INPUT_USD_PER_MILLION).toFixed(6)}；只有点击按钮才会执行。` : "")
    + " 估算不含 Supadata、失败重试或价格变更。";
}
let lastStorageCheck = 0;
let storageCheckTimer = null;
async function updateStorageUsage(force = false) {
  if (!force && Date.now() - lastStorageCheck < 2000) {
    if (!storageCheckTimer) storageCheckTimer = setTimeout(() => { storageCheckTimer = null; void updateStorageUsage(true); }, 2000 - (Date.now() - lastStorageCheck));
    return;
  }
  lastStorageCheck = Date.now();
  try {
    const used = await chrome.storage.local.getBytesInUse(null);
    const quota = chrome.storage.local.QUOTA_BYTES || 10 * 1024 * 1024;
    const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);
    $("storage-text").textContent = `本机缓存 ${mb(used)} / ${mb(quota)} MiB（${Math.round(used / quota * 100)}%）${used / quota >= .8 ? " · 容量较高，建议先导出 JSON 再删除不需要的本机记录" : ""}。卸载扩展会清除此缓存。`;
  } catch { $("storage-text").textContent = "无法读取本机缓存占用；已下载的 JSON 文件不受影响。"; }
}
function render() { renderOptions(); renderProbes(); renderTranscript(); renderProgress(); renderTracks(); renderRankings(); renderHistory(); }
async function pushGraph() {
  if (!state.tabId || !state.videoId) return;
  const visibleIds = new Set(state.probes.filter(isProbeVisible).map((probe) => probe.id));
  const graph = { videoId: state.videoId, durationMs: Math.max(state.durationMs, state.windows.at(-1)?.endMs || 0), selectedId: state.selectedId,
    probes: state.probes, readings: state.readings.filter((r) => r.status === "ok" && visibleIds.has(r.probeId)),
    adBoundaries: state.adBoundaries.filter((boundary) => visibleIds.has(boundary.probeId)) };
  try { await sendToContent({ action: "cuewave:graph", graph }); playerStatus("graph"); }
  catch (error) { playerStatus("graph", `热力图无法显示：${error.message}。已完成的分析仍保存在侧栏。`); }
}
async function pushCaptions() {
  if (!state.tabId || !state.videoId) return;
  try { await sendToContent({ action: "cuewave:captions", videoId: state.videoId,
    enabled: state.subtitleEnabled, segments: state.subtitleEnabled ? state.segments : [] }); playerStatus("captions"); }
  catch (error) { playerStatus("captions", `播放器连接失败：${error.message}。已完成的分析仍保存在侧栏。`); }
}
function recordUsage(usage) {
  state.usage.requests = (state.usage.requests || 0) + 1;
  if (Number.isFinite(usage?.inputTokens)) {
    state.usage.inputTokens = (state.usage.inputTokens || 0) + usage.inputTokens;
    state.usage.reportedRequests = (state.usage.reportedRequests || 0) + 1;
  }
}
function adRefinementJobs() {
  const jobs = [];
  for (const probe of state.probes.filter((item) => item.name === "推广信息" && item.primitive === "noul")) {
    const candidates = adCandidateSegments(state.segments, rankHotspots(state.readings, probe));
    for (const segment of candidates) {
      if (!state.adCueReadings.some((reading) => reading.probeId === probe.id && reading.segmentId === segment.id && reading.status === "ok")) jobs.push({ probe, segment });
    }
  }
  return jobs;
}
async function refineAds() {
  const jobs = adRefinementJobs();
  if (state.running || !jobs.length) return;
  state.running = true; state.cancelled = false; render();
  status(`正在复判 ${jobs.length} 条热点字幕，以估计广告起止边界；可随时停止后续请求。`);
  try {
    await assertBoundTab();
    for (const { probe, segment } of jobs) {
      if (state.cancelled) break;
      const context = state.segments.filter((item) => item.startMs < segment.startMs && item.endMs > segment.startMs - 30000).map((item) => item.text).join(" ");
      try {
        const result = await api("/decide", { window: { text: segment.text, context, videoTitle: $("video-title").textContent || "" }, probes: [probe] });
        const [answer] = result.answers; recordUsage(result.usage);
        state.adCueReadings = state.adCueReadings.filter((item) => !(item.probeId === probe.id && item.segmentId === segment.id));
        state.adCueReadings.push({ probeId: probe.id, segmentId: segment.id, status: "ok", value: answer.value, raw: answer.raw, model: answer.model });
        state.adBoundaries = state.adBoundaries.filter((item) => item.probeId !== probe.id)
          .concat(buildAdBoundaries(state.segments, state.adCueReadings, probe.id));
        await safeSave(); render(); await pushGraph();
      } catch (error) { status(`广告边界细化暂停：${error.message}。已完成的字幕复判已保存，可重试剩余部分。`, true); break; }
    }
    if (state.cancelled) status("已停止后续字幕复判；已完成的近似边界保留。");
    else if (!adRefinementJobs().length) status("字幕级广告边界细化完成。边界仍受字幕时间戳精度限制。");
  } catch (error) { status(`无法细化广告边界：${error.message}`, true); }
  finally { state.running = false; render(); }
}
async function useSegments(segments, source) {
  await assertBoundTab();
  transcriptEpoch++;
  if (state.running) state.cancelled = true;
  state.segments = normalizeSegments(segments); state.source = source; state.windows = buildWindows(state.segments, state.durationMs);
  state.readings = []; state.adCueReadings = []; state.adBoundaries = []; state.resumeOnOpen = false;
  await safeSave(); render(); pushGraph(); pushCaptions();
  if (!state.cacheWarning) status(`${source}已就绪。确认探针后点击「分析视频」。`);
}
async function analyze(resumeOnly = false) {
  if (state.running || !state.probes.length || !state.segments.length) return;
  const runVideo = state.videoId;
  const videoTitle = $("video-title").textContent || "";
  state.running = true; state.cancelled = false; state.resumeOnOpen = true; render();
  status(resumeOnly ? "正在从上次保存的进度继续分析未完成窗口…" : "正在逐批分析，完成的区间会立即出现。");
  try {
  await assertBoundTab();
  const keys = {};
  for (const probe of state.probes) {
    const { id, name, color, enabled, ...semantic } = probe;
    keys[id] = await fingerprint({ segments: state.segments, semantic, videoTitle, model: MODEL, widthMs: WINDOW_MS });
  }
  await safeSave();
  for (const window of state.windows) {
    if (state.cancelled || state.videoId !== runVideo) break;
    if (window.status === "no_text") continue;
    const missing = state.probes.filter((p) => !hasReusableReading(state.readings, window.id, p.id, keys[p.id]) &&
      (!resumeOnly || !state.readings.some((reading) => reading.windowId === window.id && reading.probeId === p.id && reading.status === "failed")));
    if (!missing.length) continue;
    try {
      const result = await api("/decide", { window: { text: window.text, context: window.context, videoTitle }, probes: missing });
      recordUsage(result.usage);
      if (state.cancelled || state.videoId !== runVideo) { await safeSave(); break; }
      const answers = result.answers;
      missing.forEach((probe, i) => { const answer = answers[i]; state.readings = state.readings.filter((r) => !(r.windowId === window.id && r.probeId === probe.id)); state.readings.push({ id: `${window.id}:${probe.id}`, probeKey: keys[probe.id], windowId: window.id, startMs: window.startMs, endMs: window.endMs, text: window.text, status: "ok", ...answer }); });
    } catch (error) {
      if (state.cancelled || state.videoId !== runVideo) break;
      missing.forEach((probe) => { state.readings = state.readings.filter((r) => !(r.windowId === window.id && r.probeId === probe.id)); state.readings.push({ id: `${window.id}:${probe.id}`, probeKey: keys[probe.id], windowId: window.id, probeId: probe.id, startMs: window.startMs, endMs: window.endMs, status: "failed", error: error.message }); });
      status(`某批分析失败：${error.message}。可再次点击分析重试失败窗口。`, true);
    }
    await safeSave(); render(); await pushGraph();
  }
  if (state.cancelled) status("已停止后续请求；成功读数已保留。");
  else if (state.videoId === runVideo) status(state.cacheWarning ? "本轮分析结束，但本机缓存未能完整写入；请立即点击「保存结果」下载 JSON。" : "本轮分析结束。点击各探针的排名前两位核对原句与视频。");
  } catch (error) { status(`分析中断：${error.message}`, true); }
  finally {
    if (!state.cancelled) state.resumeOnOpen = hasPendingAnalysis(state.windows, state.probes, state.readings);
    await safeSave(); state.running = false; render();
  }
}

$("probe-form").addEventListener("submit", (event) => { event.preventDefault(); const input = $("probe-input").value.trim(); if (input) checkInput(input); });
document.querySelectorAll(".seed").forEach((button) => button.addEventListener("click", () => checkInput(button.dataset.value)));
let fetchingTranscript = false;
async function fetchAuto() {
  if (!state.videoId || fetchingTranscript) return;
  const epoch = transcriptEpoch; const videoId = state.videoId;
  fetchingTranscript = true; $("auto-button").disabled = true; status("正在获取原生时间戳字幕…");
  try { await assertBoundTab(); const result = await api("/transcript", { videoId }); if (epoch === transcriptEpoch && videoId === state.videoId) await useSegments(result.segments, "Supadata 原生字幕"); }
  catch (error) { if (epoch === transcriptEpoch && videoId === state.videoId) status(`${error.message}；请导入该视频的 SRT/VTT。`, true); }
  finally { fetchingTranscript = false; $("auto-button").disabled = false; }
}
$("auto-button").addEventListener("click", fetchAuto);
$("import-file").addEventListener("change", async (event) => { const file = event.target.files?.[0]; if (!file) return; try { await useSegments(parseCaptions(await file.text()), `导入 ${file.name}`); } catch (error) { status(error.message, true); } event.target.value = ""; });
$("caption-toggle").addEventListener("change", async (event) => {
  state.subtitleEnabled = event.target.checked;
  await chrome.storage.local.set({ "cuewave:captionOverlay": state.subtitleEnabled });
  await pushCaptions();
  status(state.subtitleEnabled ? "已开启 CueWave 同步字幕；如与 YouTube 字幕重叠，可关闭其中一处。" : "已关闭 CueWave 同步字幕。");
});
$("import-analysis-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (state.running) throw new Error("请先停止当前分析");
    if (file.size > 20_000_000) throw new Error("分析文件超过 20 MB，请检查是否为 CueWave 导出的 JSON");
    const record = parseVideoExport(JSON.parse(await file.text()));
    record.selectedId = selectedVisibleProbeId(record.probes, null);
    await saveRecord(record); await updateStorageUsage();
    if (record.videoId === state.videoId) { await loadVideo(); await pushGraph(); await pushCaptions(); status("已导入并恢复当前视频的字幕、探针和时间轴。"); }
    else status(`已导入 ${record.title || record.videoId} 的历史分析。点击历史列表中的「打开视频」可查看。`);
  } catch (error) { status(`导入失败：${error.message}`, true); }
  event.target.value = "";
});
$("analyze-button").addEventListener("click", () => analyze(false));
$("refine-button").addEventListener("click", refineAds);
$("save-button").addEventListener("click", async () => {
  try {
    const exported = buildVideoExport({ videoId: state.videoId, title: $("video-title").textContent || "", durationMs: state.durationMs,
      source: state.source, segments: state.segments, windows: state.windows, probes: state.probes, readings: state.readings,
      adCueReadings: state.adCueReadings, adBoundaries: state.adBoundaries, usage: state.usage,
      savedAt: new Date().toISOString() });
    const file = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `CueWave-${state.videoId}-${exported.savedAt.replace(/[:.]/g, "-")}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    let cacheError = null;
    try { await save(); } catch (error) { cacheError = error; }
    const p = exported.analysis.progress;
    status(`已发起下载：${link.download}。包含 ${exported.transcript.segments.length} 段字幕及 ${p.ok} 个有效读数${p.done < p.total ? "；未完成窗口标为 pending" : ""}${cacheError ? "；浏览器内缓存未能更新，但下载已发起" : ""}。`);
  } catch (error) { status(`保存失败：${error.message}`, true); }
});
$("cancel-button").addEventListener("click", () => { state.cancelled = true; state.resumeOnOpen = false; void safeSave(); status("当前请求结束后停止派发，重新打开侧栏也不会自动续跑；可手动点击分析继续。"); });
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.tab?.id !== state.tabId) return;
  if (message.action === "cuewave:evidence" && message.videoId === state.videoId) showEvidence(selectedReading(message.readingId));
  if (message.action === "cuewave:navigated" && message.videoId !== state.videoId) {
    state.cancelled = true; transcriptEpoch++; status("视频已切换；重新打开对应视频侧栏。", true);
  }
});
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== "local") return;
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith("cuewave:video:")) continue;
    historyRevision++;
    if (change.newValue && typeof change.newValue === "object") updateHistoryItem({ ...change.newValue, videoId: key.slice("cuewave:video:".length) });
    else { state.history = state.history.filter((item) => item.videoId !== key.slice("cuewave:video:".length)); renderHistory(); }
  }
});

async function init() {
  const panelTabId = Number(new URLSearchParams(location.search).get("tabId"));
  if (!Number.isSafeInteger(panelTabId) || panelTabId <= 0) return status("侧栏缺少标签页身份；请在 chrome://extensions 重新加载扩展后，从 YouTube 视频标签页打开 CueWave。", true);
  const tab = await chrome.tabs.get(panelTabId).catch(() => null);
  if (!tab?.id || !/^https:\/\/www\.youtube\.com\/watch\?/.test(tab.url || "")) return status("此侧栏所属标签页不是 YouTube 视频。", true);
  state.tabId = tab.id; state.videoId = new URL(tab.url).searchParams.get("v");
  let info = null;
  try { info = await sendToContent({ action: "cuewave:info" }, (reply) => reply?.videoId === state.videoId); playerStatus("info"); }
  catch (error) { playerStatus("info", `播放器连接失败：${error.message}。可先查看已保存结果；请刷新视频页或重新加载扩展。`); }
  state.durationMs = info?.durationMs || 0;
  $("video-title").textContent = info?.title || tab.title || "YouTube 视频";
  $("video-meta").textContent = `${state.videoId || "未知视频"} · ${state.durationMs ? format(state.durationMs) : "时长待获取"}`;
  const settings = await chrome.storage.local.get(["cuewave:captionOverlay"]);
  state.subtitleEnabled = settings["cuewave:captionOverlay"] === true;
  await refreshHistory();
  await loadDefinitions(); await loadVideo();
  try {
    const response = await fetch(`${API}/health`); state.helper = await response.json();
    if (state.helper.capabilities.manualProbes) {
      $("probe-hint").textContent = "Gemini 已暂停。先输入探针，再手动校准标准、正反例和 Jev 读数类型。";
      $("probe-submit").textContent = "编辑定义";
    } else {
      $("probe-hint").textContent = "先用 Gemini 检查含义；有歧义时请选择具体判断对象。";
      $("probe-submit").textContent = "检查含义";
    }
    status(`本机辅助进程已连接 · Gemini ${state.helper.capabilities.manualProbes ? "已暂停" : state.helper.capabilities.gemini ? "已配置" : "未配置"} · Jev ${state.helper.capabilities.jev ? "已配置" : "未配置"} · Supadata ${state.helper.capabilities.supadata ? "已配置" : "未配置"}（使用时验证）`);
  }
  catch { status("本机辅助进程未启动：在仓库运行 npm start。", true); }
  render(); pushGraph(); pushCaptions(); updateStorageUsage(true);
  if (state.helper?.capabilities.supadata && !state.segments.length) void fetchAuto();
  if (state.resumeOnOpen && state.segments.length && state.probes.length) {
    if (hasPendingAnalysis(state.windows, state.probes, state.readings)) {
      if (state.helper?.capabilities.jev) void analyze(true);
      else status("检测到未完成分析；请启动已配置 Jev 的 npm start 后重新打开此侧栏，以自动续跑。", true);
    } else { state.resumeOnOpen = false; void safeSave(); }
  }
}
init();
