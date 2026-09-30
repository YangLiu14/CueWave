import { parseCaptions, parseVideoExport, normalizeSegments, buildWindows, buildVideoExport, adCandidateSegments, buildAdBoundaries, estimateAnalysisWork, hasReusableReading, hasPendingAnalysis, isProbeVisible, selectedVisibleProbeId, probePolarity, JEV_INPUT_USD_PER_MILLION, rankHotspots, progress, fingerprint, MODEL, WINDOW_MS } from "./core.js";

const $ = (id) => document.getElementById(id);
const COLORS = ["#178d78", "#ec6445", "#8470cf", "#e879a2", "#8eb7f3"];
const LEGACY_COLORS = new Map([["#5ddbc8", COLORS[0]], ["#f4b860", COLORS[1]], ["#a895f2", COLORS[2]]]);
const API = "http://127.0.0.1:4318";
const THEME_KEY = "cuewave:theme";
const state = { tabId: null, videoId: null, durationMs: 0, currentTimeMs: 0, segments: [], source: "", probes: [], probesExpanded: false, options: null, revisingId: null, newProbePolarity: "positive", addingProbe: false, windows: [], readings: [], adCueReadings: [], adBoundaries: [], usage: { inputTokens: 0, requests: 0, reportedRequests: 0 }, history: [], selectedId: null, subtitleEnabled: false, cacheWarning: false, resumeOnOpen: false, running: false, cancelled: false, helper: null };
const normalizeProbeColors = (probes) => probes.map((probe) => ({ ...probe,
  color: LEGACY_COLORS.get(String(probe.color).toLowerCase()) || probe.color,
  polarity: probePolarity(probe) }));
