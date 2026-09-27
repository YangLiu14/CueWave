import { WebSocket, WebSocketServer } from "ws";

export const LIVE_ASR_MODEL = "gemini-3.5-transcribe-live";
export const LIVE_ASR_PATH = "/live/asr";
const GEMINI_SOCKET = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const ROTATE_MS = 9 * 60 * 1000;

export function liveAsrSetup() {
  return { setup: { model: `models/${LIVE_ASR_MODEL}`, generationConfig: { responseModalities: ["TEXT"] },
    inputAudioTranscription: { languageCodes: [] } } };
}

export function providerTranscript(message) {
  const content = message?.serverContent;
  const interim = content?.interimInputTranscription?.text;
  const final = content?.inputTranscription?.text;
  if (typeof final === "string" && final.trim()) return { type: "final", text: final.trim() };
  if (typeof interim === "string") return { type: "interim", text: interim.trim() };
  if (message?.setupComplete) return { type: "ready" };
  if (message?.goAway) return { type: "rotate" };
  return null;
}

function rejectUpgrade(socket, status) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

export function attachLiveAsr(server, key, { upstreamUrl = GEMINI_SOCKET, rotateMs = ROTATE_MS } = {}) {
  const bridge = new WebSocketServer({ noServer: true, maxPayload: 32768 });
  let active = false;
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== LIVE_ASR_PATH) return rejectUpgrade(socket, "404 Not Found");
    if (!/^chrome-extension:\/\/[a-p]{32}$/.test(request.headers.origin || "")) return rejectUpgrade(socket, "403 Forbidden");
    if (!key) return rejectUpgrade(socket, "503 Service Unavailable");
    if (active) return rejectUpgrade(socket, "409 Conflict");
    active = true;
    try { bridge.handleUpgrade(request, socket, head, (client) => bridge.emit("connection", client)); }
    catch { active = false; socket.destroy(); }
  });
  bridge.on("connection", (client) => {
    const upstream = new WebSocket(`${upstreamUrl}?key=${encodeURIComponent(key)}`, { handshakeTimeout: 10000 });
    let ready = false;
    let closing = false;
    const send = (message) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message)); };
    const rotate = setTimeout(() => { send({ type: "rotate" }); client.close(1000, "session rotation"); }, rotateMs);
    upstream.on("open", () => upstream.send(JSON.stringify(liveAsrSetup())));
    upstream.on("message", (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const event = providerTranscript(message);
      if (event?.type === "ready") ready = true;
      if (event) send(event);
    });
    upstream.on("error", () => { send({ type: "error", message: "Gemini 实时转写连接失败，请检查网络或账户状态。" }); client.close(1011, "upstream error"); });
    upstream.on("close", (code) => {
      if (!closing) {
        send({ type: "error", message: code === 1008 ? "Gemini 拒绝了实时转写连接，请检查模型权限或额度。" : "实时转写连接中断；正在尝试恢复。" });
        client.close(code === 1008 ? 1008 : 1011, "upstream closed");
      }
    });
    client.on("message", (bytes, binary) => {
      if (!binary) {
        try {
          if (JSON.parse(String(bytes)).type === "end" && upstream.readyState === WebSocket.OPEN)
            upstream.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
        } catch { /* ignore unsupported control messages */ }
        return;
      }
      if (!binary || !ready || upstream.readyState !== WebSocket.OPEN) return;
      if (bytes.length < 2 || bytes.length > 32000 || bytes.length % 2) return;
      if (upstream.bufferedAmount > 1_000_000) { send({ type: "gap", message: "网络拥塞，少量音频未送达。" }); return; }
      upstream.send(JSON.stringify({ realtimeInput: { audio: { data: bytes.toString("base64"), mimeType: "audio/pcm;rate=16000" } } }));
    });
    client.on("close", () => {
      closing = true; active = false; clearTimeout(rotate);
      if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      upstream.close();
    });
    client.on("error", () => {});
  });
  return bridge;
}
