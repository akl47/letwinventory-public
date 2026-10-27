'use strict';

// Server-side port of `frontend/src/app/cad/lib/profile.ts`. The frontend
// runs the same algorithm for its `canExtrude` UI affordance; this module
// runs on the saved sketchDoc when the server regenerates a model.
//
// Until the sketch solver moves server-side (Phase 1.5 / 2), we trust the
// resolved Cartesian coordinates that the client already solved and saved.
// PlaneGCS-backed server-side re-solving is a separate work item.

const { bezierLoopsFromTextEntity } = require('./cadTextGlyphs');
const { bezierSegsFromSpline, bezierSegsFromEllipse } = require('./cadCurveBeziers');
const { splitAtIntersections, extractArrangementFaces, mergeFaces } = require('./cadArrangement');

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
 * @param {(raw:string)=>string} [resolve] expands `#{var}` placeholders in text
 * @returns {ProfilesResult}
 */
function extractClosedLoops(state, resolve = (s) => s) {
  /** @type {ProfileLoop[]} */
  const loops = [];
  /** @type {string[]} */
  const errors = [];
  // Per-loop provenance, parallel to `loops`. `face` carries the arrangement
  // half-edge cycle so multiple selected regions can be merged into one
  // profile (see extractMergedRegions). Extra return field — back-compatible.
  /** @type {Array<{kind:string, face?:object}>} */
  const sources = [];

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
      sources.push({ kind: 'text' });
    }
  }

  // REQ 883 — closed splines and ellipses become extrudable profiles as
  // chains of cubic Bézier edges (same kernel path as text glyphs:
  // Edge::bezier, one smooth face per curve). Emitted SECOND, ahead of the
  // arrangement walker.
  //
  // EMIT-ORDER RULE (must match frontend profile.ts exactly — stored
  // regionIndices are positional): (1) text glyph loops, then (2) curve
  // loops — closed splines + ellipses, in sketch entity order — then
  // (3) standalone circles, then (4) arrangement faces.
  //
  // v1 LIMITATION: like glyphs, curve loops are emitted unconditionally and
  // do NOT participate in the planar arrangement (splitAtIntersections
  // ignores spline/ellipse kinds), so an ellipse or spline crossed by other
  // geometry is still emitted whole — the intersection does not subdivide it
  // into sub-regions. Nesting/holes still work exactly as for glyphs:
  // extractRegions runs its containment test over the sampled Bézier chain.
  for (const e of state.entities) {
    if (e.construction) continue;
    if (e.kind === 'spline') {
      const ids = e.controlPointIds;
      if (!Array.isArray(ids) || ids.length < 4) continue;  // below cubic minimum
      const pts = [];
      let missing = false;
      for (const id of ids) {
        const p = findPoint(state, id);
        if (!p) { missing = true; break; }
        pts.push({ x: p.x, y: p.y });
      }
      if (missing) { errors.push(`spline ${e.id}: control point not found`); continue; }
      // Closed iff first/last control point share an id or coincide. Open
      // splines contribute nothing (as before REQ 883).
      const first = pts[0];
      const last = pts[pts.length - 1];
      const closed = ids[0] === ids[ids.length - 1]
        || Math.hypot(last.x - first.x, last.y - first.y) < 1e-6;
      if (!closed) continue;
      const segs = bezierSegsFromSpline(pts, e.degree);
      if (!segs) continue;  // non-cubic degree — out of v1 scope
      loops.push(segs.map((points) => ({ kind: 'bezier', points })));
      sources.push({ kind: 'curve' });
    } else if (e.kind === 'ellipse') {
      const center = findPoint(state, e.centerId);
      const majorEnd = findPoint(state, e.majorAxisEndId);
      if (!center || !majorEnd) {
        errors.push(`ellipse ${e.id}: center or major-axis point not found`);
        continue;
      }
      const segs = bezierSegsFromEllipse(
        { x: center.x, y: center.y }, { x: majorEnd.x, y: majorEnd.y }, e.minorRadius,
      );
      if (!segs) continue;  // degenerate axes
      loops.push(segs.map((points) => ({ kind: 'bezier', points })));
      sources.push({ kind: 'curve' });
    }
  }

  // PLANAR ARRANGEMENT (must mirror `profile.ts` exactly so region indices and
  // ordering match the frontend extrude preview — see cadArrangement.js).
  //
  // First: split every non-construction curve at every intersection. This
  // turns "circle + line through it" into "two arcs + three line segments",
  // wiring intersection points into the topology so the arrangement walker can
  // discover every bounded region — not just connected-component loops.
  const split = splitAtIntersections(state);

  // Each non-construction circle that survived splitting (had fewer than 2
  // crossings) is its own standalone loop. A circle with 2+ intersections has
  // already been converted to arcs the face walker picks up below.
  for (const e of split.entities) {
    if (e.kind !== 'circle' || e.construction) continue;
    const center = findPoint(split, e.centerId);
    if (!center) { errors.push(`circle ${e.id}: center point not found`); continue; }
    loops.push([{ kind: 'circle', center: { x: center.x, y: center.y }, radius: e.radius }]);
    sources.push({ kind: 'circle' });
  }

  // Run the DCEL face walker over the split state, keeping only bounded faces
  // (positive signed area). The unbounded outer face has negative/zero area
  // and is discarded; sub-2-edge or near-zero-area faces are collinear
  // artefacts of folding dangling chains into the outer traversal.
  const faces = extractArrangementFaces(split);
  const AREA_EPS = 1e-6;
  for (const f of faces) {
    if (f.edges.length < 2) continue;
    if (f.signedArea <= AREA_EPS) continue;
    const loop = faceToProfileLoop(f, split);
    if (loop.length > 0) { loops.push(loop); sources.push({ kind: 'face', face: f }); }
  }

  return { loops, errors, sources, split };
}

