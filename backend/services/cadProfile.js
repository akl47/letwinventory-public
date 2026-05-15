'use strict';

// Server-side port of `frontend/src/app/cad/lib/profile.ts`. The frontend
// runs the same algorithm for its `canExtrude` UI affordance; this module
// runs on the saved sketchDoc when the server regenerates a model.
//
// Until the sketch solver moves server-side (Phase 1.5 / 2), we trust the
// resolved Cartesian coordinates that the client already solved and saved.
// PlaneGCS-backed server-side re-solving is a separate work item.

/**
 * @typedef {{x:number, y:number}} Point2
 * @typedef {{kind:'line', start:Point2, end:Point2}} LineProfileEdge
 * @typedef {{kind:'arc', center:Point2, radius:number, startAngle:number, endAngle:number, ccw:boolean, start:Point2, end:Point2}} ArcProfileEdge
 * @typedef {{kind:'circle', center:Point2, radius:number}} CircleProfileEdge
 * @typedef {LineProfileEdge | ArcProfileEdge | CircleProfileEdge} ProfileEdge
 * @typedef {ProfileEdge[]} ProfileLoop
 * @typedef {{ loops: ProfileLoop[], errors: string[] }} ProfilesResult
 */

/**
 * @param {object} state sketch state ({entities, constraints}) from sketchDoc
 * @returns {ProfilesResult}
 */
function extractClosedLoops(state) {
  /** @type {ProfileLoop[]} */
  const loops = [];
  /** @type {string[]} */
  const errors = [];

  // Each non-construction circle is its own component (a closed loop on its
  // own — same fast path REQ 612 added on the frontend).
  for (const e of state.entities) {
    if (e.kind !== 'circle' || e.construction) continue;
    const center = findPoint(state, e.centerId);
    if (!center) { errors.push(`circle ${e.id}: center point not found`); continue; }
    loops.push([{ kind: 'circle', center: { x: center.x, y: center.y }, radius: e.radius }]);
  }

  // Line components — BFS through shared endpoints, then run the single-loop
  // walker on each connected subset (same shape the frontend uses).
  const lines = state.entities.filter(e => e.kind === 'line' && !e.construction);
  const adj = buildLineAdjacency(lines);
  const visited = new Set();
  for (const startLine of lines) {
    if (visited.has(startLine.id)) continue;
    const componentLineIds = new Set([startLine.id]);
    const componentPointIds = new Set([startLine.startId, startLine.endId]);
    const queue = [startLine.id];
    while (queue.length > 0) {
      const lid = queue.shift();
      const line = lines.find(l => l.id === lid);
      for (const pid of [line.startId, line.endId]) {
        for (const adjLid of adj.get(pid) || []) {
          if (componentLineIds.has(adjLid)) continue;
          componentLineIds.add(adjLid);
          queue.push(adjLid);
          const adjLine = lines.find(l => l.id === adjLid);
          componentPointIds.add(adjLine.startId);
          componentPointIds.add(adjLine.endId);
        }
      }
    }
    for (const lid of componentLineIds) visited.add(lid);
    const subLines = lines.filter(l => componentLineIds.has(l.id));
    const subState = {
      entities: [
        ...state.entities.filter(e => e.kind === 'point' && componentPointIds.has(e.id)),
        ...subLines,
      ],
      constraints: [],
    };
    const sub = extractClosedLoop(subState);
    if (sub.loop) loops.push(sub.loop);
    else if (sub.error) errors.push(sub.error);
  }

  return { loops, errors };
}

/**
 * Single-loop walker — used by both the public {@link extractClosedLoops}
 * (per-component) and standalone callers that already know they have one
 * loop. Returns `{ loop, error? }`. The single-circle fast path matches
 * `extractClosedLoop` in `profile.ts`.
 */
function extractClosedLoop(state) {
  const lines = state.entities.filter(e => e.kind === 'line' && !e.construction);
  const circles = state.entities.filter(e => e.kind === 'circle' && !e.construction);

  if (lines.length === 0 && circles.length === 1) {
    const c = circles[0];
    const center = findPoint(state, c.centerId);
    if (!center) return { loop: null, error: `circle ${c.id}: center point not found` };
    return { loop: [{ kind: 'circle', center: { x: center.x, y: center.y }, radius: c.radius }] };
  }

  if (lines.length === 0) return { loop: null, error: 'sketch has no lines (empty profile)' };
  if (lines.length < 3) return { loop: null, error: 'closed profile requires at least 3 line segments' };

  const adj = buildLineAdjacency(lines);
  for (const [pid, incident] of adj) {
    if (incident.length === 1) return { loop: null, error: `open chain at point ${pid}` };
    if (incident.length > 2) return { loop: null, error: `point ${pid} touches ${incident.length} edges (must be 2)` };
  }

  const startLine = lines[0];
  const visitedLines = new Set();
  const walk = [];
  let prevPoint = startLine.startId;
  walk.push(prevPoint);
  let currentLine = startLine.id;
  while (currentLine && !visitedLines.has(currentLine)) {
    visitedLines.add(currentLine);
    const line = lines.find(l => l.id === currentLine);
    const nextPoint = line.startId === prevPoint ? line.endId : line.startId;
    walk.push(nextPoint);
    prevPoint = nextPoint;
    const incident = adj.get(prevPoint) || [];
    currentLine = incident.find(id => id !== currentLine);
  }
  if (walk[0] !== walk[walk.length - 1]) return { loop: null, error: 'profile is not a closed loop' };
  if (visitedLines.size !== lines.length) return { loop: null, error: 'sketch contains multiple disjoint loops' };

  const edges = [];
  for (let i = 0; i < walk.length - 1; i++) {
    const a = findPoint(state, walk[i]);
    const b = findPoint(state, walk[i + 1]);
    if (!a || !b) return { loop: null, error: `profile walk hit missing point ${walk[i]} or ${walk[i + 1]}` };
    edges.push({ kind: 'line', start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } });
  }
  return { loop: edges };
}

function buildLineAdjacency(lines) {
  const adj = new Map();
  for (const l of lines) {
    if (!adj.has(l.startId)) adj.set(l.startId, []);
    if (!adj.has(l.endId)) adj.set(l.endId, []);
    adj.get(l.startId).push(l.id);
    adj.get(l.endId).push(l.id);
  }
  return adj;
}

function findPoint(state, id) {
  return state.entities.find(e => e.id === id && e.kind === 'point') || null;
}

module.exports = {
  extractClosedLoop,
  extractClosedLoops,
};
