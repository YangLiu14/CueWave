import { parseCaptions, normalizeSegments, buildWindows, subtitleCoverageMs, rankHotspots, progress, fingerprint, MODEL, WINDOW_MS } from "./core.js";

const $ = (id) => document.getElementById(id);
const COLORS = ["#5ddbc8", "#f4b860", "#a895f2", "#e879a2", "#8eb7f3"];
const API = "http://127.0.0.1:4318";
const state = { tabId: null, videoId: null, durationMs: 0, segments: [], source: "", probes: [], options: null, revisingId: null, windows: [], readings: [], selectedId: null, running: false, cancelled: false, helper: null };
let transcriptEpoch = 0;
let checkSequence = 0;
const format = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, "0")}`;
function status(message, error = false) { $("status").textContent = message; $("status").classList.toggle("error", error); }
async function api(path, body) {
  const response = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || `本机服务错误 ${response.status}`); error.code = result.code; error.retryable = result.retryable; throw error; }
  return result;
}
async function save() {
  if (!state.videoId) return;
  await chrome.storage.local.set({ [`cuewave:video:${state.videoId}`]: { segments: state.segments, source: state.source, readings: state.readings } });
}
async function loadVideo() {
  const saved = (await chrome.storage.local.get(`cuewave:video:${state.videoId}`))[`cuewave:video:${state.videoId}`];
  if (!saved) return;
  state.segments = saved.segments || []; state.source = saved.source || "";
  state.readings = saved.readings || [];
  if (state.segments.length) state.windows = buildWindows(state.segments, state.durationMs);
  render();
}
async function loadDefinitions() {
  const saved = (await chrome.storage.local.get("cuewave:definitions"))["cuewave:definitions"] || [];
  state.probes = saved.slice(0, 5); state.selectedId = state.probes[0]?.id || null;
  render();
}
async function storeDefinitions() { await chrome.storage.local.set({ "cuewave:definitions": state.probes }); }
function probeFromOption(input, option) {
  const id = crypto.randomUUID();
  const previous = state.probes.find((probe) => probe.id === state.revisingId);
  return { id, input, name: option.name.slice(0, 40), description: option.description, criterion: option.criterion, positive: option.positive, negative: option.negative,
    primitive: option.primitive, criteria: option.primitive === "score" ? [option.negative, `部分满足：${option.criterion}`, option.positive] : null,
    color: previous?.color || COLORS[state.probes.length], enabled: true, revision: (previous?.revision || 0) + 1, previousId: previous?.id || null };
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
    if (result.manual && previous?.input === input && !legacyPromotion) {
      result.options = [{ name: previous.name, description: previous.description, criterion: previous.criterion,
        positive: previous.positive, negative: previous.negative, primitive: previous.primitive }];
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
    for (const [key, label] of [["name", "探针名称"], ["description", "观察什么"], ["criterion", "判断标准"], ["positive", "高值 / 是"], ["negative", "低值 / 否"]]) {
      const field = document.createElement("label"); field.className = "option-field"; field.textContent = label;
      const control = document.createElement(key === "name" ? "input" : "textarea");
      control.value = draft[key]; control.maxLength = key === "name" ? 40 : 800;
      if (key !== "name") control.rows = 2;
      control.addEventListener("input", () => { draft[key] = control.value; });
      field.append(control); card.append(field);
    }
    const typeField = document.createElement("label"); typeField.className = "option-field"; typeField.textContent = "Jev 读数类型";
    const primitive = document.createElement("select");
    for (const [value, label] of [["noul", "Noul · 是否明确出现"], ["score", "Score · 强度分级"]]) {
      const choice = document.createElement("option"); choice.value = value; choice.textContent = label; primitive.append(choice);
    }
    primitive.value = draft.primitive;
    primitive.addEventListener("change", () => { draft.primitive = primitive.value; });
    typeField.append(primitive); card.append(typeField);
    const button = document.createElement("button"); button.textContent = "确认此定义";
    button.addEventListener("click", async () => {
      if (state.running || !state.options || state.options.input !== input || (state.probes.length >= 5 && !state.revisingId)) return;
      const option = Object.fromEntries(["name", "description", "criterion", "positive", "negative", "primitive"].map((key) => [key, String(draft[key] || "").trim()]));
      if (["name", "description", "criterion", "positive", "negative"].some((key) => !option[key])) return status("请填写完整的名称、观察内容、标准和高低值定义。", true);
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
      await storeDefinitions(); $("probe-input").value = ""; render(); pushGraph(); status(`已确认「${probe.name}」。分析前可继续添加探针。`);
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
    const left = document.createElement("div"); left.className = "probe-left";
    const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = probe.color;
    const label = document.createElement("div"); label.textContent = probe.name;
    const type = document.createElement("small"); type.textContent = probe.primitive === "score" ? "Score · 强度" : "Noul · 命题概率"; label.append(type);
    const buttons = document.createElement("div");
    const revise = document.createElement("button"); revise.textContent = state.revisingId === probe.id ? "取消修改" : "修改"; revise.addEventListener("click", () => { if (state.running) return; if (state.revisingId === probe.id) { state.revisingId = null; state.options = null; $("probe-input").value = ""; status("已取消修改。"); } else { state.revisingId = probe.id; state.options = null; $("probe-input").value = probe.input; $("probe-input").focus(); status(`正在修改「${probe.name}」：重新设置判断标准，旧读数会保留。`); } render(); });
    const remove = document.createElement("button"); remove.textContent = "移除"; remove.addEventListener("click", async () => { if (state.running) return; const archived = (await chrome.storage.local.get("cuewave:archivedDefinitions"))["cuewave:archivedDefinitions"] || []; archived.push(probe); await chrome.storage.local.set({ "cuewave:archivedDefinitions": archived }); state.probes = state.probes.filter((p) => p.id !== probe.id); if (state.selectedId === probe.id) state.selectedId = state.probes[0]?.id; await storeDefinitions(); render(); pushGraph(); });
    buttons.append(revise, remove); left.append(dot, label); row.append(left, buttons); box.append(row);
  }
}
function renderTranscript() {
  const coverage = subtitleCoverageMs(state.segments, Math.max(state.durationMs, state.segments.at(-1)?.endMs || 0));
  $("transcript-info").textContent = state.segments.length ? `${state.source} · ${state.segments.length} 段 · 字幕时间覆盖约 ${coverage.percent}% · 末段 ${format(state.segments.at(-1).endMs)}` : "尚无字幕";
  $("analyze-button").disabled = state.running || !state.segments.length || !state.probes.length;
  $("cancel-button").hidden = !state.running;
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
  await chrome.tabs.sendMessage(state.tabId, { action: "cuewave:seek", videoId: state.videoId, ms: Math.max(0, startMs - 2000) }).catch(() => {});
}
async function assertBoundTab() {
  const tab = await chrome.tabs.get(state.tabId).catch(() => null);
  if (new URL(tab?.url || "https://invalid.example").searchParams.get("v") !== state.videoId) throw new Error("视频已切换，请重新打开对应视频侧栏");
}
function renderTracks() {
  const box = $("tracks"); box.replaceChildren();
  if (!state.windows.length) return;
  const duration = Math.max(state.durationMs, state.windows.at(-1).endMs);
  for (const probe of state.probes) {
    const section = document.createElement("div"); section.className = "track";
    const head = document.createElement("div"); head.className = "track-head";
    const select = document.createElement("button"); select.textContent = `● ${probe.name}`; select.style.color = probe.color; select.classList.toggle("selected", state.selectedId === probe.id);
    select.addEventListener("click", () => { state.selectedId = probe.id; renderTracks(); pushGraph(); });
    const unit = document.createElement("small"); unit.textContent = probe.primitive === "score" ? "强度 / 100" : "命题概率 / %";
    head.append(select, unit);
    const cells = document.createElement("div"); cells.className = "cells";
    for (const window of state.windows) {
      const reading = state.readings.find((r) => r.windowId === window.id && r.probeId === probe.id);
      const cell = document.createElement("div"); cell.className = `cell ${window.status === "no_text" ? "no-text" : reading?.status === "failed" ? "failed" : reading?.status === "ok" ? "" : "pending"}`;
      cell.style.left = `${window.startMs / duration * 100}%`; cell.style.width = `${(window.endMs - window.startMs) / duration * 100}%`;
      if (reading?.status === "ok") { cell.style.background = probe.color; cell.style.opacity = String(Math.max(.18, reading.value)); }
      cell.title = `${format(window.startMs)}–${format(window.endMs)} · ${window.status === "no_text" ? "无文本" : reading?.status === "ok" ? reading.label : reading?.status === "failed" ? "分析失败" : "未分析"}`;
      cell.addEventListener("click", () => { if (reading?.status === "ok") { showEvidence(reading); jump(window.startMs); } else $("evidence").textContent = cell.title; });
      cells.append(cell);
    }
    section.append(head, cells); box.append(section);
  }
}
function renderRankings() {
  const box = $("rankings"); box.replaceChildren();
  for (const probe of state.probes) {
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
  }
}
function renderProgress() {
  const p = progress(state.windows, state.readings, state.probes);
  $("progress-fill").style.width = `${p.total ? p.done / p.total * 100 : 0}%`;
  $("progress-text").textContent = state.windows.length ? `${p.done}/${p.total} 个探针窗口完成 · 有效 ${p.ok} · 失败 ${p.failed} · 无文本窗口 ${p.noText} · 字幕覆盖与分析覆盖分开计算` : "确认探针并取得字幕后手动开始。";
  $("analysis-state").textContent = state.running ? "分析中" : p.total && p.done === p.total ? "已完成" : p.done ? "部分完成" : "未开始";
}
function render() { renderOptions(); renderProbes(); renderTranscript(); renderProgress(); renderTracks(); renderRankings(); }
async function pushGraph() {
  if (!state.tabId || !state.videoId) return;
  const graph = { videoId: state.videoId, durationMs: Math.max(state.durationMs, state.windows.at(-1)?.endMs || 0), selectedId: state.selectedId, probes: state.probes, readings: state.readings.filter((r) => r.status === "ok") };
  await chrome.tabs.sendMessage(state.tabId, { action: "cuewave:graph", graph }).catch(() => {});
}
async function useSegments(segments, source) {
  await assertBoundTab();
  transcriptEpoch++;
  if (state.running) state.cancelled = true;
  state.segments = normalizeSegments(segments); state.source = source; state.windows = buildWindows(state.segments, state.durationMs);
  state.readings = []; await save(); render(); pushGraph(); status(`${source}已就绪。确认探针后点击「分析视频」。`);
}
async function analyze() {
  if (state.running || !state.probes.length || !state.segments.length) return;
  const runVideo = state.videoId;
  const videoTitle = $("video-title").textContent || "";
  state.running = true; state.cancelled = false; render(); status("正在逐批分析，完成的区间会立即出现。");
  try {
  await assertBoundTab();
  const keys = {};
  for (const probe of state.probes) {
    const { id, name, color, enabled, ...semantic } = probe;
    keys[id] = await fingerprint({ segments: state.segments, semantic, videoTitle, model: MODEL, widthMs: WINDOW_MS });
  }
  await save();
  for (const window of state.windows) {
    if (state.cancelled || state.videoId !== runVideo) break;
    if (window.status === "no_text") continue;
    const missing = state.probes.filter((p) => !state.readings.some((r) => r.windowId === window.id && r.probeId === p.id && r.probeKey === keys[p.id] && r.status === "ok"));
    if (!missing.length) continue;
    try {
      const answers = await api("/decide", { window: { text: window.text, context: window.context, videoTitle }, probes: missing });
      if (state.cancelled || state.videoId !== runVideo) break;
      missing.forEach((probe, i) => { const answer = answers[i]; state.readings = state.readings.filter((r) => !(r.windowId === window.id && r.probeId === probe.id)); state.readings.push({ id: `${window.id}:${probe.id}`, probeKey: keys[probe.id], windowId: window.id, startMs: window.startMs, endMs: window.endMs, text: window.text, status: "ok", ...answer }); });
    } catch (error) {
      if (state.cancelled || state.videoId !== runVideo) break;
      missing.forEach((probe) => { state.readings = state.readings.filter((r) => !(r.windowId === window.id && r.probeId === probe.id)); state.readings.push({ id: `${window.id}:${probe.id}`, probeKey: keys[probe.id], windowId: window.id, probeId: probe.id, startMs: window.startMs, endMs: window.endMs, status: "failed", error: error.message }); });
      status(`某批分析失败：${error.message}。可再次点击分析重试失败窗口。`, true);
    }
    await save(); render(); await pushGraph();
  }
  if (state.cancelled) status("已停止后续请求；成功读数已保留。");
  else if (state.videoId === runVideo) status("本轮分析结束。点击各探针的排名前两位核对原句与视频。");
  } catch (error) { status(`分析中断：${error.message}`, true); }
  finally { state.running = false; render(); }
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
$("analyze-button").addEventListener("click", analyze);
$("cancel-button").addEventListener("click", () => { state.cancelled = true; status("当前请求结束后停止派发。"); });
chrome.runtime.onMessage.addListener((message) => { if (message.action === "cuewave:evidence" && message.videoId === state.videoId) showEvidence(selectedReading(message.readingId)); if (message.action === "cuewave:navigated" && message.videoId !== state.videoId) { state.cancelled = true; transcriptEpoch++; status("视频已切换；重新打开对应视频侧栏。", true); } });

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/www\.youtube\.com\/watch\?/.test(tab.url || "")) return status("请在 YouTube 视频页点击扩展图标。", true);
  state.tabId = tab.id; const info = await chrome.tabs.sendMessage(tab.id, { action: "cuewave:info" }).catch(() => null);
  state.videoId = info?.videoId || new URL(tab.url).searchParams.get("v"); state.durationMs = info?.durationMs || 0;
  $("video-title").textContent = info?.title || tab.title || "YouTube 视频";
  $("video-meta").textContent = `${state.videoId || "未知视频"} · ${state.durationMs ? format(state.durationMs) : "时长待获取"}`;
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
  render(); pushGraph();
  if (state.helper?.capabilities.supadata && !state.segments.length) void fetchAuto();
}
init();