const polarityLabel = (probe) => probePolarity(probe) === "negative" ? "反向 ↓" : "正向 ↑";
let transcriptEpoch = 0;
let optionFieldSerial = 0;
const format = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, "0")}`;
function setCssVariable(node, name, value) {
  if (node?.style?.setProperty) node.style.setProperty(name, value);
  else if (node?.style) node.style[name] = value;
}
function setPlaybackTime(ms) {
  state.currentTimeMs = Math.max(0, Number(ms) || 0);
  const time = $("playback-time");
  time.textContent = format(state.currentTimeMs);
  time.setAttribute("datetime", `PT${Math.round(state.currentTimeMs / 1000)}S`);
  const duration = Math.max(state.durationMs, state.windows.at(-1)?.endMs || 0, 1);
  const position = `${Math.min(100, state.currentTimeMs / duration * 100)}%`;
  document.querySelectorAll(".cue-cursor").forEach((cursor) => { cursor.style.left = position; });
  document.querySelectorAll(".cue-cursor-time").forEach((label) => { label.textContent = format(state.currentTimeMs); });
}
function setHeaderClock(date = new Date()) {
  const weekday = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][date.getDay()];
  $("masthead-clock").textContent = `${weekday} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function applyTheme(value) {
  const theme = value === "transit" ? "transit" : "gate";
  if (document.documentElement?.dataset) document.documentElement.dataset.theme = theme;
  $("theme-gate").setAttribute("aria-pressed", String(theme === "gate"));
  $("theme-transit").setAttribute("aria-pressed", String(theme === "transit"));
  return theme;
}
async function chooseTheme(theme) {
  const value = applyTheme(theme);
  if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [THEME_KEY]: value });
}
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
  state.probes = saved.probes ? normalizeProbeColors(saved.probes.slice(0, 5)) : state.probes;
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
  state.probes = normalizeProbeColors(saved.slice(0, 5)); state.selectedId = selectedVisibleProbeId(state.probes, state.selectedId);
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
    polarity: option.polarity === "negative" ? "negative" : "positive", primitive: option.primitive, middle: option.primitive === "score" ? option.middle : null,
    criteria: option.primitive === "score" ? [option.negative, option.middle, option.positive] : null,
    color: previous?.color || COLORS[state.probes.length], enabled: previous?.enabled !== false, revision: (previous?.revision || 0) + 1, previousId: previous?.id || null };
}
function setNewProbePolarity(polarity) {
  state.newProbePolarity = polarity === "negative" ? "negative" : "positive";
  const finding = state.newProbePolarity === "positive";
  $("probe-intent-find").setAttribute("aria-pressed", String(finding));
  $("probe-intent-avoid").setAttribute("aria-pressed", String(!finding));
  $("probe-input").placeholder = finding ? "例如：知识科普、实操步骤、精彩观点" : "例如：插入口播广告、无聊片段、术语堆砌";
  $("probe-input").setAttribute("aria-label", finding ? "描述想寻找的内容" : "描述不想看到的内容");
}
async function addQuickProbe(input, polarity = state.newProbePolarity) {
  if (state.addingProbe) return;
  if (state.running) return status("请等待本轮分析结束或停止后添加探针。", true);
  if (state.options) return status("请先保存或取消当前探针的高级设置。", true);
  if (state.probes.length >= 5) return status("最多可启用 5 个探针", true);
  state.addingProbe = true; renderPresetButtons();
  status("正在生成基础定义…");
  try {
    const result = await api("/probe/check", { input, polarity });
    const option = result.options?.[0];
    if (!option) throw new Error("未能生成基础定义");
    if (state.probes.some((probe) => probe.input === input || probe.name === option.name)) return status(`「${option.name}」已经在语义线路中。`, true);
    const probe = probeFromOption(input, option);
    state.probes.push(probe); state.selectedId = probe.id;
    const stored = await storeDefinitions();
    $("probe-input").value = ""; render(); void pushGraph();
    if (stored) status(`已添加「${probe.name}」· ${polarityLabel(probe)}。需要调整判断边界时，可点击「展开全部 → 高级设置」。`);
  } catch (error) { status(`${error.message}。请稍后重试。`, true); }
  finally { state.addingProbe = false; renderPresetButtons(); }
}
function openAdvancedSettings(probe) {
  if (state.running) return status("请等待本轮分析结束或停止后修改探针。", true);
  state.revisingId = probe.id;
  state.options = { input: probe.input, result: { manual: true,
    reason: "基础定义已可直接使用；这里只用于修改特殊判断边界。",
    options: [{ name: probe.name, description: probe.description, criterion: probe.criterion,
      positive: probe.positive, middle: probe.middle || probe.criteria?.[1] || "", negative: probe.negative,
      polarity: probePolarity(probe), primitive: probe.primitive }] } };
  render();
  $("options").scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  status(`正在调整「${probe.name}」的高级定义；取消不会改变当前探针。`);
}
function renderPresetButtons() {
  const blocked = state.addingProbe || Boolean(state.options) || state.running || state.probes.length >= 5;
  $("probe-submit").disabled = blocked;
  $("probe-submit-label").textContent = state.addingProbe ? "生成中" : "添加";
  $("probe-submit").setAttribute("aria-label", state.addingProbe ? "正在生成语义探针" : "添加语义探针");
  $("probe-intent-find").disabled = state.addingProbe || Boolean(state.options) || state.running;
  $("probe-intent-avoid").disabled = state.addingProbe || Boolean(state.options) || state.running;
  document.querySelectorAll(".seed").forEach((button) => {
    const added = state.probes.some((probe) => probe.input === button.dataset.value || probe.name === button.dataset.value);
    const direction = button.dataset.polarity === "negative" ? "反向" : "正向";
    button.disabled = added || blocked;
    button.classList.toggle("seed-added", added);
    button.setAttribute("aria-label", added ? `${button.dataset.value}${direction}探针已添加` : state.options ? `请先完成或取消当前探针定义` : `使用${direction}预设探针${button.dataset.value}`);
  });
}
const FIELD_HELP = {
  name: "用于线路、时间轴和结果中的简短名称。建议 2–12 个字，只描述一个判断目标。",
  description: "用一句话说明这个探针观察什么。描述判断对象，不需要在这里写规则或例子。",
  criterion: "写清命中需要哪些可观察的语言证据、哪些情况应排除，以及前文 context 是否只能用于理解指代。",
  positive: "描述明确命中或高值时应该出现的语言证据。尽量给出可判断的表达特征，而不是只写“很好”或“很多”。",
  middle: "只用于程度型探针。描述介于低值和高值之间、证据存在但不充分的情况。",
  negative: "描述不命中或低值时的情况，包括容易误判但应该排除的反例。",
  primitive: "“是否出现”适合明确的有／无判断；“程度高低”适合从弱到强的连续评价。",
  polarity: "正向表示高值内容更值得关注，柱形向上；反向表示高值内容更需要警惕，柱形向下。"
};
function makeField(card, draft, key, label, kind = "textarea") {
  const id = `probe-option-${key}-${++optionFieldSerial}`;
  const field = document.createElement("div"); field.className = "option-field";
  const head = document.createElement("div"); head.className = "option-field-head";
  const fieldLabel = document.createElement("label"); fieldLabel.htmlFor = id; fieldLabel.textContent = label;
  const help = document.createElement("span"); help.className = "field-help";
  const helpButton = document.createElement("button"); helpButton.type = "button"; helpButton.className = "field-help-button";
  helpButton.textContent = "?"; helpButton.setAttribute("aria-label", `${label}填写帮助`); helpButton.setAttribute("aria-expanded", "false");
  const tooltip = document.createElement("span"); tooltip.id = `${id}-help`; tooltip.className = "field-tooltip"; tooltip.setAttribute("role", "tooltip"); tooltip.textContent = FIELD_HELP[key];
  helpButton.setAttribute("aria-describedby", tooltip.id);
  helpButton.addEventListener("click", () => {
    const open = !help.classList.contains("open"); help.classList.toggle("open", open); helpButton.setAttribute("aria-expanded", String(open));
  });
  help.append(helpButton, tooltip); head.append(fieldLabel, help);
  const control = document.createElement(kind); control.id = id; control.value = draft[key] || "";
  field.append(head, control); card.append(field);
  return { field, control };
}
function renderOptions() {
  const box = $("options"); box.replaceChildren();
  if (!state.options) { renderPresetButtons(); return; }
  const { input, result } = state.options;
  state.options.drafts ||= result.options.map((option) => ({ ...option }));
  const heading = document.createElement("h3"); heading.className = "advanced-heading"; heading.textContent = "高级设置";
  const intro = document.createElement("p"); intro.className = "hint"; intro.textContent = result.reason;
  box.append(heading, intro);
  for (const draft of state.options.drafts) {
    const card = document.createElement("div"); card.className = "option";
    let middleField;
    for (const [key, label] of [["name", "探针名称"], ["description", "观察什么"], ["criterion", "判断标准"], ["positive", "高值 / 是"], ["middle", "中值（仅程度型）"], ["negative", "低值 / 否"]]) {
      const { field, control } = makeField(card, draft, key, label, key === "name" ? "input" : "textarea");
      control.maxLength = key === "name" ? 40 : 800;
      if (key !== "name") control.rows = 2;
      control.addEventListener("input", () => { draft[key] = control.value; });
      if (key === "middle") middleField = field;
    }
    const { control: primitive } = makeField(card, draft, "primitive", "判断方式", "select");
    for (const [value, label] of [["noul", "是否出现"], ["score", "程度高低"]]) {
      const choice = document.createElement("option"); choice.value = value; choice.textContent = label; primitive.append(choice);
    }
    primitive.value = draft.primitive;
    middleField.hidden = draft.primitive !== "score";
    primitive.addEventListener("change", () => { draft.primitive = primitive.value; middleField.hidden = primitive.value !== "score"; });
    const { control: polarity } = makeField(card, draft, "polarity", "探针方向", "select");
    for (const [value, label] of [["positive", "正向 ↑ · 高值表示更值得关注"], ["negative", "反向 ↓ · 高值表示更需要警惕"]]) {
      const choice = document.createElement("option"); choice.value = value; choice.textContent = label; polarity.append(choice);
    }
    draft.polarity = draft.polarity === "negative" ? "negative" : "positive";
    polarity.value = draft.polarity;
    polarity.addEventListener("change", () => { draft.polarity = polarity.value; });
    const button = document.createElement("button"); button.textContent = "保存高级设置";
    button.addEventListener("click", async () => {
      if (state.running || !state.options || state.options.input !== input || !state.revisingId) return;
      const option = Object.fromEntries(["name", "description", "criterion", "positive", "middle", "negative", "primitive", "polarity"].map((key) => [key, String(draft[key] || "").trim()]));
      if (["name", "description", "criterion", "positive", "negative"].some((key) => !option[key])) return status("请填写完整的名称、观察内容、标准和高低值定义。", true);
      if (option.primitive === "score" && !option.middle) return status("程度型探针还需要填写中值标准。", true);
      const probe = probeFromOption(input, option);
      const previous = state.probes.find((p) => p.id === state.revisingId);
      if (!previous) return status("没有找到要修改的探针，请关闭高级设置后重试。", true);
      const archived = (await chrome.storage.local.get("cuewave:archivedDefinitions"))["cuewave:archivedDefinitions"] || [];
      archived.push(previous); await chrome.storage.local.set({ "cuewave:archivedDefinitions": archived });
      state.probes = state.probes.map((p) => p.id === previous.id ? probe : p);
      state.options = null;
      state.revisingId = null; state.selectedId = probe.id;
      const stored = await storeDefinitions(); $("probe-input").value = ""; render(); pushGraph();
      if (stored) status(`已保存「${probe.name}」的高级设置；已有旧读数仍会保留，可重新分析生成新定义的读数。`);
    });
    card.append(button); box.append(card);
  }
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "cancel-definition";
  cancel.textContent = "取消高级设置";
  cancel.addEventListener("click", () => {
    state.revisingId = null; state.options = null; $("probe-input").value = ""; render();
    status("已取消高级设置，原探针保持不变。");
  });
  box.append(cancel);
  renderPresetButtons();
}
function renderProbes() {
  $("probe-count").textContent = `${state.probes.length} / 5`;
  $("route-count-fact").textContent = String(state.probes.length).padStart(2, "0");
  const lines = $("probe-lines"); lines.replaceChildren();
  lines.classList.toggle("expanded", state.probesExpanded);
  const expand = $("probe-expand-toggle");
  $("probe-view-bar").hidden = state.probes.length === 0;
  expand.hidden = state.probes.length === 0;
  expand.disabled = Boolean(state.options);
  expand.textContent = state.probesExpanded ? "收起全部 ↑" : "展开全部 ↓";
  expand.setAttribute("aria-expanded", String(state.probesExpanded));
  renderPresetButtons();
  if (!state.probes.length) {
    const empty = document.createElement("p"); empty.className = "probe-lines-empty"; empty.textContent = "添加探针后，它会成为一条可选择的语义线路。"; lines.append(empty);
  }
  for (const [index, probe] of state.probes.entries()) {
    const hotspotCount = rankHotspots(state.readings, probe).length;
    const route = document.createElement("button"); route.type = "button"; route.className = "probe-line";
    setCssVariable(route, "--probe-color", probe.color);
    route.classList.toggle("selected", state.selectedId === probe.id);
    route.classList.toggle("hidden-line", !isProbeVisible(probe));
    route.setAttribute("aria-pressed", String(state.selectedId === probe.id));
    route.setAttribute("aria-label", `选择${polarityLabel(probe)}语义探针「${probe.name}」，${hotspotCount} 个热点`);
    const routeCode = document.createElement("span"); routeCode.className = "route-code"; routeCode.textContent = `P${String(index + 1).padStart(2, "0")}`;
    const routeSwatch = document.createElement("i"); routeSwatch.className = "route-swatch";
    const routeName = document.createElement("span"); routeName.className = "route-name"; routeName.textContent = probe.name;
    const routePolarity = document.createElement("span"); routePolarity.className = `probe-polarity ${probePolarity(probe)}`; routePolarity.textContent = polarityLabel(probe);
    const routeStat = document.createElement("span"); routeStat.className = "route-stat"; routeStat.textContent = `${hotspotCount} HOT`;
    route.append(routeCode, routeSwatch, routeName, routePolarity, routeStat);
    route.addEventListener("click", () => { state.selectedId = probe.id; render(); void pushGraph(); });
    const routeRow = document.createElement("div"); routeRow.className = "probe-line-row";
    if (!state.probesExpanded) { routeRow.append(route); lines.append(routeRow); continue; }

    const buttons = document.createElement("div"); buttons.className = "probe-actions";
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
    const revise = document.createElement("button"); revise.type = "button";
    revise.textContent = state.revisingId === probe.id ? "正在设置" : "高级设置";
    revise.disabled = state.running || Boolean(state.options);
    revise.addEventListener("click", () => openAdvancedSettings(probe));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "probe-delete";
    remove.textContent = "删除";
    remove.setAttribute("aria-label", `删除语义探针「${probe.name}」`);
    remove.disabled = state.running || Boolean(state.options);
    remove.addEventListener("blur", () => {
      if (!remove.disabled && remove.classList.contains("confirming")) {
        remove.classList.remove("confirming");
        remove.textContent = "删除";
        remove.setAttribute("aria-label", `删除语义探针「${probe.name}」`);
      }
    });
    remove.addEventListener("click", async () => {
      if (state.running || state.options) return;
      if (!remove.classList.contains("confirming")) {
        remove.classList.add("confirming");
        remove.textContent = "确认删除";
        remove.setAttribute("aria-label", `确认删除语义探针「${probe.name}」`);
        return;
      }
      remove.disabled = true;
      remove.textContent = "删除中…";
      try {
        const archived = (await chrome.storage.local.get("cuewave:archivedDefinitions"))["cuewave:archivedDefinitions"] || [];
        archived.push(probe);
        await chrome.storage.local.set({ "cuewave:archivedDefinitions": archived });
        state.probes = state.probes.filter((p) => p.id !== probe.id);
        if (!state.probes.length) state.probesExpanded = false;
        state.selectedId = selectedVisibleProbeId(state.probes, state.selectedId);
        const stored = await storeDefinitions();
        render(); void pushGraph();
        if (stored) status(`已删除语义探针「${probe.name}」。`);
      } catch (error) {
        remove.disabled = false;
        remove.textContent = "确认删除";
        status(`删除「${probe.name}」失败：${error.message}`, true);
      }
    });
    buttons.append(visibility, revise, remove);
    routeRow.append(route, buttons); lines.append(routeRow);
  }
}
function renderTranscript() {
  $("transcript-info").textContent = fetchingTranscript ? "解析视频中" : state.segments.length ? "已就绪，可以开始分析" : "等待解析视频";
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
  const meta = document.createElement("div"); meta.className = "evidence-time";
  const time = document.createElement("time"); time.textContent = format(window.startMs);
  const probeIndex = state.probes.indexOf(probe);
  const probeLabel = document.createElement("small"); probeLabel.textContent = `P${String(probeIndex + 1).padStart(2, "0")} / ${probe.name} / ${polarityLabel(probe)}`;
  meta.append(time, probeLabel);
  const copy = document.createElement("div"); copy.className = "evidence-copy";
  const quote = document.createElement("blockquote"); quote.className = "quote"; quote.textContent = window.text;
  const standard = document.createElement("div"); standard.className = "subtle"; standard.textContent = `判断标准：${probe.criterion}`;
  const context = document.createElement("div"); context.className = "subtle"; context.textContent = window.context ? `前文（仅辅助理解）：${window.context}` : "无前文";
  const caveat = document.createElement("div"); caveat.className = "subtle"; caveat.textContent = probe.primitive === "score" ? `Score 原值 ${reading.raw.toFixed(2)} / ${probe.criteria.length - 1}；显示值是等级范围归一化，不是概率。${reading.confidence == null ? "" : ` 模型 confidence ${reading.confidence.toFixed(2)}，不是实测正确率。`}` : `Noul 为命题成立的模型概率；不表示文本真实性，也没有单独的 confidence。`;
  const detail = document.createElement("details"); detail.className = "evidence-details";
  const summary = document.createElement("summary"); summary.textContent = "查看判断依据"; detail.append(summary, standard, context, caveat);
  const seek = document.createElement("button"); seek.className = "evidence-jump"; seek.textContent = "跳转并核对 →"; seek.addEventListener("click", () => jump(window.startMs));
  copy.append(quote, seek, detail); box.append(meta, copy);
}
async function jump(startMs) {
  if (!state.tabId || !state.videoId) return;
  const tab = await chrome.tabs.get(state.tabId).catch(() => null);
  if (new URL(tab?.url || "https://invalid.example").searchParams.get("v") !== state.videoId) return status("视频已经切换，请重新打开对应视频的侧栏。", true);
  try {
    const targetMs = Math.max(0, startMs - 2000);
    await sendToContent({ action: "cuewave:seek", videoId: state.videoId, ms: targetMs });
    setPlaybackTime(targetMs); playerStatus("seek");
  }
  catch (error) { playerStatus("seek", `播放器跳转失败：${error.message}`); status("跳转失败；分析读数已保留，请查看播放器连接提示。", true); }
}
async function assertBoundTab() {
  const tab = await chrome.tabs.get(state.tabId).catch(() => null);
  if (new URL(tab?.url || "https://invalid.example").searchParams.get("v") !== state.videoId) throw new Error("视频已切换，请重新打开对应视频侧栏");
}
function renderTracks() {
  const box = $("tracks"); box.replaceChildren();
  const ruler = $("timeline-ruler"); ruler.replaceChildren();
  const duration = Math.max(state.durationMs, state.windows.at(-1)?.endMs || 0, 1);
  for (const ratio of [0, 1 / 3, 2 / 3, 1]) {
    const tick = document.createElement("span"); tick.textContent = format(duration * ratio); ruler.append(tick);
  }
  if (!state.windows.length) return;
  if (!state.probes.some(isProbeVisible)) { box.textContent = "所有探针已设为不显示；读数仍保留并继续分析。"; return; }
  for (const probe of state.probes.filter(isProbeVisible)) {
    const index = state.probes.indexOf(probe);
    const section = document.createElement("div"); section.className = "track";
    setCssVariable(section, "--probe-color", probe.color);
    section.classList.toggle("selected-track", state.selectedId === probe.id);
    section.classList.toggle("negative-track", probePolarity(probe) === "negative");
    const selectProbe = () => { state.selectedId = probe.id; renderTracks(); renderProbes(); void pushGraph(); };
    const label = document.createElement("div"); label.className = "track-label";
    const code = document.createElement("button"); code.type = "button"; code.className = "track-code";
    code.textContent = `P${String(index + 1).padStart(2, "0")}`;
    code.setAttribute("aria-label", `选择${polarityLabel(probe)}语义探针「${probe.name}」`);
    code.setAttribute("aria-pressed", String(state.selectedId === probe.id));
    code.addEventListener("click", selectProbe);
    const select = document.createElement("button"); select.type = "button"; select.className = "track-select"; select.textContent = probe.name; select.classList.toggle("selected", state.selectedId === probe.id);
    select.setAttribute("aria-pressed", String(state.selectedId === probe.id));
    select.addEventListener("click", selectProbe);
    const hotspots = rankHotspots(state.readings, probe).slice(0, 5);
    const unit = document.createElement("small"); unit.className = "track-unit";
    const hotspotStat = document.createElement("span"); hotspotStat.className = "track-hot-count"; hotspotStat.textContent = `${hotspots.length} 个热点 · `;
    const direction = document.createElement("span"); direction.className = `track-polarity ${probePolarity(probe)}`; direction.textContent = polarityLabel(probe);
    const primitive = document.createElement("span"); primitive.textContent = ` · ${probe.primitive === "score" ? "SCORE" : "NOUL"}`;
    unit.append(hotspotStat, direction, primitive); label.append(code, select, unit);
    const cells = document.createElement("button"); cells.type = "button"; cells.className = "cells";
    cells.setAttribute("aria-label", `${probe.name}${polarityLabel(probe)}语义时间轴。${probePolarity(probe) === "negative" ? "柱形向下表示反向信号" : "柱形向上表示正向信号"}。点击对应时间跳转，按回车跳到最高热点。`);
    cells.addEventListener("click", (event) => {
      if (event.target !== cells) return;
      if (event.detail === 0 && hotspots[0]?.peak) {
        showEvidence(hotspots[0].peak);
        jump(hotspots[0].peak.startMs);
        return;
      }
      const bounds = cells.getBoundingClientRect();
      const ratio = bounds.width ? Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) : 0;
      const targetMs = duration * ratio;
      const window = state.windows.find((item) => item.startMs <= targetMs && item.endMs >= targetMs) || state.windows.at(-1);
      const reading = state.readings.find((item) => item.windowId === window?.id && item.probeId === probe.id);
      if (reading?.status === "ok") showEvidence(reading);
      jump(window?.startMs ?? targetMs);
    });
    for (const window of state.windows) {
      const reading = state.readings.find((r) => r.windowId === window.id && r.probeId === probe.id);
      const cell = document.createElement("span"); cell.className = `cell ${window.status === "no_text" ? "no-text" : reading?.status === "failed" ? "failed" : reading?.status === "ok" ? "ok" : "pending"}`;
      cell.style.left = `${window.startMs / duration * 100}%`; cell.style.width = `${(window.endMs - window.startMs) / duration * 100}%`;
      if (reading?.status === "ok") { cell.style.background = probe.color; cell.style.height = `${Math.max(6, reading.value * 46)}%`; cell.style.opacity = String(Math.max(.38, reading.value)); cell.style.minWidth = "8px"; cell.style.zIndex = "2"; }
      cell.title = `${format(window.startMs)}–${format(window.endMs)} · ${polarityLabel(probe)} · ${window.status === "no_text" ? "无文本" : reading?.status === "ok" ? reading.label : reading?.status === "failed" ? "分析失败" : "未分析"}`;
      cell.setAttribute("aria-label", cell.title);
      cell.addEventListener("click", (event) => { event?.stopPropagation?.(); if (reading?.status === "ok") { showEvidence(reading); jump(window.startMs); } else $("evidence").textContent = cell.title; });
      cells.append(cell);
    }
    hotspots.forEach((hotspot, hotspotIndex) => {
      const marker = document.createElement("span"); marker.className = `peak-marker${hotspotIndex === 0 ? " is-first" : ""}`;
      marker.textContent = String(hotspotIndex + 1).padStart(2, "0");
      marker.title = `第 ${hotspotIndex + 1} 热点 · ${polarityLabel(probe)} · ${format(hotspot.peak.startMs)} · ${hotspot.peak.label}`;
      setCssVariable(marker, "--peak-position", `${hotspot.peak.startMs / duration * 100}%`);
      setCssVariable(marker, "--peak-height", `${Math.min(78, Math.max(12, hotspot.peak.value * 100))}%`);
      cells.append(marker);
    });
    section.append(label, cells); box.append(section);
  }
  const cursorZone = document.createElement("div"); cursorZone.className = "timeline-cursor-zone"; cursorZone.setAttribute("aria-hidden", "true");
  const cursor = document.createElement("span"); cursor.className = "cue-cursor";
  cursor.style.left = `${Math.min(100, state.currentTimeMs / duration * 100)}%`;
  const cursorTime = document.createElement("span"); cursorTime.className = "cue-cursor-time"; cursorTime.textContent = format(state.currentTimeMs);
  cursor.append(cursorTime); cursorZone.append(cursor); box.append(cursorZone);
}
function renderRankings() {
  const box = $("rankings"); box.replaceChildren();
  if (state.probes.length && !state.probes.some(isProbeVisible)) { box.textContent = "所有探针已设为不显示；重新打开开关即可查看原有排名。"; return; }
  for (const probe of state.probes.filter(isProbeVisible)) {
    const section = document.createElement("div"); section.className = "rank-section";
    section.style.setProperty?.("--probe-color", probe.color);
    const title = document.createElement("h4"); title.textContent = `${probe.name} · ${polarityLabel(probe)} · ${probe.primitive === "score" ? "强度最高" : "命题概率最高"}`; section.append(title);
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
      button.textContent = `片段级近似 ${format(boundary.startMs)}–${format(boundary.endMs)} · 峰值 ${Math.round(boundary.peakValue * 100)}%`;
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
      await loadVideo(); await pushGraph(); await pushCaptions(); status("已恢复此视频的探针和历史分析结果。");
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
  const complete = Boolean(p.total && p.done === p.total);
  $("probe-workflow").classList.toggle("analysis-complete", complete);
  $("duration-fact").textContent = state.durationMs ? format(state.durationMs) : "--:--";
  $("coverage-fact").textContent = `${p.total ? Math.round(p.done / p.total * 100) : 0}%`;
  $("save-button").disabled = !state.videoId || !state.segments.length || p.done === 0;
  const refineJobs = adRefinementJobs();
  const refineCount = refineJobs.length;
  $("refine-button").disabled = state.running || !refineCount;
  $("progress-fill").style.width = `${p.total ? p.done / p.total * 100 : 0}%`;
  $("progress-text").textContent = state.windows.length ? `${p.done}/${p.total} 个探针窗口完成 · 有效 ${p.ok} · 失败 ${p.failed} · 无内容窗口 ${p.noText} · 视频解析范围与分析范围分开计算` : "确认探针并等待视频解析完成。";
  $("analysis-state").textContent = state.running ? "分析中" : complete ? "已完成" : p.done ? "部分完成" : "未开始";
  $("masthead-analysis").textContent = state.running ? "ANALYZING" : complete ? "ANALYSIS READY" : p.done ? "PARTIAL RESULT" : "READY TO SCAN";
  const estimate = estimateAnalysisWork(state.windows, state.probes, state.readings);
  const refineTokens = refineJobs.reduce((total, { probe, segment }) => total + Math.ceil(new TextEncoder().encode(JSON.stringify({ target: segment.text,
    description: probe.description, criterion: probe.criterion, positive: probe.positive, negative: probe.negative })).length / 3) + 120, 0);
  const actualUsd = (state.usage.inputTokens || 0) / 1_000_000 * JEV_INPUT_USD_PER_MILLION;
  $("estimate-text").textContent = `待分析约 ${estimate.requests} 次 Jev 请求、${estimate.questions} 项判断；输入约 ${estimate.estimatedInputTokens.toLocaleString()} token（按文本字节粗估），参考费用约 $${estimate.estimatedUsd.toFixed(6)}。`
    + ` 成功响应累计 ${state.usage.requests || 0} 次；其中 ${state.usage.reportedRequests || 0} 次报告了 ${state.usage.inputTokens || 0} 输入 token，按当前参考价约 $${actualUsd.toFixed(6)}（未报告用量的请求不计入）。`
    + (refineCount ? ` 广告片段级复判另需最多 ${refineCount} 次请求、粗估 ${refineTokens.toLocaleString()} 输入 token / $${(refineTokens / 1_000_000 * JEV_INPUT_USD_PER_MILLION).toFixed(6)}；只有点击按钮才会执行。` : "")
    + " 估算不含视频解析、失败重试或价格变更。";
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
  status(`正在复判 ${jobs.length} 个热点片段，以估计广告起止边界；可随时停止后续请求。`);
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
      } catch (error) { status(`广告边界细化暂停：${error.message}。已完成的片段复判已保存，可重试剩余部分。`, true); break; }
    }
    if (state.cancelled) status("已停止后续片段复判；已完成的近似边界保留。");
    else if (!adRefinementJobs().length) status("片段级广告边界细化完成。边界仍受视频解析精度限制。");
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
  if (!state.cacheWarning) status("已就绪，可以开始分析。");
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
    const { id, name, color, enabled, polarity, ...semantic } = probe;
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