/**
 * Convert a DCEL face's half-edge boundary into a ProfileLoop the extrude
 * kernel expects. Mirrors `faceToProfileLoop` in `profile.ts`. Each line
 * half-edge → one LineProfileEdge; each arc half-edge → one ArcProfileEdge
 * (using the per-half-edge angles/sense `buildHalfEdges` already computed).
 *
 * @param {{edges:Array<object>}} face
 * @param {object} state post-split sketch state
 * @returns {ProfileLoop}
 */
function faceToProfileLoop(face, state) {
  /** @type {ProfileEdge[]} */
  const out = [];
  for (const e of face.edges) {
    if (e.kind === 'line' && e.from && e.to) {
      out.push({ kind: 'line', start: { x: e.from.x, y: e.from.y }, end: { x: e.to.x, y: e.to.y } });
    } else if (e.kind === 'arc' && e.arcCenter && e.arcRadius !== undefined
               && e.arcStartAngle !== undefined && e.arcEndAngle !== undefined
               && e.arcCcw !== undefined) {
      const from = findPoint(state, e.fromId);
      const to = findPoint(state, e.toId);
      if (!from || !to) continue;
      out.push({
        kind: 'arc',
        center: { x: e.arcCenter.x, y: e.arcCenter.y },
        radius: e.arcRadius,
        startAngle: e.arcStartAngle,
        endAngle: e.arcEndAngle,
        ccw: e.arcCcw,
        start: { x: from.x, y: from.y },
        end: { x: to.x, y: to.y },
      });
    }
  }
  return out;
}

/**
 * Merge the SELECTED regions into combined profile(s) for one extrude.
 * Adjacent arrangement tiles (regions sharing an edge) are unioned into a
 * single outer loop — so the kernel extrudes one connected solid instead of
 * separate edge-touching prisms that hang OCCT's fuse. Standalone loops
 * (circles / text) in the selection pass through unmerged. Disjoint groups
 * stay separate regions (still one body per disjoint piece downstream).
 *
 * This also makes a region whose "Up to" side is already solid behave
 * correctly with no special-casing: as part of a larger merged profile, the
 * up-to subtraction simply yields nothing where it's inside the body, while
 * Direction-2 fills it — no separate prism, no fuse.
 *
 * @param {object} state @param {number[]} regionIndices @param {Function} [resolve]
 * @returns {{ regions: ProfileRegion[], errors: string[] }}
 */
