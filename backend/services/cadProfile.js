'use strict';

// Server-side port of `frontend/src/app/cad/lib/profile.ts`. The frontend
// runs the same algorithm for its `canExtrude` UI affordance; this module
// runs on the saved sketchDoc when the server regenerates a model.
//
// Until the sketch solver moves server-side (Phase 1.5 / 2), we trust the
// resolved Cartesian coordinates that the client already solved and saved.
// PlaneGCS-backed server-side re-solving is a separate work item.

const { bezierLoopsFromTextEntity } = require('./cadTextGlyphs');

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
 * Merge point ids that the sketch treats as the same vertex before the
 * walker keys adjacency on them. Two sources of equivalence:
 *   (1) explicit `coincident` constraints between two points
 *   (2) two points sitting within `spatialTol` of each other (catches
 *       accidental duplicates the user hasn't constrained yet).
 *
 * The sketch editor draws every line with a fresh endpoint id and links
 * snapped clicks via a coincident constraint instead of reusing ids, so
 * a four-line square otherwise looks like 8 vertices of degree 1 to the
 * walker and is rejected as "open chain at point …".
 *
 * @param {object} state @returns {object}
 */
function canonicalizePoints(state) {
  const spatialTol = 1e-4;
  const parent = new Map();
  const find = (id) => {
    let p = parent.get(id);
    if (p === undefined) p = id;
    while (parent.has(p) && parent.get(p) !== p) p = parent.get(p);
    parent.set(id, p);
    return p;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const pointIds = new Set();
  for (const e of state.entities) {
    if (e.kind === 'point') { parent.set(e.id, e.id); pointIds.add(e.id); }
  }
  for (const c of (state.constraints || [])) {
    if (c.type !== 'coincident' || !c.targets || c.targets.length !== 2) continue;
    const a = c.targets[0] && c.targets[0].entityId;
    const b = c.targets[1] && c.targets[1].entityId;
    if (a && b && pointIds.has(a) && pointIds.has(b)) union(a, b);
  }
  const KEY = Math.round(1 / spatialTol);
  const bucketRep = new Map();
  for (const e of state.entities) {
    if (e.kind !== 'point') continue;
    const key = `${Math.round(e.x * KEY)}/${Math.round(e.y * KEY)}`;
    const existing = bucketRep.get(key);
    if (existing) union(existing, e.id);
    else bucketRep.set(key, e.id);
  }
  let anyMerged = false;
  for (const id of pointIds) { if (find(id) !== id) { anyMerged = true; break; } }
  if (!anyMerged) return state;

  const rewrite = (id) => pointIds.has(id) ? find(id) : id;
  const rewritten = state.entities.map(e => {
    if (e.kind === 'line') return { ...e, startId: rewrite(e.startId), endId: rewrite(e.endId) };
    if (e.kind === 'circle') return { ...e, centerId: rewrite(e.centerId) };
    if (e.kind === 'arc') return { ...e, centerId: rewrite(e.centerId), startId: rewrite(e.startId), endId: rewrite(e.endId) };
    return e;
  });
  return { entities: rewritten, constraints: state.constraints || [] };
}

/**
 * @param {object} state sketch state ({entities, constraints}) from sketchDoc
 * @param {(raw:string)=>string} [resolve] expands `#{var}` placeholders in text
 * @returns {ProfilesResult}
 */
function extractClosedLoops(state, resolve = (s) => s) {
  state = canonicalizePoints(state);
  /** @type {ProfileLoop[]} */
  const loops = [];
  /** @type {string[]} */
  const errors = [];

  // Text glyphs contribute closed loops via the Roboto glyph engine (mirrors
  // the frontend `profile.ts` text branch). Emitted FIRST — same order as the
  // frontend — so a text-only sketch's region indices line up with the
  // `regionIndices` the client stored at commit time. Each glyph outline (and
  // any inner counter for O / A / D) becomes a chain of analytic Bézier edges
  // so the kernel builds one smooth face per curve (Edge::bezier).
  for (const e of state.entities) {
    if (e.kind !== 'text') continue;
    // Single-line (engraving) text is open strokes — nothing to extrude.
    if (e.font === 'singleLine') continue;
    const bezierLoops = bezierLoopsFromTextEntity(state, e, resolve);
    for (const contour of bezierLoops) {
      if (contour.length < 2) continue;
      /** @type {ProfileLoop} */
      const edges = contour.map((seg) => ({ kind: 'bezier', points: seg.points }));
      loops.push(edges);
    }
  }

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
  // ≥3 straight segments enclose a region; 2 straight lines only retrace one
  // edge (zero area). But 2 segments DO close a real region when at least one
  // is curved: a semicircle + its diameter line (D-shape), or two arcs (lens).
  const arcCount = segments.filter(s => s.kind === 'arc').length;
  if (segments.length < 2 || (segments.length === 2 && arcCount === 0)) {
    return { loop: null, error: 'closed profile requires at least 3 segments, or 2 with a curved (arc) edge' };
  }

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
function extractRegions(state, resolve = (s) => s) {
  const { loops, errors } = extractClosedLoops(state, resolve);
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
    } else if (e.kind === 'bezier') {
      // Sample for containment only (the analytic edge still goes to the
      // kernel). Drop the trailing point — the next edge repeats it.
      const pts = sampleBezierJS(e.points, chord);
      for (let i = 0; i < pts.length - 1; i++) out.push(pts[i]);
    }
  }
  return out;
}

/** Sample a Bézier (2/3/4 control points) into a polyline incl. both
 * endpoints, via de Casteljau. Mirrors `sampleBezier` in profile.ts. */
function sampleBezierJS(pts, chord) {
  if (pts.length < 2) return pts.slice();
  if (pts.length === 2) return [pts[0], pts[1]];
  let ctrlLen = 0;
  for (let i = 1; i < pts.length; i++) ctrlLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const segs = Math.max(2, Math.min(48, Math.ceil(ctrlLen / Math.max(1e-6, chord))));
  const n = pts.length - 1;
  const out = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    for (let r = 1; r <= n; r++) {
      for (let i = 0; i <= n - r; i++) {
        xs[i] = (1 - t) * xs[i] + t * xs[i + 1];
        ys[i] = (1 - t) * ys[i] + t * ys[i + 1];
      }
    }
    out.push({ x: xs[0], y: ys[0] });
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
  // Pick a vertex and nudge it slightly toward the centroid. This
  // gives a point near the polygon's BOUNDARY (distinct from the
  // centroid) so two concentric loops produce different samples
  // — without this, two concentric circles both sample at the
  // shared centre, point-in-polygon reports each "inside" the
  // other, and parent detection emits duplicate annulus regions
  // instead of an annulus + inner disk. The 1% nudge stays well
  // inside the polygon for any convex shape (circles, rectangles)
  // and for most non-pathological non-convex shapes too.
  let sx = 0, sy = 0;
  for (const p of poly) { sx += p.x; sy += p.y; }
  const centroid = { x: sx / poly.length, y: sy / poly.length };
  const v0 = poly[0];
  const candidate = { x: v0.x + (centroid.x - v0.x) * 0.01, y: v0.y + (centroid.y - v0.y) * 0.01 };
  if (pointInPolygon(candidate, poly)) return candidate;
  // Defensive fallback: try the centroid (works for any convex
  // polygon even when the vertex-offset somehow misses).
  if (pointInPolygon(centroid, poly)) return centroid;
  return null;
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