$("probe-form").addEventListener("submit", (event) => { event.preventDefault(); const input = $("probe-input").value.trim(); if (input) void addQuickProbe(input); });
$("probe-expand-toggle").addEventListener("click", () => { if (state.options) return; state.probesExpanded = !state.probesExpanded; renderProbes(); });
$("probe-intent-find").addEventListener("click", () => setNewProbePolarity("positive"));
$("probe-intent-avoid").addEventListener("click", () => setNewProbePolarity("negative"));
$("theme-gate").addEventListener("click", () => void chooseTheme("gate"));
$("theme-transit").addEventListener("click", () => void chooseTheme("transit"));
$("live-button").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("live.html") }));
document.querySelectorAll(".seed").forEach((button) => button.addEventListener("click", () => void addQuickProbe(button.dataset.value, button.dataset.polarity)));
let fetchingTranscript = false;
async function fetchAuto() {
  if (!state.videoId || fetchingTranscript) return;
  const epoch = transcriptEpoch; const videoId = state.videoId;
  fetchingTranscript = true; $("auto-button").disabled = true; renderTranscript(); status("解析视频中…");
  try { await assertBoundTab(); const result = await api("/transcript", { videoId }); if (epoch === transcriptEpoch && videoId === state.videoId) await useSegments(result.segments, "自动解析"); }
  catch { if (epoch === transcriptEpoch && videoId === state.videoId) status("视频解析失败。可以稍后重试，或在「视频解析与播放器」中导入时间轴文件。", true); }
  finally { fetchingTranscript = false; $("auto-button").disabled = false; renderTranscript(); }
}
$("auto-button").addEventListener("click", fetchAuto);
$("import-file").addEventListener("change", async (event) => { const file = event.target.files?.[0]; if (!file) return; try { await useSegments(parseCaptions(await file.text()), `导入 ${file.name}`); } catch (error) { status(error.message, true); } event.target.value = ""; });
$("caption-toggle").addEventListener("change", async (event) => {
  state.subtitleEnabled = event.target.checked;
  await chrome.storage.local.set({ "cuewave:captionOverlay": state.subtitleEnabled });
  await pushCaptions();
  status(state.subtitleEnabled ? "已开启 CueWave 同步文字；如与 YouTube 自带文字重叠，可关闭其中一处。" : "已关闭 CueWave 同步文字。");
});
$("import-analysis-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (state.running) throw new Error("请先停止当前分析");
    if (file.size > 20_000_000) throw new Error("分析文件超过 20 MB，请检查是否为 CueWave 导出的 JSON");
    const record = parseVideoExport(JSON.parse(await file.text()));
    record.selectedId = selectedVisibleProbeId(record.probes, null);
    await saveRecord(record); await updateStorageUsage();
    if (record.videoId === state.videoId) { await loadVideo(); await pushGraph(); await pushCaptions(); status("已导入并恢复当前视频的探针和时间轴。"); }
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
    status(`已发起下载：${link.download}。包含 ${exported.transcript.segments.length} 个对齐片段及 ${p.ok} 个有效读数${p.done < p.total ? "；未完成窗口标为 pending" : ""}${cacheError ? "；浏览器内缓存未能更新，但下载已发起" : ""}。`);
  } catch (error) { status(`保存失败：${error.message}`, true); }
});
$("cancel-button").addEventListener("click", () => { state.cancelled = true; state.resumeOnOpen = false; void safeSave(); status("当前请求结束后停止派发，重新打开侧栏也不会自动续跑；可手动点击分析继续。"); });
if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.tab?.id !== state.tabId) return;
    if (message.action === "cuewave:evidence" && message.videoId === state.videoId) showEvidence(selectedReading(message.readingId));
    if (message.action === "cuewave:navigated" && message.videoId !== state.videoId) {
      state.cancelled = true; transcriptEpoch++; status("视频已切换；重新打开对应视频侧栏。", true);
    }
  });
}
if (globalThis.chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, change] of Object.entries(changes)) {
      if (key === THEME_KEY) { applyTheme(change.newValue); continue; }
      if (!key.startsWith("cuewave:video:")) continue;
      historyRevision++;
      if (change.newValue && typeof change.newValue === "object") updateHistoryItem({ ...change.newValue, videoId: key.slice("cuewave:video:".length) });
      else { state.history = state.history.filter((item) => item.videoId !== key.slice("cuewave:video:".length)); renderHistory(); }
    }
  });
}