/**
 * Clean up a merged loop where dropping shared edges left redundant joins:
 *   - consecutive COLLINEAR lines → one line (kernel rejects collinear corners)
 *   - consecutive CO-CIRCULAR arcs (same circle, sense, continuous) → one arc;
 *     a closed run of them collapses to a single `circle` edge.
 * Without the arc case, a circle split into N arc tiles stays N arcs and the
 * extruded face carries N spurious seam edges. Only same-direction/continuous
 * joins merge; genuine corners are kept.
 * @param {ProfileLoop} loop @returns {ProfileLoop}
 */
function simplifyMergedLoop(loop) {
  if (!Array.isArray(loop) || loop.length < 2) return loop;
  const TOL = 1e-6;
  const collinearLines = (a, b) => {
    if (a.kind !== 'line' || b.kind !== 'line') return false;
    const ax = a.end.x - a.start.x, ay = a.end.y - a.start.y;
    const bx = b.end.x - b.start.x, by = b.end.y - b.start.y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) return false;
    const cross = ax * by - ay * bx, dot = ax * bx + ay * by;
    return Math.abs(cross) / (la * lb) < TOL && dot > 0
      && Math.hypot(a.end.x - b.start.x, a.end.y - b.start.y) < 1e-6;
  };
  const coCircularArcs = (a, b) => (
    a.kind === 'arc' && b.kind === 'arc' && a.ccw === b.ccw
    && Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) < 1e-6
    && Math.abs(a.radius - b.radius) < 1e-6
    && Math.hypot(a.end.x - b.start.x, a.end.y - b.start.y) < 1e-6
  );
  const mergeArcs = (a, b) => ({
    kind: 'arc', center: a.center, radius: a.radius, ccw: a.ccw,
    start: a.start, end: b.end,
    startAngle: Math.atan2(a.start.y - a.center.y, a.start.x - a.center.x),
    endAngle: Math.atan2(b.end.y - a.center.y, b.end.x - a.center.x),
  });
  const out = [];
  for (const e of loop) {
    const prev = out[out.length - 1];
    if (prev && collinearLines(prev, e)) {
      out[out.length - 1] = { kind: 'line', start: prev.start, end: e.end };
    } else if (prev && coCircularArcs(prev, e)) {
      out[out.length - 1] = mergeArcs(prev, e);
    } else {
      out.push({ ...e });
    }
  }
  // Wrap-around: last and first edges can also be a mergeable pair.
  if (out.length >= 2) {
    const last = out[out.length - 1], first = out[0];
    if (collinearLines(last, first)) {
      out.pop();
      out[0] = { kind: 'line', start: last.start, end: first.end };
    } else if (coCircularArcs(last, first)) {
      out.pop();
      out[0] = mergeArcs(last, first);
    }
  }
  // A single arc that closes on itself is a full circle → emit a clean circle
  // (cylindrical face, no seam) rather than a 360° arc.
  if (out.length === 1 && out[0].kind === 'arc'
      && Math.hypot(out[0].start.x - out[0].end.x, out[0].start.y - out[0].end.y) < 1e-6) {
    return [{ kind: 'circle', center: out[0].center, radius: out[0].radius }];
  }
  return out;
}

