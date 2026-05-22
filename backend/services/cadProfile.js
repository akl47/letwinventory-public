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
 *
 * @typedef {{id:string, kind:'line'|'arc', startId:string, endId:string}} ProfileSegment
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

  // Segment components (lines + arcs): BFS through shared endpoints so a
  // filleted-rectangle chain (line → arc → line → arc → …) lands in a
  // single component. Without arcs in the adjacency, a filleted rectangle
  // gets split into 4 single-line components that each fail the
  // ≥3-segments check downstream.
  const segments = segmentsOf(state);
  const adj = buildSegmentAdjacency(segments);
  const segById = new Map(segments.map(s => [s.id, s]));
  const visited = new Set();
  for (const startSeg of segments) {
    if (visited.has(startSeg.id)) continue;
    const componentIds = new Set([startSeg.id]);
    const componentPointIds = new Set([startSeg.startId, startSeg.endId]);
    const queue = [startSeg.id];
    while (queue.length > 0) {
      const sid = queue.shift();
      const seg = segById.get(sid);
      for (const pid of [seg.startId, seg.endId]) {
        for (const adjSid of adj.get(pid) || []) {
          if (componentIds.has(adjSid)) continue;
          componentIds.add(adjSid);
          queue.push(adjSid);
          const adjSeg = segById.get(adjSid);
          componentPointIds.add(adjSeg.startId);
          componentPointIds.add(adjSeg.endId);
        }
      }
    }
    for (const sid of componentIds) visited.add(sid);
    // Arcs also reference a centre point — include it in the sub-state so
    // extractClosedLoop can compute the arc's angles.
    for (const id of componentIds) {
      const e = findEntityById(state, id);
      if (e && e.kind === 'arc') componentPointIds.add(e.centerId);
    }
    const subState = {
      entities: state.entities.filter(e =>
        (e.kind === 'point' && componentPointIds.has(e.id)) ||
        componentIds.has(e.id),
      ),
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
  const segments = segmentsOf(state);
  const circles = state.entities.filter(e => e.kind === 'circle' && !e.construction);

  if (segments.length === 0 && circles.length === 1) {
    const c = circles[0];
    const center = findPoint(state, c.centerId);
    if (!center) return { loop: null, error: `circle ${c.id}: center point not found` };
    return { loop: [{ kind: 'circle', center: { x: center.x, y: center.y }, radius: c.radius }] };
  }

  if (segments.length === 0) return { loop: null, error: 'sketch has no lines or arcs (empty profile)' };
  if (segments.length < 3) return { loop: null, error: 'closed profile requires at least 3 segments' };

  const adj = buildSegmentAdjacency(segments);
  for (const [pid, incident] of adj) {
    if (incident.length === 1) return { loop: null, error: `open chain at point ${pid}` };
    if (incident.length > 2) return { loop: null, error: `point ${pid} touches ${incident.length} edges (must be 2)` };
  }

  const segById = new Map(segments.map(s => [s.id, s]));
  const start = segments[0];
  const visited = new Set();
  const pointWalk = [start.startId];
  const segmentWalk = [];
  let prevPoint = start.startId;
  let currentId = start.id;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    segmentWalk.push(currentId);
    const seg = segById.get(currentId);
    const nextPoint = seg.startId === prevPoint ? seg.endId : seg.startId;
    pointWalk.push(nextPoint);
    prevPoint = nextPoint;
    const incident = adj.get(prevPoint) || [];
    currentId = incident.find(id => id !== currentId);
  }
  if (pointWalk[0] !== pointWalk[pointWalk.length - 1]) {
    return { loop: null, error: 'profile is not a closed loop' };
  }
  if (visited.size !== segments.length) {
    return { loop: null, error: 'sketch contains multiple disjoint loops' };
  }

  const edges = [];
  for (let i = 0; i < segmentWalk.length; i++) {
    const seg = segById.get(segmentWalk[i]);
    const aId = pointWalk[i];
    const bId = pointWalk[i + 1];
    const a = findPoint(state, aId);
    const b = findPoint(state, bId);
    if (!a || !b) return { loop: null, error: `profile walk hit missing point ${aId} or ${bId}` };
    if (seg.kind === 'line') {
      edges.push({ kind: 'line', start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } });
    } else {
      const arc = findEntityById(state, seg.id);
      if (!arc || arc.kind !== 'arc') return { loop: null, error: `arc ${seg.id}: entity not found` };
      const center = findPoint(state, arc.centerId);
      if (!center) return { loop: null, error: `arc ${seg.id}: center point not found` };
      const startAngle = Math.atan2(a.y - center.y, a.x - center.x);
      const endAngle   = Math.atan2(b.y - center.y, b.x - center.x);
      // arc.ccw is the rotational sense from arc.startId → arc.endId. If
      // the walker traverses the arc in reverse, the sense flips.
      const walkedNatural = aId === arc.startId;
      const ccw = walkedNatural ? arc.ccw : !arc.ccw;
      edges.push({
        kind: 'arc',
        center: { x: center.x, y: center.y },
        radius: arc.radius,
        startAngle, endAngle, ccw,
        start: { x: a.x, y: a.y },
        end:   { x: b.x, y: b.y },
      });
    }
  }
  return { loop: edges };
}