let playbackTimer = null;
async function syncPlaybackTime() {
  if (!state.tabId || !state.videoId || document.visibilityState === "hidden") return;
  try {
    const info = await chrome.tabs.sendMessage(state.tabId, { action: "cuewave:info" });
    if (info?.videoId === state.videoId && Number.isFinite(info.currentTimeMs)) setPlaybackTime(info.currentTimeMs);
  } catch {
    // Playback sync is decorative; connection failures are handled by normal player actions.
  }
}
function startPlaybackSync() {
  if (typeof window === "undefined" || typeof window.setInterval !== "function" || playbackTimer) return;
  playbackTimer = window.setInterval(syncPlaybackTime, 750);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void syncPlaybackTime(); });
  window.addEventListener("pagehide", () => { window.clearInterval(playbackTimer); playbackTimer = null; }, { once: true });
}

async function init() {
  setNewProbePolarity("positive");
  setHeaderClock();
  const settings = await chrome.storage.local.get(["cuewave:captionOverlay", THEME_KEY]);
  state.subtitleEnabled = settings["cuewave:captionOverlay"] === true;
  applyTheme(settings[THEME_KEY]);
  const panelTabId = Number(new URLSearchParams(location.search).get("tabId"));
  if (!Number.isSafeInteger(panelTabId) || panelTabId <= 0) return status("侧栏缺少标签页身份；请在 chrome://extensions 重新加载扩展后，从 YouTube 视频标签页打开 CueWave。", true);
  const tab = await chrome.tabs.get(panelTabId).catch(() => null);
  if (!tab?.id || !/^https:\/\/www\.youtube\.com\/watch\?/.test(tab.url || "")) return status("此侧栏所属标签页不是 YouTube 视频。", true);
  state.tabId = tab.id; state.videoId = new URL(tab.url).searchParams.get("v");
  let info = null;
  try { info = await sendToContent({ action: "cuewave:info" }, (reply) => reply?.videoId === state.videoId); playerStatus("info"); }
  catch (error) { playerStatus("info", `播放器连接失败：${error.message}。可先查看已保存结果；请刷新视频页或重新加载扩展。`); }
  state.durationMs = info?.durationMs || 0;
  setPlaybackTime(info?.currentTimeMs || 0);
  $("video-title").textContent = info?.title || tab.title || "YouTube 视频";
  $("video-meta").textContent = `${state.videoId || "未知视频"} · ${state.durationMs ? format(state.durationMs) : "时长待获取"}`;
  await refreshHistory();
  await loadDefinitions(); await loadVideo();
  try {
    const response = await fetch(`${API}/health`); state.helper = await response.json();
    $("probe-hint").textContent = "只需描述你的需求；CueWave 会自动生成基础定义，之后仍可打开高级设置。";
    $("probe-submit-label").textContent = "添加";
    $("probe-submit").setAttribute("aria-label", "添加语义探针");
    status(`本机辅助进程已连接 · 探针定义由本机规则生成 · Jev ${state.helper.capabilities.jev ? "已配置" : "未配置"} · 视频解析 ${state.helper.capabilities.supadata ? "已配置" : "未配置"}（使用时验证）`);
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
  startPlaybackSync();
}

function initPreview() {
  setNewProbePolarity("positive");
  const previewParams = new URLSearchParams(location.search);
  applyTheme(previewParams.get("theme"));
  setHeaderClock(new Date(2026, 8, 28, 9, 41));
  state.videoId = "CueWaveDemo";
  state.durationMs = 18 * 60 * 1000 + 42 * 1000;
  state.currentTimeMs = 8 * 60 * 1000 + 3 * 1000;
  state.source = "产品预览数据";
  state.helper = { capabilities: { manualProbes: true, jev: true, supadata: true } };
  state.probes = [
    { id: "preview-knowledge", input: "知识科普", name: "知识科普", description: "能够帮助观众理解知识或增长见闻的内容。", criterion: "包含清晰、可理解、具有信息增量的事实或解释。", positive: "提供完整知识点", negative: "没有知识增量", polarity: "positive", primitive: "noul", color: "#178d78", enabled: true },
    { id: "preview-humor", input: "幽默程度", name: "幽默程度", description: "能够引起观众发笑的表达。", criterion: "根据语言中的反差、包袱和喜剧节奏判断。", positive: "明显幽默", middle: "略带趣味", negative: "没有幽默表达", criteria: ["没有幽默表达", "略带趣味", "明显幽默"], polarity: "positive", primitive: "score", color: "#ff7658", enabled: true },
    { id: "preview-promotion", input: "推广信息", name: "推广信息", description: "与当前视频主线无关的插入口播广告。", criterion: "区分视频原本主题与突然插入的商品或服务推销。", positive: "明确插入推广", negative: "属于视频原本内容", polarity: "negative", primitive: "noul", color: "#9d8aec", enabled: true }
  ];
  state.selectedId = state.probes[0].id;
  const windowMs = state.durationMs / 18;
  state.windows = Array.from({ length: 18 }, (_, index) => ({
    id: `preview-window-${index + 1}`,
    startMs: Math.round(index * windowMs),
    endMs: Math.round((index + 1) * windowMs),
    text: [
      "从一个熟悉的现象出发，我们可以看见模型如何把连续信号拆成可以比较的语义片段。",
      "这一段用一个反直觉的小例子解释了为什么速度快，不代表判断会更粗糙。",
      "如果只看关键词，很容易错过说话者真正想表达的关系；语义探针关注的是完整命题。",
      "这里临时插入了一段与视频主题无关的服务推荐，随后又回到原来的讲解。"
    ][index % 4],
    context: "前文正在讨论如何从长视频中快速定位值得深入的内容。",
    status: "ready"
  }));
  state.segments = state.windows.map((window, index) => ({ id: `preview-segment-${index + 1}`, startMs: window.startMs, endMs: window.endMs, text: window.text }));
  const values = {
    "preview-knowledge": [.16, .28, .42, .18, .82, .97, .61, .24, .38, .48, .21, .93, .55, .32, .46, .86, .52, .27],
    "preview-humor": [.12, .36, .91, .53, .18, .26, .41, .87, .62, .29, .15, .31, .94, .57, .22, .38, .76, .19],
    "preview-promotion": [.08, .11, .16, .84, .42, .13, .09, .18, .24, .15, .12, .21, .17, .91, .54, .14, .10, .08]
  };
  state.readings = state.probes.flatMap((probe) => state.windows.map((window, index) => ({
    id: `${window.id}:${probe.id}`,
    windowId: window.id,
    probeId: probe.id,
    startMs: window.startMs,
    endMs: window.endMs,
    text: window.text,
    status: "ok",
    model: "preview",
    raw: probe.primitive === "score" ? values[probe.id][index] * 2 : values[probe.id][index],
    value: values[probe.id][index],
    label: probe.primitive === "score" ? `${Math.round(values[probe.id][index] * 100)}/100 强度` : `${Math.round(values[probe.id][index] * 100)}% 命题概率`,
    confidence: probe.primitive === "score" ? .91 : null
  })));
  $("video-title").textContent = "Why AI Agents Will Change How We Work";
  $("video-meta").textContent = "CueWaveDemo · 18:42";
  $("probe-hint").textContent = "只需描述你的需求；CueWave 会自动生成基础定义，之后仍可打开高级设置。";
  status("设计预览：使用固定演示数据展示实际扩展组件。 ");
  render();
  setPlaybackTime(state.currentTimeMs);
  const topReading = rankHotspots(state.readings, state.probes[0])[0]?.peak;
  if (topReading) void showEvidence(topReading);
}

if (new URLSearchParams(location.search).has("preview")) initPreview();
else init();
