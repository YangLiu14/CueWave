export function createLiveSession(now = Date.now()) {
  return { id: crypto.randomUUID(), sourceType: "microphone", scenarioId: "project-pitch", startedAt: new Date(now).toISOString(),
    segments: [], readings: [], projects: [{ id: "project-1", name: "项目 1", startMs: 0, source: "initial" }],
    nextSegmentIndex: 0, interimStartMs: null, lastFinalAtMs: null, gaps: [] };
}

export function addProject(session, atMs, source = "manual") {
  const startMs = Math.max(0, Math.round(atMs));
  if (startMs <= session.projects.at(-1).startMs) return session.projects.at(-1);
  const project = { id: `project-${session.projects.length + 1}`, name: `项目 ${session.projects.length + 1}`, startMs, source };
  session.projects.push(project);
  return project;
}

export function commitFinal(session, text, atMs) {
  const clean = String(text || "").trim();
  if (!clean) return null;
  const endMs = Math.max(1, Math.round(atMs));
  const previousEnd = session.segments.at(-1)?.endMs || 0;
  const startMs = Math.max(previousEnd, Math.min(endMs - 1, session.interimStartMs ?? Math.max(0, endMs - 2000)));
  const segment = { id: `s${session.segments.length}`, sessionId: session.id, streamId: "mic", startMs,
    endMs, text: clean, isFinal: true, revision: 1, language: null, projectId: session.projects.at(-1).id,
    timing: "local-approximate" };
  session.segments.push(segment);
  session.interimStartMs = null;
  session.lastFinalAtMs = endMs;
  return segment;
}

export function nextLiveWindow(session) {
  const first = session.segments[session.nextSegmentIndex];
  if (!first) return null;
  let endIndex = session.nextSegmentIndex;
  while (endIndex < session.segments.length && session.segments[endIndex].projectId === first.projectId
    && session.segments[endIndex].endMs - first.startMs <= 15000) endIndex++;
  if (endIndex === session.nextSegmentIndex) endIndex++;
  const target = session.segments.slice(session.nextSegmentIndex, endIndex);
  const context = session.segments.filter((s) => s.projectId === first.projectId && s.endMs <= first.startMs
    && s.endMs > first.startMs - 30000);
  return { segmentCount: target.length, window: { id: `live-${first.id}`, startMs: first.startMs,
    endMs: target.at(-1).endMs, text: target.map((s) => s.text).join(" "), context: context.map((s) => s.text).join(" "),
    segmentIds: target.map((s) => s.id), projectId: first.projectId } };
}

export function shouldAutoStartProject(session, text, atMs) {
  if (session.projects.length < 1 || session.lastFinalAtMs == null || atMs - session.lastFinalAtMs < 20000) return false;
  return /(?:大家好.{0,12}(?:我们|项目)|接下来.{0,12}(?:项目|团队)|下一个项目|our project|next project)/i.test(text);
}
