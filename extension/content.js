// Player seek and SPA navigation adapted from youtube-digest at bb2f7b1 (MIT; see THIRD_PARTY_NOTICES.md).
(() => {
  let graph = null;
  let boundId = null;
  let overlay = null;
  let hoverTimer;
  const videoId = () => new URL(location.href).searchParams.get("v");
  const video = () => document.querySelector("video.html5-main-video");
  function send(action, detail = {}) { chrome.runtime.sendMessage({ action, videoId: videoId(), ...detail }).catch(() => {}); }
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
    const label = document.createElement("span"); label.className = "cw-label";
    label.textContent = "CueWave · 每柱代表实际分析窗口，空白尚未分析"; overlay.append(label);
    const duration = Math.max(graph.durationMs || 1, 1);
    for (const reading of graph.readings || []) {
      if (reading.status !== "ok") continue;
      const probe = graph.probes.find((p) => p.id === reading.probeId);
      if (!probe || !probe.enabled) continue;
      const bar = document.createElement("div"); bar.className = "cw-bar";
      const fraction = Math.max(.015, (reading.endMs - reading.startMs) / duration);
      bar.style.left = `${100 * reading.startMs / duration}%`;
      bar.style.width = `${Math.min(100 * fraction, 100 - 100 * reading.startMs / duration)}%`;
      bar.style.height = `${Math.max(3, reading.value * 43)}px`;
      bar.style.background = probe.color;
      bar.style.opacity = graph.selectedId === probe.id ? ".88" : ".34";
      bar.title = `${probe.name} · ${(reading.startMs / 1000).toFixed(1)}–${(reading.endMs / 1000).toFixed(1)} 秒 · ${reading.label} · 点击查看原句`;
      bar.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        const player = video(); if (player) player.currentTime = Math.max(0, reading.startMs / 1000 - 2);
        send("cuewave:evidence", { readingId: reading.id, probeId: probe.id });
      });
      overlay.append(bar);
    }
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
    }
    return false;
  });
  function navigated() {
    const id = videoId(); if (id === boundId) return; boundId = id;
    graph = null; overlay?.remove(); overlay = null;
    send("cuewave:navigated");
  }
  document.addEventListener("yt-navigate-finish", navigated);
  new MutationObserver(() => { navigated(); if (graph && !overlay?.isConnected) installOverlay(); }).observe(document.documentElement, { childList: true, subtree: true });
  navigated();
})();
