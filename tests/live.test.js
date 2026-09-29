import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createServer } from "node:http";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { draftManualProbe } from "../server/manual-probe.js";
import { pitchProbes } from "../server/live-probes.js";
import { attachLiveAsr, liveAsrSetup, providerTranscript } from "../server/live-asr.js";
import { addProject, commitFinal, createLiveSession, nextLiveWindow, shouldAutoStartProject } from "../extension/live-core.js";

test("live probes separately score boredom and information density", () => {
  const probes = pitchProbes();
  assert.deepEqual(probes.map((probe) => probe.name), ["无聊程度", "信息量程度"]);
  assert.equal(probes.every((probe) => probe.primitive === "score" && probe.criteria.length === 3), true);
  assert.match(probes[0].criterion, /没有新增事实/);
  assert.match(probes[1].criterion, /新信息/);
  assert.match(probes[1].criterion, /不核验事实真伪/);
  assert.match(probes[1].positive, /具体/);
  assert.match(probes[1].negative, /重复/);
  assert.notEqual(probes[1].criterion, probes[0].criterion);
  assert.notEqual(probes[1].criterion, draftManualProbe("buzzword含量").options[0].criterion);
});

test("Live API setup requests text transcription with automatic language detection", () => {
  const setup = liveAsrSetup().setup;
  assert.equal(setup.model, "models/gemini-3.5-transcribe-live");
  assert.deepEqual(setup.generationConfig.responseModalities, ["TEXT"]);
  assert.deepEqual(setup.inputAudioTranscription.languageCodes, []);
  assert.deepEqual(providerTranscript({ serverContent: { interimInputTranscription: { text: "临时" } } }), { type: "interim", text: "临时" });
  assert.deepEqual(providerTranscript({ serverContent: { inputTranscription: { text: "最终" }, interimInputTranscription: { text: "旧临时" } } }), { type: "final", text: "最终" });
  assert.deepEqual(providerTranscript({ setupComplete: {} }), { type: "ready" });
});

test("finalized utterances form project-scoped analysis windows while interim text stays out", () => {
  const session = createLiveSession(0);
  session.interimStartMs = 100;
  assert.equal(session.segments.length, 0, "interim transcription must not become formal evidence");
  const first = commitFinal(session, "我们帮助餐厅记录每天的食材损耗", 1800);
  assert.equal(first.startMs, 100);
  assert.equal(first.endMs, 1800);
  assert.equal(first.timing, "local-approximate");
  assert.equal(shouldAutoStartProject(session, "接下来介绍下一个项目", 23000), true);
  addProject(session, 20000, "auto");
  commitFinal(session, "接下来介绍下一个项目", 23000);
  const firstWindow = nextLiveWindow(session);
  assert.equal(firstWindow.window.projectId, "project-1");
  assert.equal(firstWindow.segmentCount, 1);
  session.nextSegmentIndex += firstWindow.segmentCount;
  const secondWindow = nextLiveWindow(session);
  assert.equal(secondWindow.window.projectId, "project-2");
  assert.equal(secondWindow.window.context, "", "context must not leak across project boundaries");
});

test("microphone processor emits 100ms of mono 16-bit PCM at 16kHz", () => {
  let Processor;
  const source = readFileSync(new URL("../extension/audio-worklet.js", import.meta.url), "utf8");
  runInNewContext(source, { AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (buffer) => outputs.push(buffer) }; } },
    registerProcessor: (_name, value) => { Processor = value; }, sampleRate: 48000, Int16Array, Math }, { filename: "audio-worklet.js" });
  const outputs = [];
  const processor = new Processor();
  for (let index = 0; index < 38; index++) processor.process([[new Float32Array(128).fill(.5)]]);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].byteLength, 3200);
  assert.ok(Math.abs(new Int16Array(outputs[0])[0] - 16384) <= 1);
});

test("local bridge forwards PCM to Gemini and only exposes transcript events", async () => {
  const upstreamServer = createServer();
  const upstreamWs = new WebSocketServer({ server: upstreamServer });
  await new Promise((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
  const upstreamPort = upstreamServer.address().port;
  const localServer = createServer();
  attachLiveAsr(localServer, "private-test-key", { upstreamUrl: `ws://127.0.0.1:${upstreamPort}/gemini` });
  await new Promise((resolve) => localServer.listen(0, "127.0.0.1", resolve));
  const localPort = localServer.address().port;
  let receivedPcm = null;
  upstreamWs.on("connection", (remote, request) => {
    assert.equal(new URL(request.url, "http://localhost").searchParams.get("key"), "private-test-key");
    remote.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.setup) remote.send(JSON.stringify({ setupComplete: {} }));
      else if (message.realtimeInput?.audio) {
        receivedPcm = Buffer.from(message.realtimeInput.audio.data, "base64");
        remote.send(JSON.stringify({ serverContent: { inputTranscription: { text: "中文 pitch" } } }));
      }
    });
  });
  const client = new WebSocket(`ws://127.0.0.1:${localPort}/live/asr`, { origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  try {
    const ready = await new Promise((resolve, reject) => { client.on("message", (raw) => { const event = JSON.parse(String(raw)); if (event.type === "ready") resolve(event); }); client.on("error", reject); });
    assert.equal(ready.type, "ready");
    const final = new Promise((resolve) => client.on("message", (raw) => { const event = JSON.parse(String(raw)); if (event.type === "final") resolve(event); }));
    const pcm = Buffer.alloc(3200, 7); client.send(pcm);
    assert.deepEqual(await final, { type: "final", text: "中文 pitch" });
    assert.deepEqual(receivedPcm, pcm);
  } finally {
    client.close(); await once(client, "close").catch(() => {});
    await new Promise((resolve) => upstreamWs.close(resolve));
    await new Promise((resolve) => upstreamServer.close(resolve));
    await new Promise((resolve) => localServer.close(resolve));
  }
});
