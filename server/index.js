import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkProbe, decide, getTranscript } from "./suppliers.js";
import { draftManualProbe } from "./manual-probe.js";
import { pitchProbes } from "./live-probes.js";
import { attachLiveAsr, LIVE_ASR_MODEL } from "./live-asr.js";

const envPath = resolve(process.cwd(), ".env");
const env = {};
try {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
} catch { /* local file may be absent */ }
const geminiEnabled = process.env.CUEWAVE_GEMINI_ENABLED === "1" && !!env.GEMINI_API_KEY;

function respond(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}
const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return respond(response, 403, { error: "仅允许本机 CueWave 扩展访问" });
  if (origin) response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  if (request.method === "GET" && request.url === "/health") return respond(response, 200, { ok: true, capabilities: { gemini: geminiEnabled, manualProbes: !geminiEnabled, jev: !!env.JEV_API_KEY, supadata: !!env.SUPADATA_API_KEY } });
  if (request.method === "GET" && request.url === "/live/config") return respond(response, 200, { asrAvailable: !!env.GEMINI_API_KEY, jevAvailable: !!env.JEV_API_KEY, asrModel: LIVE_ASR_MODEL, probes: pitchProbes() });
  if (request.method !== "POST" || !["/probe/check", "/transcript", "/decide"].includes(request.url)) return respond(response, 404, { error: "未找到接口" });
  if (!request.headers["content-type"]?.startsWith("application/json")) return respond(response, 415, { error: "需要 JSON" });
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 200000) return respond(response, 413, { error: "请求过大" }); chunks.push(chunk); }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    let result;
    if (request.url === "/probe/check") {
      if (typeof data.input !== "string" || !data.input.trim() || data.input.length > 400) throw new Error("请输入不超过 400 字的探针描述");
      result = geminiEnabled ? await checkProbe(data.input, env.GEMINI_API_KEY) : draftManualProbe(data.input);
    } else if (request.url === "/transcript") result = await getTranscript(data.videoId, env.SUPADATA_API_KEY);
    else {
      if (!data.window || !Array.isArray(data.probes)) throw new Error("无效分析请求");
      result = await decide(data.window, data.probes, env.JEV_API_KEY);
    }
    respond(response, 200, result);
  } catch (error) {
    // Never log supplier bodies, submitted text, or credentials.
    respond(response, error.status >= 400 && error.status < 500 ? 502 : 400, { error: error.message, code: error.code || "REQUEST_ERROR", retryable: !!error.retryable });
  }
});

const port = Number(process.env.CUEWAVE_PORT || 4318);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("CUEWAVE_PORT 必须是有效端口");
attachLiveAsr(server, env.GEMINI_API_KEY);
server.listen(port, "127.0.0.1", () => { process.stdout.write(`CueWave helper ready on 127.0.0.1:${port}\n`); });
