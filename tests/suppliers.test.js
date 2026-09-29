import test from "node:test";
import assert from "node:assert/strict";
import { getTranscript, decide, checkProbe } from "../server/suppliers.js";

test("Supadata native contract preserves offset and duration", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).searchParams.get("mode"), "native");
    assert.equal(new URL(url).searchParams.get("text"), "false");
    assert.equal(options.headers["x-api-key"], "test-key");
    return new Response(JSON.stringify({ content: [{ text: "Hello", offset: 1250, duration: 2250 }], lang: "en" }), { status: 200 });
  };
  try { assert.deepEqual((await getTranscript("dQw4w9WgXcQ", "test-key")).segments[0], { id: "s0", text: "Hello", startMs: 1250, endMs: 3500 }); }
  finally { globalThis.fetch = original; }
});

test("Supadata async jobs keep the original job id across polls", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  let polls = 0;
  globalThis.setTimeout = (callback) => { callback(); return 0; };
  globalThis.fetch = async (url) => {
    if (String(url).includes("/transcript?")) return new Response(JSON.stringify({ jobId: "job-123" }), { status: 202 });
    assert.match(String(url), /\/transcript\/job-123$/);
    polls++;
    return new Response(JSON.stringify(polls === 1 ? { status: "active" } : { status: "completed", content: [{ text: "done", offset: 10, duration: 20 }] }), { status: 200 });
  };
  try { assert.equal((await getTranscript("dQw4w9WgXcQ", "test-key")).segments[0].startMs, 10); assert.equal(polls, 2); }
  finally { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; }
});

test("Jev request batches typed questions and validates response", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    const sent = JSON.parse(options.body);
    assert.equal(sent.model, "jev-1.13.0");
    assert.equal(sent.state.videoTitle, "产品评测视频");
    assert.equal(sent.questions.probe_0.type, "score");
    assert.match(sent.questions.probe_0.instructions, /context 仅用于理解指代、铺垫和话题延续/);
    assert.deepEqual(sent.questions.probe_0.criteria, ["少", "中", "多"]);
    assert.equal(sent.questions.probe_1.type, "noul");
    assert.match(sent.questions.probe_1.instructions, /仅判断 target 是否符合探针定义/);
    assert.match(sent.questions.probe_1.instructions, /context 仅用于理解指代及语段延续/);
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: { probe_0: { type: "score", score: 1.7, confidence: .9 }, probe_1: { type: "noul", noul: .84 } }, usage: { input_tokens: 392, output_tokens: 65 } }), { status: 200 });
  };
  try {
    const probes = [{ id: "a", primitive: "score", description: "细节", criterion: "具体细节", criteria: ["少", "中", "多"] }, { id: "b", primitive: "noul", description: "步骤", criterion: "明确动作", positive: "有", negative: "无" }];
    const result = await decide({ text: "first click setup", context: "", videoTitle: "产品评测视频" }, probes, "test-key");
    assert.equal(result.answers[0].value, .85);
    assert.equal(result.answers[1].value, .84);
    assert.deepEqual(result.usage, { inputTokens: 392, outputTokens: 65 });
  } finally { globalThis.fetch = original; }
});

test("Jev retries a temporary network failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  let calls = 0;
  globalThis.setTimeout = (callback) => { callback(); return 0; };
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: { probe_0: { type: "noul", noul: .9 } } }), { status: 200 });
  };
  try {
    const probe = { id: "steps", primitive: "noul", description: "步骤", criterion: "明确动作", positive: "有", negative: "无" };
    assert.equal((await decide({ text: "点击保存", context: "" }, [probe], "test-key")).answers[0].raw, .9);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; }
});

test("Gemini returns reviewable options", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(url, /gemini-3\.8-flash:generateContent$/);
    assert.equal(JSON.parse(options.body).generationConfig.responseMimeType, "application/json");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ambiguous: true, reason: "两种含义", options: [{ name: "A", description: "A", criterion: "B", positive: "C", negative: "D", polarity: "positive", primitive: "noul" }] }) }] } }] }), { status: 200 });
  };
  try { assert.equal((await checkProbe("测试", "test-key")).options[0].name, "A"); }
  finally { globalThis.fetch = original; }
});

test("Gemini 402 reports billing action without exposing the supplier body", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "private upstream detail" } }), { status: 402 });
  try {
    await assert.rejects(checkProbe("实操步骤", "test-key"), (error) => {
      assert.equal(error.code, "GEMINI_PAYMENT_REQUIRED");
      assert.equal(error.retryable, false);
      assert.match(error.message, /预付额度/);
      assert.doesNotMatch(error.message, /private upstream detail/);
      return true;
    });
  } finally { globalThis.fetch = original; }
});
