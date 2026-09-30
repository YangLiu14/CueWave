import { parseCaptions, buildWindows } from "../extension/core.js";

const base = "http://127.0.0.1:4318";
const sample = `1\n00:00:00,100 --> 00:00:06,800\n我们先测量一百个样本，再用同一方法复测。\n\n2\n00:00:12,000 --> 00:00:18,000\n现在点击设置，选择导出，然后保存文件。\n`;
async function post(path, value) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  const data = await response.json(); if (!response.ok) throw new Error(`${path}: ${data.error}`); return data;
}
try {
  const health = await (await fetch(`${base}/health`)).json();
  console.log("helper", health.ok, health.capabilities);
  const windows = buildWindows(parseCaptions(sample), 24000);
  console.log("imported SRT windows", windows.map((w) => w.status));
  try { const checked = await post("/probe/check", { input: "实操步骤", polarity: "positive" }); console.log("Local probe options", checked.options.length, "primitive", checked.options[0]?.primitive); }
  catch (error) { console.log("Local probe compiler unavailable", error.message); }
  if (health.capabilities.jev) {
    const probe = { id: "smoke", primitive: "noul", description: "是否明确给出可执行的操作步骤", criterion: "需要具体动作和顺序", positive: "提供点击或操作动作", negative: "只抽象提及教程" };
    try { const result = await post("/decide", { window: windows[1], probes: [probe] }); console.log("Jev model", result.answers[0].model, "noul", result.answers[0].raw, "status", "ok", "input tokens", result.usage?.inputTokens ?? "unavailable"); }
    catch (error) { console.log("Jev unavailable", error.message); }
  }
  if (health.capabilities.supadata && process.argv.includes("--transcript")) {
    try { const result = await post("/transcript", { videoId: "dQw4w9WgXcQ" }); console.log("Supadata segments", result.segments.length, "first offset ms", result.segments[0]?.startMs); }
    catch (error) { console.log("Supadata unavailable", error.message); }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
