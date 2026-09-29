// Player seek and SPA navigation adapted from youtube-digest at bb2f7b1 (MIT; see THIRD_PARTY_NOTICES.md).
(() => {
  let graph = null;
  let boundId = null;
  let overlay = null;
  let hoverTimer;
  let captionsEnabled = false;
  let captionSegments = [];
  let captionOverlay = null;
  let captionTimer = null;
  let contextInvalidated = false;
  const videoId = () => new URL(location.href).searchParams.get("v");
  const video = () => document.querySelector("video.html5-main-video");
  function send(action, detail = {}) {
    if (contextInvalidated) return;
    try {
      chrome.runtime.sendMessage({ action, videoId: videoId(), ...detail }).catch(() => {});
    } catch (error) {
      if (!/extension context invalidated/i.test(error?.message || "")) throw error;
      contextInvalidated = true;
    }
  }
  function installOverlay() {
    const progress = document.querySelector(".ytp-progress-bar-container");
    if (!progress || !graph || graph.videoId !== videoId()) return;
    if (overlay?.parentElement !== progress) {
      overlay?.remove();
      overlay = document.createElement("div"); overlay.id = "cuewave-histogram";
      progress.style.position = "relative";
      progress.append(overlay);
      progress.addEventListener("mouseenter", () => { clearTimeout(hoverTimer); overlay?.classList.add("visible"); });
      progress.addEventListener("mouseleave", () => { hoverTimer = setTimeout(() => overlay?.classList.remove("visible"), 200); });
      overlay.addEventListener("mouseenter", () => clearTimeout(hoverTimer));
      overlay.addEventListener("mouseleave", () => overlay.classList.remove("visible"));
    }
    overlay.replaceChildren();
    const selectedProbe = graph.probes.find((probe) => probe.id === graph.selectedId);
    const label = document.createElement("span"); label.className = "cw-label";
    label.textContent = selectedProbe ? `CueWave · ${selectedProbe.name} · ${selectedProbe.polarity === "negative" ? "反向 ↓" : "正向 ↑"}` : "CueWave · 每柱代表实际分析窗口";
    overlay.append(label);
    const duration = Math.max(graph.durationMs || 1, 1);
    for (const boundary of graph.adBoundaries || []) {
      if (boundary.probeId !== graph.selectedId) continue;
      const region = document.createElement("div"); region.className = "cw-ad-region";
      region.style.left = `${100 * boundary.startMs / duration}%`;
      region.style.width = `${100 * (boundary.endMs - boundary.startMs) / duration}%`;
      region.title = `字幕级近似广告段 ${(boundary.startMs / 1000).toFixed(1)}–${(boundary.endMs / 1000).toFixed(1)} 秒`;
      overlay.append(region);
    }
    for (const reading of graph.readings || []) {
      if (reading.status !== "ok") continue;
      const probe = graph.probes.find((p) => p.id === reading.probeId);
      if (!probe || probe.enabled === false) continue;
      const negative = probe.polarity === "negative";
      const bar = document.createElement("div"); bar.className = `cw-bar${negative ? " negative" : " positive"}`;
      const fraction = Math.max(.015, (reading.endMs - reading.startMs) / duration);
      bar.style.left = `${100 * reading.startMs / duration}%`;
      bar.style.width = `${Math.min(100 * fraction, 100 - 100 * reading.startMs / duration)}%`;
      bar.style.height = `${Math.max(3, reading.value * 31)}px`;
      bar.style.background = probe.color;
      bar.style.opacity = graph.selectedId === probe.id ? ".92" : ".24";
      bar.style.zIndex = graph.selectedId === probe.id ? "3" : "1";
      bar.title = `${probe.name} · ${negative ? "反向 ↓" : "正向 ↑"} · ${(reading.startMs / 1000).toFixed(1)}–${(reading.endMs / 1000).toFixed(1)} 秒 · ${reading.label} · 点击查看原句`;
      bar.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        const player = video(); if (player) player.currentTime = Math.max(0, reading.startMs / 1000 - 2);
        send("cuewave:evidence", { readingId: reading.id, probeId: probe.id });
      });
      overlay.append(bar);
    }
  }
  function updateCaption() {
    if (!captionOverlay || !captionsEnabled || !video()) return;
    const nowMs = Math.round(video().currentTime * 1000);
    let low = 0; let high = captionSegments.length;
    while (low < high) { const mid = (low + high) >> 1; if (captionSegments[mid].startMs <= nowMs) low = mid + 1; else high = mid; }
    const active = [];
    for (let index = low - 1; index >= 0 && active.length < 2; index--) {
      const segment = captionSegments[index];
      if (segment.endMs > nowMs) active.unshift(segment.text);
    }
    const text = active.join("\n");
    if (captionOverlay.textContent !== text) captionOverlay.textContent = text;
    captionOverlay.hidden = !text;
  }
  function installCaptions() {
    captionOverlay?.remove(); captionOverlay = null;
    if (captionTimer) { clearInterval(captionTimer); captionTimer = null; }
    if (!captionsEnabled || !captionSegments.length) return;
    const host = document.querySelector(".html5-video-player");
    if (!host) return;
    captionOverlay = document.createElement("div"); captionOverlay.id = "cuewave-caption-overlay";
    captionOverlay.setAttribute("aria-live", "off"); host.append(captionOverlay);
    updateCaption(); captionTimer = setInterval(updateCaption, 200);
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.action === "cuewave:info") {
      reply({ videoId: videoId(), title: document.querySelector('meta[name="title"]')?.content || document.title, durationMs: Math.round((video()?.duration || 0) * 1000), currentTimeMs: Math.round((video()?.currentTime || 0) * 1000) });
    } else if (message.action === "cuewave:seek") {
      if (message.videoId !== videoId() || !video()) reply({ ok: false });
      else { video().currentTime = Math.max(0, message.ms / 1000); reply({ ok: true }); }
    } else if (message.action === "cuewave:graph") {
      if (message.graph?.videoId === videoId()) { graph = message.graph; installOverlay(); reply({ ok: true }); }
      else reply({ ok: false });
    } else if (message.action === "cuewave:captions") {
      if (message.videoId !== videoId()) reply({ ok: false });
      else {
        captionsEnabled = !!message.enabled;
        captionSegments = Array.isArray(message.segments) ? message.segments.slice().sort((a, b) => a.startMs - b.startMs) : [];
        installCaptions(); reply({ ok: true });
      }
    }
    return false;
  });
  function navigated() {
    const id = videoId(); if (id === boundId) return; boundId = id;
    graph = null; overlay?.remove(); overlay = null;
    captionsEnabled = false; captionSegments = []; captionOverlay?.remove(); captionOverlay = null;
    if (captionTimer) { clearInterval(captionTimer); captionTimer = null; }
    send("cuewave:navigated");
  }
  document.addEventListener("yt-navigate-finish", navigated);
  new MutationObserver(() => { navigated(); if (graph && !overlay?.isConnected) installOverlay(); if (captionsEnabled && !captionOverlay?.isConnected) installCaptions(); }).observe(document.documentElement, { childList: true, subtree: true });
  navigated();
})();