function extractMergedRegions(state, regionIndices, resolve = (s) => s) {
  const { loops, errors, sources, split } = extractClosedLoops(state, resolve);
  const sel = (regionIndices || []).filter(i => Number.isInteger(i) && i >= 0 && i < loops.length);
  if (sel.length === 0) return { regions: [], errors };

  // Split the selection into mergeable arrangement faces vs standalone loops.
  // Face-sourced selections (from an intersecting arrangement) get fused so
  // edge-touching prisms don't hang OCCT's boolean. Standalone loops (text
  // glyphs, disjoint sketched profiles) are NOT merged — they carry their own
  // holes and must keep them (a letter's counter). Rebuilding holes only from
  // the SELECTED loop set dropped those counters, because a counter's own loop
  // is never in the selection — the "holes got filled in" bug.
  const faceSel = [];
  const standaloneSel = [];
  for (const i of sel) {
    const src = sources[i];
    if (src && src.kind === 'face' && src.face) faceSel.push(src.face);
    else standaloneSel.push(i);
  }

  /** @type {ProfileRegion[]} */
  const regions = [];

  // Standalone regions keep the holes extractRegions attaches by containment.
  if (standaloneSel.length > 0) {
    const { regions: allRegions } = extractRegions(state, resolve);
    for (const i of standaloneSel) {
      if (allRegions[i]) regions.push(allRegions[i]);
    }
  }

  // Merged arrangement faces: fuse selected faces into combined outer loops,
  // then pair each with any hole created by an unselected inner face (same
  // containment test as extractRegions), scoped to the merged loops only.
  if (faceSel.length > 0) {
    const mergedLoops = [];
    for (const merged of mergeFaces(faceSel)) {
      const loop = simplifyMergedLoop(faceToProfileLoop(merged, split));
      if (loop.length > 0) mergedLoops.push(loop);
    }
    if (mergedLoops.length > 0) {
      const polys = mergedLoops.map(l => tessellateProfileLoopJS(l));
      /** @type {Set<number>[]} */
      const insideOf = mergedLoops.map(() => new Set());
      for (let i = 0; i < mergedLoops.length; i++) {
        for (let j = 0; j < mergedLoops.length; j++) {
          if (i !== j && loopContains(polys[i], polys[j])) insideOf[i].add(j);
        }
      }
      const parent = mergedLoops.map((_, i) => {
        let best = null, bestDepth = -1;
        for (const j of insideOf[i]) { const d = insideOf[j].size; if (d > bestDepth) { best = j; bestDepth = d; } }
        return best;
      });
      for (let i = 0; i < mergedLoops.length; i++) {
        if (insideOf[i].size > 0) continue;  // a hole of some other merged loop
        const holes = [];
        for (let c = 0; c < mergedLoops.length; c++) if (parent[c] === i) holes.push(mergedLoops[c]);
        regions.push({ outer: mergedLoops[i], holes });
      }
    }
  }

  if (regions.length === 0) return { regions: [], errors };
  return { regions, errors };
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
  // Containment matrix: insideOf[i] = every j such that loop i is strictly
  // inside loop j. Mirrors `loopContains` in profile.ts — every vertex of i
  // must lie inside j (loops are non-self-intersecting, so this implies full
  // containment). Keeps hole-nesting identical to the frontend.
  /** @type {Set<number>[]} */
  const insideOf = loops.map(() => new Set());
  for (let i = 0; i < loops.length; i++) {
    for (let j = 0; j < loops.length; j++) {
      if (i === j) continue;
      if (loopContains(polys[i], polys[j])) insideOf[i].add(j);
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

/**
 * True iff every vertex of `inner` lies strictly inside `outer`. Loops from
 * extractClosedLoops are non-self-intersecting, so vertex containment implies
 * full containment. Each test point is nudged a hair toward the inner loop's
 * centroid to disambiguate when two loops share a vertex. Mirrors
 * `loopContains` in profile.ts.
 */
function loopContains(inner, outer) {
  if (inner.length === 0 || outer.length < 3) return false;
  let sx = 0, sy = 0;
  for (const p of inner) { sx += p.x; sy += p.y; }
  const cx = sx / inner.length, cy = sy / inner.length;
  for (const p of inner) {
    const test = { x: p.x + (cx - p.x) * 1e-3, y: p.y + (cy - p.y) * 1e-3 };
    if (!pointInPolygon(test, outer)) return false;
  }
  return true;
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
  extractMergedRegions,
};
