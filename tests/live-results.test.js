import test from "node:test";
import assert from "node:assert/strict";
import { addProject, commitFinal, createLiveSession, liveSessionKey, liveSessionSnapshot,
  liveProjectView, liveProbeSummary } from "../extension/live-core.js";
import { createLiveStore } from "../extension/live-store.js";

test("a saved live session preserves final transcript and project-scoped readings", () => {
  const session = createLiveSession(0);
  session.interimStartMs = 100;
  commitFinal(session, "我们服务餐厅，按日统计食材损耗。", 2000);
  session.readings.push({ id: "r1", probeId: "boring", projectId: "project-1", startMs: 100,
    endMs: 2000, text: session.segments[0].text, status: "ok", value: .25, label: "25/100 强度" });
  addProject(session, 3000);
  session.interimStartMs = 3200;
  commitFinal(session, "我们的愿景是颠覆生态。", 5000);
  session.readings.push({ id: "r2", probeId: "empty", projectId: "project-2", startMs: 3200,
    endMs: 5000, text: session.segments[1].text, status: "ok", value: 1, label: "100/100 强度" });
  const probes = [{ id: "boring", name: "无聊程度" }, { id: "empty", name: "空洞概念" }];
  const record = liveSessionSnapshot(session, probes, 6000);
  assert.equal(liveSessionKey(session.id), `cuewave:live:${session.id}`);
  assert.equal(record.format, "cuewave-live-pitch");
  assert.equal(record.endedAt, null);
  assert.equal(record.analysisPending, false);
  assert.equal(record.durationMs, 6000);
  assert.equal(record.segments.length, 2);
  assert.equal(record.interimStartMs, undefined, "interim text must not become saved evidence");
  const first = liveProjectView(record, "project-1");
  assert.equal(first.durationMs, 3000);
  assert.deepEqual(first.segments.map((item) => item.text), ["我们服务餐厅，按日统计食材损耗。"]);
  assert.deepEqual(first.readings.map((item) => item.id), ["r1"]);
  const all = liveProjectView(record, "all");
  assert.equal(all.segments.length, 2);
  assert.equal(all.readings.length, 2);
  session.endedAt = "2026-09-27T12:00:00.000Z";
  assert.equal(liveSessionSnapshot(session, probes, 6000).endedAt, session.endedAt);
  assert.equal(liveSessionSnapshot(session, probes, 6000, true).analysisPending, true);
});

test("result summaries exclude failed and missing scores rather than presenting zero", () => {
  const probe = { id: "empty", name: "空洞概念", primitive: "score" };
  const readings = [
    { probeId: "empty", status: "ok", value: .5, startMs: 0, endMs: 1000 },
    { probeId: "empty", status: "ok", value: 1, startMs: 1000, endMs: 2000 },
    { probeId: "empty", status: "failed", startMs: 2000, endMs: 3000 }
  ];
  const summary = liveProbeSummary(readings, probe);
  assert.equal(summary.count, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.average, .75);
  assert.equal(summary.peak.value, 1);
  assert.equal(liveProbeSummary(readings.slice(2), probe).average, null);
});

test("live storage serializes updates so a later Jev result cannot be overwritten", async () => {
  const values = new Map();
  let releaseFirst;
  const firstWrite = new Promise((resolve) => { releaseFirst = resolve; });
  let writes = 0;
  const storage = { async set(items) {
    if (++writes === 1) await firstWrite;
    for (const [key, value] of Object.entries(items)) values.set(key, value);
  }, async get(key) { return typeof key === "string" ? { [key]: values.get(key) } : Object.fromEntries(values); },
  async remove(key) { values.delete(key); } };
  const store = createLiveStore(storage);
  const session = createLiveSession(0);
  const initial = liveSessionSnapshot(session, [], 1000);
  const before = store.save(initial);
  session.readings.push({ id: "r1", status: "ok", probeId: "p", projectId: "project-1", value: .75 });
  const after = store.save(liveSessionSnapshot(session, [], 2000));
  releaseFirst();
  await Promise.all([before, after]);
  assert.equal((await store.get(session.id)).readings.length, 1);
  assert.equal((await store.list()).length, 1);
  await store.remove(session.id);
  assert.equal(await store.get(session.id), undefined);
});
