import { rankHotspots } from "./core.js";
import { addProject, commitFinal, createLiveSession, liveSessionKey, liveSessionSnapshot, nextLiveWindow, shouldAutoStartProject } from "./live-core.js";
import { createLiveStore } from "./live-store.js";

const API = "http://127.0.0.1:4318";
const $ = (id) => document.getElementById(id);
const state = { config: null, session: null, active: false, stopping: false, switchingProject: false, connected: false, analyzing: false,
  stream: null, audioContext: null, socket: null, startTick: 0, retryTimer: null, analyzeTimer: null, reconnects: 0 };
const liveStore = createLiveStore(chrome.storage.local);
const elapsed = () => Math.max(0, Math.round(performance.now() - state.startTick));
const fmt = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, "0")}`;
function status(message, error = false) { $("status").textContent = message; $("status").classList.toggle("error", error); }
async function persistSession() {
  if (!state.session || !state.config) return false;
  const durationMs = state.active ? elapsed() : state.session.durationMs ?? elapsed();
  const pending = !!state.config.jevAvailable && (state.analyzing || !!nextLiveWindow(state.session));
  const record = liveSessionSnapshot(state.session, state.config.probes, durationMs, pending);
  try {
    await liveStore.save(record);
    $("storage-warning").hidden = true;
    return true;
  } catch (error) {
    $("storage-warning").textContent = `自动保存失败：${error.message}。请在停止后下载 JSON 备份；关闭页面会丢失未保存内容。`;
    $("storage-warning").hidden = false;
    return false;
  }
}
async function openResults(projectId = "all") {
  if (state.session && !await persistSession()) return;
  const search = state.session ? `?sessionId=${encodeURIComponent(state.session.id)}&projectId=${encodeURIComponent(projectId)}` : "";
  try { await chrome.tabs.create({ url: chrome.runtime.getURL(`results.html${search}`) }); }
  catch (error) { status(`结果页未能打开：${error.message}`, true); }
}
function controls() {
  $("start").disabled = state.active || state.stopping || state.analyzing
    || (state.config?.jevAvailable && state.session && !!nextLiveWindow(state.session)) || !state.config?.asrAvailable;
  $("stop").disabled = !state.active || state.stopping;
  $("next-project").disabled = !state.active || state.stopping || state.switchingProject;
  $("save").disabled = !state.session || state.active || state.stopping;
  $("discard").disabled = !state.session || state.active || state.stopping || state.analyzing
    || (state.config?.jevAvailable && !!nextLiveWindow(state.session));
  $("connection").textContent = state.active ? state.connected ? "● 正在采集" : "● 连接中断" : "○ 未采集";
}
async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `本机辅助进程返回 ${response.status}`);
  return result;
}
function showEvidence(reading) {
  const box = $("evidence"); box.replaceChildren();
  const title = document.createElement("p"); title.textContent = `${reading.probeName} · ${fmt(reading.startMs)}–${fmt(reading.endMs)} · ${reading.label || "分析失败"}`;
  const quote = document.createElement("p"); quote.className = "evidence-text"; quote.textContent = reading.text || "无原文";
  const note = document.createElement("p"); note.className = "hint"; note.textContent = reading.status === "ok" ? "只评价这段原话的语言表达；没有录音回放。" : reading.error || "此段未得到有效读数。";
  box.append(title, quote, note);
}
function renderTranscript() {
  const box = $("transcript"); box.replaceChildren();
  for (const segment of state.session?.segments || []) {
    const button = document.createElement("button"); button.className = "utterance";
    const time = document.createElement("time"); time.textContent = fmt(segment.startMs);
    const project = document.createElement("small"); project.textContent = segment.projectId.replace("project-", "项目 ");
    const text = document.createElement("span"); text.textContent = segment.text;
    button.append(time, project, text);
    button.addEventListener("click", () => showEvidence({ probeName: "最终字幕", startMs: segment.startMs,
      endMs: segment.endMs, text: segment.text, label: "原句", status: "ok" }));
    box.append(button);
  }
  box.scrollTop = box.scrollHeight;
}
function renderSignals() {
  const box = $("signals"); box.replaceChildren();
  const currentProjectId = state.session?.projects.at(-1)?.id;
  for (const probe of state.config?.probes || []) {
    const latest = [...(state.session?.readings || [])].reverse().find((reading) => reading.probeId === probe.id && reading.projectId === currentProjectId);
    const wrap = document.createElement("div"); wrap.className = "signal";
    const head = document.createElement("div"); head.className = "signal-head";
    const name = document.createElement("span"); name.textContent = probe.name;
    const value = document.createElement("span"); value.textContent = latest?.status === "ok" ? latest.label : "等待定稿";
    head.append(name, value);
    const meter = document.createElement("div"); meter.className = "signal-meter";
    const fill = document.createElement("i"); fill.style.width = `${Math.round((latest?.status === "ok" ? latest.value : 0) * 100)}%`; fill.style.background = probe.color; meter.append(fill);
    const detail = document.createElement("small"); detail.textContent = latest?.status === "failed" ? "本次判断失败；不当作零分" : probe.primitive === "score" ? "Score · 文字表达强度" : "Noul · 命题概率";
    wrap.append(head, meter, detail); box.append(wrap);
  }
}
function renderTracks() {
  const box = $("tracks"); box.replaceChildren();
  const duration = Math.max(state.active ? elapsed() : 0, state.session?.segments.at(-1)?.endMs || 0, 1000);
  const readings = state.session?.readings || [];
  for (const probe of state.config?.probes || []) {
    const track = document.createElement("div"); track.className = "track";
    const head = document.createElement("div"); head.className = "track-head";
    const name = document.createElement("strong"); name.textContent = probe.name;
    const count = document.createElement("span"); count.textContent = `${readings.filter((r) => r.probeId === probe.id && r.status === "ok").length} 个正式读数`;
    head.append(name, count);
    const line = document.createElement("div"); line.className = "track-line";
    for (const gap of state.session?.gaps || []) {
      const bar = document.createElement("div"); bar.className = "gap";
      bar.style.left = `${gap.startMs / duration * 100}%`;
      bar.style.width = `${Math.max(0, (Math.min(gap.endMs || duration, duration) - gap.startMs) / duration * 100)}%`;
      line.append(bar);
    }
    for (const reading of readings.filter((r) => r.probeId === probe.id)) {
      const bar = document.createElement("button"); bar.className = "reading";
      bar.style.left = `${reading.startMs / duration * 100}%`;
      bar.style.width = `${Math.max(.5, (reading.endMs - reading.startMs) / duration * 100)}%`;
      bar.style.background = reading.status === "ok" ? probe.color : "#ee7580";
      bar.style.opacity = reading.status === "ok" ? String(Math.max(.25, reading.value)) : "1";
      bar.title = `${fmt(reading.startMs)}–${fmt(reading.endMs)} · ${reading.label || "失败"}`;
      bar.addEventListener("click", () => showEvidence({ ...reading, probeName: probe.name })); line.append(bar);
    }
    track.append(head, line); box.append(track);
  }
  const finished = readings.filter((r) => r.status === "ok").length;
  $("coverage").textContent = state.session ? `${finished} 个正式读数 · ${state.session.segments.length} 条最终字幕` : "等待定稿字幕";
}
function renderHotspots() {
  const box = $("hotspots"); box.replaceChildren();
  const currentProjectId = state.session?.projects.at(-1)?.id;
  let count = 0;
  for (const probe of state.config?.probes || []) {
    const hits = rankHotspots((state.session?.readings || []).filter((reading) => reading.projectId === currentProjectId), probe).slice(0, 3);
    for (const hit of hits) {
      const button = document.createElement("button"); button.className = "hotspot";
      const title = document.createElement("strong"); title.textContent = `${probe.name} · ${hit.peak.label}`;
      const detail = document.createElement("span"); detail.textContent = `${fmt(hit.startMs)}–${fmt(hit.endMs)} · ${hit.peak.text.slice(0, 80)}`;
      button.append(title, detail); button.addEventListener("click", () => showEvidence({ ...hit.peak, probeName: probe.name })); box.append(button); count++;
    }
  }
  if (!count) box.textContent = "尚无达到阈值的热点；不代表内容得分为零。";
}
function renderProjects() {
  const box = $("projects"); box.replaceChildren();
  for (const project of state.session?.projects || []) {
    const row = document.createElement("div"); row.className = "project"; row.textContent = project.name;
    const detail = document.createElement("small"); detail.textContent = `${fmt(project.startMs)} 开始 · ${project.source === "auto" ? "静音＋开场语自动推测" : project.source === "manual" ? "手动切换" : "初始项目"}`;
    const view = document.createElement("button"); view.textContent = "查看结果 ↗";
    view.addEventListener("click", () => void openResults(project.id));
    row.append(detail, view); box.append(row);
  }
  $("project-label").textContent = state.session?.projects.at(-1)?.name || "项目 1";
}
function render() { controls(); renderTranscript(); renderSignals(); renderTracks(); renderHotspots(); renderProjects(); }
function scheduleAnalysis() {
  if (state.analyzeTimer) return;
  state.analyzeTimer = setTimeout(() => { state.analyzeTimer = null; void analyzePending(); }, 1800);
}
async function analyzePending() {
  if (state.analyzing || !state.session || !state.config?.jevAvailable) return;
  const job = nextLiveWindow(state.session);
  if (!job) return;
  state.analyzing = true;
  const { window, segmentCount } = job;
  try {
    const result = await api("/decide", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ window: { text: window.text, context: window.context, videoTitle: "现场项目 Pitch" }, probes: state.config.probes }) });
    for (const [index, answer] of result.answers.entries()) {
      state.session.readings.push({ id: `${window.id}:${answer.probeId}`, windowId: window.id, probeId: answer.probeId,
        projectId: window.projectId, startMs: window.startMs, endMs: window.endMs, text: window.text,
        context: window.context, status: "ok", ...answer, probeName: state.config.probes[index].name });
    }
    status(`最新正式字幕已分析：${fmt(window.startMs)}–${fmt(window.endMs)}。`);
  } catch (error) {
    for (const probe of state.config.probes) state.session.readings.push({ id: `${window.id}:${probe.id}`, windowId: window.id,
      probeId: probe.id, projectId: window.projectId, startMs: window.startMs, endMs: window.endMs,
      text: window.text, status: "failed", error: error.message });
    status(`Jev 判断失败：${error.message}。原始最终字幕已保留。`, true);
  } finally {
    state.session.nextSegmentIndex += segmentCount;
    state.analyzing = false; render();
    void persistSession();
    if (nextLiveWindow(state.session)) scheduleAnalysis();
  }
}
function onTranscript(message) {
  if (!state.session || !state.active) return;
  const now = elapsed();
  if (message.type === "interim") {
    if (message.text && state.session.interimStartMs == null) state.session.interimStartMs = now;
    $("interim").textContent = message.text ? `临时 · ${message.text}` : "等待讲话…";
    return;
  }
  if (message.type !== "final" || !message.text) return;
  if (shouldAutoStartProject(state.session, message.text, now)) {
    addProject(state.session, state.session.lastFinalAtMs + 1, "auto");
    status("检测到长停顿与新项目开场语，已自动切换项目段；原始字幕仍在总时间轴中。");
  }
  commitFinal(state.session, message.text, now);
  $("interim").textContent = "等待讲话…";
  render(); void persistSession(); scheduleAnalysis();
}
function connect() {
  if (!state.active || state.stopping) return;
  const socket = new WebSocket("ws://127.0.0.1:4318/live/asr"); state.socket = socket;
  state.connected = false; controls();
  socket.onmessage = (event) => {
    if (state.socket !== socket || (!state.active && !state.stopping)) return;
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === "ready") {
      state.connected = true; state.reconnects = 0;
      const openGap = state.session.gaps.at(-1); if (openGap && openGap.endMs == null) openGap.endMs = elapsed();
      controls(); status("正在收音；等待讲话产生临时和最终字幕。");
    } else if (message.type === "interim" || message.type === "final") onTranscript(message);
    else if (message.type === "rotate") { status("转写连接达到续接时间，正在保持麦克风并建立新连接…"); socket.close(1000, "rotation"); }
    else if (message.type === "gap") {
      state.session.gaps.push({ startMs: Math.max(0, elapsed() - 100), endMs: elapsed(), reason: "network-backpressure" });
      renderTracks(); status(message.message, true);
    }
    else if (message.type === "error") status(message.message, true);
  };
  socket.onclose = (event) => {
    if (state.socket !== socket) return;
    state.connected = false; controls();
    if (!state.active || state.stopping) return;
    if (!state.session.gaps.at(-1) || state.session.gaps.at(-1).endMs != null) state.session.gaps.push({ startMs: elapsed(), endMs: null, reason: "asr-disconnected" });
    if (event.code === 1008 || state.reconnects >= 5) { void stopCapture(false, "转写无法恢复，已停止采集；请检查 Gemini 权限、额度与网络。"); return; }
    const delay = Math.min(10000, 1000 * 2 ** state.reconnects++);
    status(`转写连接中断，${Math.ceil(delay / 1000)} 秒后重试；缺口会标在时间轴上。`, true);
    state.retryTimer = setTimeout(connect, delay);
  };
  socket.onerror = () => { /* close handler owns visible failure and bounded retry */ };
}
async function startCapture() {
  if (state.active || state.stopping || state.analyzing
    || (state.config?.jevAvailable && state.session && nextLiveWindow(state.session)) || !state.config?.asrAvailable) return;
  $("start").disabled = true;
  try {
    let stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const builtIn = devices.find((device) => device.kind === "audioinput" && /MacBook.*Microphone|Built-in Microphone|内建麦克风/i.test(device.label));
    if (builtIn && stream.getAudioTracks()[0].getSettings().deviceId !== builtIn.deviceId) {
      try {
        const preferred = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: builtIn.deviceId }, channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
        stream.getTracks().forEach((track) => track.stop()); stream = preferred;
      } catch { /* browser default microphone remains usable */ }
    }
    state.stream = stream;
    const context = new AudioContext({ sampleRate: 16000 }); state.audioContext = context;
    await context.audioWorklet.addModule(chrome.runtime.getURL("audio-worklet.js"));
    const source = context.createMediaStreamSource(stream);
    const processor = new AudioWorkletNode(context, "cuewave-pcm");
    const silent = context.createGain(); silent.gain.value = 0;
    source.connect(processor); processor.connect(silent); silent.connect(context.destination);
    processor.port.onmessage = ({ data }) => {
      if (state.connected && state.socket?.readyState === WebSocket.OPEN) state.socket.send(data);
    };
    await context.resume();
    state.session = createLiveSession(); state.startTick = performance.now(); state.active = true;
    state.session.gaps.push({ startMs: 0, endMs: null, reason: "asr-connecting" });
    $("mic-name").textContent = stream.getAudioTracks()[0]?.label || "默认麦克风";
    render(); void persistSession(); connect(); status("麦克风已开启，正在连接 Gemini 实时转写…");
  } catch (error) {
    state.stream?.getTracks().forEach((track) => track.stop()); state.stream = null;
    await state.audioContext?.close().catch(() => {}); state.audioContext = null;
    status(`无法启动麦克风：${error.message}`, true); controls();
  }
}
async function stopCapture(flushProvider = true, failureMessage = "") {
  if (!state.active || state.stopping) return;
  state.stopping = true; controls();
  state.stream?.getTracks().forEach((track) => track.stop()); state.stream = null;
  await state.audioContext?.close().catch(() => {}); state.audioContext = null;
  $("mic-name").textContent = "麦克风已释放";
  if (flushProvider && state.connected && state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({ type: "end" }));
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }
  state.active = false; state.connected = false; clearTimeout(state.retryTimer); clearTimeout(state.analyzeTimer);
  if (state.socket && ![WebSocket.CLOSING, WebSocket.CLOSED].includes(state.socket.readyState)) state.socket.close(1000, "user stopped");
  const openGap = state.session?.gaps.at(-1); if (openGap && openGap.endMs == null) openGap.endMs = elapsed();
  state.session.durationMs = elapsed(); state.session.endedAt = new Date().toISOString();
  state.stopping = false;
  if (nextLiveWindow(state.session)) void analyzePending();
  render();
  const saved = await persistSession();
  status(failureMessage || (saved ? "采集已停止；整场结果已自动保存，后续读数完成时会更新。" : "采集已停止，但自动保存失败；请下载 JSON 备份。"), !!failureMessage || !saved);
  if (saved) await openResults();
}
function saveSession() {
  if (!state.session || state.active) return;
  const pending = !!state.config.jevAvailable && (state.analyzing || !!nextLiveWindow(state.session));
  const data = liveSessionSnapshot(state.session, state.config.probes, state.session.durationMs ?? elapsed(), pending);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `cuewave-live-${state.session.id}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status(state.analyzing || (state.config?.jevAvailable && nextLiveWindow(state.session))
    ? "已下载当前最终字幕与读数；仍有判断进行中，可稍后再次下载完整结果。" : "已下载本次场次的最终字幕与读数；未保存原始音频。");
}
$("start").addEventListener("click", startCapture);
$("stop").addEventListener("click", () => void stopCapture());
$("next-project").addEventListener("click", async () => {
  if (!state.active || state.switchingProject) return;
  state.switchingProject = true; controls();
  const previous = state.session.projects.at(-1);
  const next = addProject(state.session, elapsed());
  try {
    if (next === previous) return;
    render(); scheduleAnalysis();
    const saved = await persistSession();
    status(saved ? "已切换到新项目；前一个项目的结果已打开，收音继续运行。" : "已切换到新项目；自动保存失败，请在停止后下载 JSON。", !saved);
    if (saved) await openResults(previous.id);
  } finally { state.switchingProject = false; controls(); }
});
$("view-results").addEventListener("click", () => void openResults());
$("save").addEventListener("click", saveSession);
$("discard").addEventListener("click", async () => {
  if (!state.session || state.active || state.stopping || state.analyzing || (state.config?.jevAvailable && nextLiveWindow(state.session))) return;
  try { await liveStore.remove(state.session.id); }
  catch (error) { status(`无法删除本机记录：${error.message}`, true); return; }
  state.session = null; $("clock").textContent = "00:00"; $("interim").textContent = "等待讲话…";
  $("evidence").textContent = "点击字幕、读数或热点查看原句。此模式没有录音回放。";
  render(); status("本次场次的字幕与读数已从浏览器本机记录删除。原始音频从未保存。");
});
window.addEventListener("beforeunload", (event) => { if (state.active) { event.preventDefault(); event.returnValue = ""; } });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !state.session || state.active || state.analyzing) return;
  const deleted = changes[liveSessionKey(state.session.id)];
  if (!deleted || deleted.newValue !== undefined) return;
  state.session = null; $("clock").textContent = "00:00"; $("interim").textContent = "等待讲话…";
  render(); status("本次场次已从浏览器记录删除。", false);
});
setInterval(() => { if (state.active) { $("clock").textContent = fmt(elapsed()); renderTracks(); } }, 1000);
try {
  state.config = await api("/live/config"); render();
  status(!state.config.asrAvailable ? "未配置 GEMINI_API_KEY，无法开始实时转写。"
    : !state.config.jevAvailable ? "GEMINI_API_KEY 可用，但未配置 JEV_API_KEY；可以试转写，暂时不会产生语义读数。"
      : "准备就绪。点击开始后会申请麦克风权限。", !state.config.asrAvailable || !state.config.jevAvailable);
} catch (error) { status(`本机辅助进程未就绪：${error.message}。请运行 npm start 并刷新此页。`, true); }