/**
 * @typedef {{ outer: ProfileLoop, holes: ProfileLoop[] }} ProfileRegion
 * @typedef {{ regions: ProfileRegion[], errors: string[] }} RegionsResult
 *
 * Partition the loops into planar regions, detecting nesting via
 * point-in-polygon tests on tessellated polygons. Mirrors the
 * `extractRegions` helper in `frontend/src/app/cad/lib/profile.ts`.
 *
 * @param {object} state
 * @returns {RegionsResult}
 */
function extractRegions(state) {
  const { loops, errors } = extractClosedLoops(state);
  const polys = loops.map(l => tessellateProfileLoopJS(l));
  /** @type {Set<number>[]} */
  const insideOf = loops.map(() => new Set());
  for (let i = 0; i < loops.length; i++) {
    const sample = interiorSample(polys[i]);
    if (!sample) continue;
    for (let j = 0; j < loops.length; j++) {
      if (i === j) continue;
      if (pointInPolygon(sample, polys[j])) insideOf[i].add(j);
    }
  }
  // Parent of i = container j whose own ancestry is deepest (= direct parent).
  const parent = loops.map((_, i) => {
    let best = null;
    let bestDepth = -1;
    for (const j of insideOf[i]) {
      const depth = insideOf[j].size;
      if (depth > bestDepth) { best = j; bestDepth = depth; }
    }
    return best;
  });
  /** @type {ProfileRegion[]} */
  const regions = loops.map((loop, i) => {
    const holes = [];
    for (let c = 0; c < loops.length; c++) {
      if (parent[c] === i) holes.push(loops[c]);
    }
    return { outer: loop, holes };
  });
  return { regions, errors };
}

// Tessellate a ProfileLoop into a polygon (open — last vertex doesn't
// repeat the first). Used only for point-in-polygon containment, so a
// coarse chord tolerance is fine.
function tessellateProfileLoopJS(loop) {
  const chord = 1.0;
  if (loop.length === 1 && loop[0].kind === 'circle') {
    return tessellateCircleJS(loop[0].center, loop[0].radius, chord);
  }
  const out = [];
  for (const e of loop) {
    if (e.kind === 'line') {
      out.push({ x: e.start.x, y: e.start.y });
    } else if (e.kind === 'arc') {
      const pts = tessellateArcJS(e.center, e.radius, e.startAngle, e.endAngle, e.ccw, chord);
      for (let i = 0; i < pts.length - 1; i++) out.push(pts[i]);
    } else if (e.kind === 'circle') {
      const pts = tessellateCircleJS(e.center, e.radius, chord);
      for (let i = 0; i < pts.length; i++) out.push(pts[i]);
    }
  }
  return out;
}

function tessellateCircleJS(center, radius, chord) {
  const seg = Math.max(8, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - chord / radius))));
  const out = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    out.push({ x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) });
  }
  return out;
}

function tessellateArcJS(center, radius, startAngle, endAngle, ccw, chord) {
  let sweep = endAngle - startAngle;
  if (ccw) {
    while (sweep <= 0) sweep += Math.PI * 2;
  } else {
    while (sweep >= 0) sweep -= Math.PI * 2;
  }
  const segCount = Math.max(2, Math.ceil(Math.abs(sweep) / Math.acos(Math.max(-1, 1 - chord / radius))));
  const out = [];
  for (let i = 0; i <= segCount; i++) {
    const t = startAngle + (sweep * i) / segCount;
    out.push({ x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) });
  }
  return out;
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function interiorSample(poly) {
  if (!poly || poly.length < 3) return null;
  let sx = 0, sy = 0;
  for (const p of poly) { sx += p.x; sy += p.y; }
  const centroid = { x: sx / poly.length, y: sy / poly.length };
  if (pointInPolygon(centroid, poly)) return centroid;
  const v0 = poly[0];
  return { x: v0.x + (centroid.x - v0.x) * 0.01, y: v0.y + (centroid.y - v0.y) * 0.01 };
}

/** @param {object} state @returns {ProfileSegment[]} */
function segmentsOf(state) {
  const out = [];
  for (const e of state.entities) {
    if (e.construction) continue;
    if (e.kind === 'line') {
      out.push({ id: e.id, kind: 'line', startId: e.startId, endId: e.endId });
    } else if (e.kind === 'arc') {
      out.push({ id: e.id, kind: 'arc', startId: e.startId, endId: e.endId });
    }
  }
  return out;
}

/** @param {ProfileSegment[]} segments @returns {Map<string, string[]>} */
function buildSegmentAdjacency(segments) {
  const adj = new Map();
  for (const s of segments) {
    if (!adj.has(s.startId)) adj.set(s.startId, []);
    if (!adj.has(s.endId))   adj.set(s.endId,   []);
    adj.get(s.startId).push(s.id);
    adj.get(s.endId).push(s.id);
  }
  return adj;
}

function findEntityById(state, id) {
  return state.entities.find(e => e.id === id) || null;
}

function findPoint(state, id) {
  return state.entities.find(e => e.id === id && e.kind === 'point') || null;
}

module.exports = {
  extractClosedLoop,
  extractClosedLoops,
  extractRegions,
};
