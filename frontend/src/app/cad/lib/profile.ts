import type { SketchState, CircleEntity, ArcEntity } from './types';
import { findPoint, findEntity } from './types';
import { tessellateCircle, tessellateArc, DEFAULT_CHORD_TOLERANCE } from './tessellator';
import { splitAtIntersections, extractArrangementFaces, type HalfEdge } from './arrangement';
import { bezierLoopsFromTextEntity, type TextResolver } from './textGlyphs';

// REQ 617 — typed profile edges. Each edge owns its analytic identity (line /
// arc / circle) so the extrude kernel can produce one face per edge instead of
// one face per tessellated segment. A single circle profile is one edge that
// closes on itself; a polygon is N straight edges in walked order.

export interface Point2 { x: number; y: number; }

export interface LineProfileEdge {
  kind: 'line';
  start: Point2;
  end: Point2;
}

export interface ArcProfileEdge {
  kind: 'arc';
  center: Point2;
  radius: number;
  startAngle: number;
  endAngle: number;
  ccw: boolean;
  // Convenience cache: the parametric endpoints projected to the circle.
  start: Point2;
  end: Point2;
}

export interface CircleProfileEdge {
  kind: 'circle';
  center: Point2;
  radius: number;
}

/** A single Bézier segment. `points` are control points (2 = line, 3 =
 * quadratic, 4 = cubic); the edge runs points[0] → points[last]. Used for
 * text glyph outlines so the kernel builds one smooth face per curve via
 * OCCT `Edge::bezier` instead of N faces per tessellated chord. */
export interface BezierProfileEdge {
  kind: 'bezier';
  points: Point2[];
}

export type ProfileEdge = LineProfileEdge | ArcProfileEdge | CircleProfileEdge | BezierProfileEdge;

export type ProfileLoop = ProfileEdge[];

export interface ProfileResult {
  loop: ProfileLoop | null;
  error?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers — useful for consumers that still want a flat tessellated polyline
// (e.g. profile-loop closure check for canExtrude, or the existing pure-JS
// ear-clipping cap path).
// ────────────────────────────────────────────────────────────────────────────

export function tessellateProfileLoop(
  loop: ProfileLoop, chordTolerance: number = DEFAULT_CHORD_TOLERANCE,
): Point2[] {
  if (loop.length === 1 && loop[0].kind === 'circle') {
    const c = loop[0];
    const pts = tessellateCircle(c.center, c.radius, chordTolerance);
    return pts.slice(0, -1);  // drop closing duplicate
  }
  const out: Point2[] = [];
  for (const e of loop) {
    if (e.kind === 'line') {
      out.push({ x: e.start.x, y: e.start.y });
    } else if (e.kind === 'arc') {
      const pts = tessellateArc(e.center, e.radius, e.startAngle, e.endAngle, e.ccw, chordTolerance);
      // Drop the trailing vertex of each arc — the next edge will repeat it.
      for (let i = 0; i < pts.length - 1; i++) out.push(pts[i]);
    } else if (e.kind === 'circle') {
      // Mixed loop with a 'circle' edge shouldn't happen (a circle is a complete
      // closed loop by itself). Defensive: append tessellation.
      const pts = tessellateCircle(e.center, e.radius, chordTolerance);
      for (let i = 0; i < pts.length - 1; i++) out.push(pts[i]);
    } else if (e.kind === 'bezier') {
      // Sample the Bézier for containment/preview (the analytic edge still
      // goes to the kernel verbatim). Drop the trailing point — the next
      // edge repeats it.
      const pts = sampleBezier(e.points, chordTolerance);
      for (let i = 0; i < pts.length - 1; i++) out.push(pts[i]);
    }
  }
  return out;
}

/** Adaptive sample of a Bézier (2/3/4 control points) into a polyline,
 * including both endpoints. Segment count scales with the control-polygon
 * length against the chord tolerance. */
function sampleBezier(pts: Point2[], chordTolerance: number): Point2[] {
  if (pts.length < 2) return pts.slice();
  if (pts.length === 2) return [pts[0], pts[1]];
  let ctrlLen = 0;
  for (let i = 1; i < pts.length; i++) ctrlLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const segs = Math.max(2, Math.min(48, Math.ceil(ctrlLen / Math.max(1e-6, chordTolerance))));
  const out: Point2[] = [];
  const n = pts.length - 1;  // degree
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    out.push(deCasteljau(pts, t, n));
  }
  return out;
}

function deCasteljau(pts: Point2[], t: number, n: number): Point2 {
  // Copy and reduce. n == degree == pts.length-1.
  let xs = pts.map(p => p.x);
  let ys = pts.map(p => p.y);
  for (let r = 1; r <= n; r++) {
    for (let i = 0; i <= n - r; i++) {
      xs[i] = (1 - t) * xs[i] + t * xs[i + 1];
      ys[i] = (1 - t) * ys[i] + t * ys[i + 1];
    }
  }
  return { x: xs[0], y: ys[0] };
}

/** Lines and arcs share an "edge with two endpoints" structure for profile
 * loop walking. A unified Segment lets the loop extractor walk through
 * filleted corners (line → arc → line → arc → …) where neither line is
 * directly connected to another line. */
interface ProfileSegment {
  id: string;
  kind: 'line' | 'arc';
  startId: string;
  endId: string;
}

function segmentsOf(state: SketchState): ProfileSegment[] {
  const out: ProfileSegment[] = [];
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

function buildSegmentAdjacency(segments: ProfileSegment[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const s of segments) {
    if (!adj.has(s.startId)) adj.set(s.startId, []);
    if (!adj.has(s.endId))   adj.set(s.endId,   []);
    adj.get(s.startId)!.push(s.id);
    adj.get(s.endId)!.push(s.id);
  }
  return adj;
}

// REQ 620 — partition the sketch into independent closed-loop profiles
// (connected components by shared endpoints). Each non-construction circle is
// trivially its own loop; line clusters validate via extractClosedLoop on a
// subset state. Returns every valid loop in stable order so an ExtrudeFeature's
// regionIndices array maps to the same region across regenerations.
export interface ProfilesResult {
  loops: ProfileLoop[];
  errors: string[];
}

export function extractClosedLoops(
  state: SketchState, resolve: TextResolver = s => s,
): ProfilesResult {
  const loops: ProfileLoop[] = [];
  const errors: string[] = [];

  // REQ Batch 6 — Text glyphs contribute closed loops via the Roboto glyph
  // engine (opentype.js). Each character's outline (and any inner counter for
  // O / A / D) is emitted as a chain of analytic Bézier edges, so the kernel
  // builds ONE smooth face per curve (OCCT Edge::bezier) instead of N faces
  // per tessellated chord — keeps the face count low at any text size. Falls
  // through to [] when the font hasn't loaded yet (first frame after page
  // open); subsequent regens pick it up.
  for (const e of state.entities) {
    if (e.kind !== 'text') continue;
    const te = e as import('./types').TextEntity;
    // Single-line (engraving) text is open strokes — no closed region to
    // extrude. Skip it; it renders in the sketch but contributes no profile.
    if (te.font === 'singleLine') continue;
    const bezierLoops = bezierLoopsFromTextEntity(state, te, resolve);
    for (const contour of bezierLoops) {
      if (contour.length < 2) continue;
      const edges: ProfileLoop = contour.map(seg => ({ kind: 'bezier', points: seg.points }));
      loops.push(edges);
    }
  }

  // First: split every non-construction curve at every intersection. This
  // turns "circle + line through it" into "two arcs + three line segments",
  // wiring intersection points into the topology so the arrangement walker
  // can discover the two half-disk regions.
  const split = splitAtIntersections(state);

  // Each non-construction circle that survived splitting (i.e. had no
  // intersections — fewer than 2 crossings = stays a circle) is its own
  // standalone loop. A circle with 2+ intersections has already been
  // converted to arcs that the face walker will pick up below.
  for (const e of split.entities) {
    if (e.kind !== 'circle' || e.construction) continue;
    const center = findPoint(split, e.centerId);
    if (!center) { errors.push(`circle ${e.id}: center point not found`); continue; }
    loops.push([{ kind: 'circle', center: { x: center.x, y: center.y }, radius: e.radius }]);
  }

  // Run the DCEL face walker over the split state. We keep only bounded
  // faces (positive signed area). The unbounded outer face — which is the
  // one that encloses the figure and includes any dangling chains — has
  // negative or zero area and is discarded. A few extra rejections:
  //   - Faces with fewer than 2 edges can't be real regions.
  //   - Faces whose signed area is below an epsilon are collinear or
  //     zero-area artefacts of how dangling segments get folded into the
  //     outer face's traversal.
  const faces = extractArrangementFaces(split);
  const AREA_EPS = 1e-6;
  for (const f of faces) {
    if (f.edges.length < 2) continue;
    if (f.signedArea <= AREA_EPS) continue;
    const loop = faceToProfileLoop(f, split);
    if (loop.length > 0) loops.push(loop);
  }

  // Diagnostic dump for "looks closed but won't extrude". Gated on
  // window.__cadDebug so it's silent in normal use. Turn on in
  // DevTools (`window.__cadDebug = true`), then click Extrude on
  // the failing sketch and the console will explain which case fired:
  //   - per-point degree (1 == open chain, 3+ == branch point)
  //   - face count + each face's signedArea (filtered out if <= 1e-6)
  //   - non-construction line / arc / circle counts
  // Safe to ship — emits nothing unless the flag is set.
  if (typeof globalThis !== 'undefined'
      && (globalThis as { __cadDebug?: boolean }).__cadDebug) {
    const lineCount = state.entities.filter(e => e.kind === 'line' && !e.construction).length;
    const arcCount = state.entities.filter(e => e.kind === 'arc' && !e.construction).length;
    const circleCount = state.entities.filter(e => e.kind === 'circle' && !e.construction).length;
    const constructionCount = state.entities.filter(
      e => e.construction && (e.kind === 'line' || e.kind === 'arc' || e.kind === 'circle'),
    ).length;

    // Per-point degree on the post-split state (the same view the
    // face walker sees). Degree 1 = dangling endpoint = open chain
    // there; degree 3+ = T-intersection. The split state's IDs may
    // include synthetic `arr_pt_N` points injected by intersection.
    const degree = new Map<string, number>();
    for (const e of split.entities) {
      if (e.construction) continue;
      if (e.kind === 'line') {
        degree.set(e.startId, (degree.get(e.startId) ?? 0) + 1);
        degree.set(e.endId, (degree.get(e.endId) ?? 0) + 1);
      } else if (e.kind === 'arc') {
        degree.set(e.startId, (degree.get(e.startId) ?? 0) + 1);
        degree.set(e.endId, (degree.get(e.endId) ?? 0) + 1);
      }
    }
    const dangling: Array<{ id: string; x: number; y: number }> = [];
    const branches: Array<{ id: string; deg: number; x: number; y: number }> = [];
    for (const [id, deg] of degree) {
      if (deg === 2) continue;
      const pt = findPoint(split, id);
      if (!pt) continue;
      if (deg === 1) dangling.push({ id, x: pt.x, y: pt.y });
      else branches.push({ id, deg, x: pt.x, y: pt.y });
    }

    const facesSummary = faces.map(f => ({
      edges: f.edges.length,
      signedArea: f.signedArea,
      kept: f.edges.length >= 2 && f.signedArea > AREA_EPS,
    }));

    const payload = {
      input: { lines: lineCount, arcs: arcCount, circles: circleCount, construction: constructionCount },
      split: { entities: split.entities.length },
      degree: {
        dangling_open_endpoints: dangling,
        branch_points: branches,
      },
      faces: facesSummary,
      loops_returned: loops.length,
      note: dangling.length > 0
        ? 'Open chain: each "dangling" entry is a point with only one incident segment. The visual gap is right there.'
        : branches.length > 0
        ? 'Branch point: a vertex touches 3+ segments. Likely a duplicated/overlapping segment or a T-intersection.'
        : faces.length === 0
        ? 'No faces found — graph has no cycles at all.'
        : facesSummary.every(f => !f.kept)
        ? 'Faces exist but were all filtered out (zero/negative area or <2 edges) — arc geometry may be inconsistent.'
        : 'Faces kept; loops_returned should be > 0.',
    };
    // eslint-disable-next-line no-console
    console.log('[cad-extract] sketch profile diagnostic\n' + JSON.stringify(payload, null, 2));
  }

  return { loops, errors };
}

/** Convert a DCEL face's half-edge boundary into a typed ProfileLoop the
 * extrude kernel expects. Each line half-edge maps to one LineProfileEdge,
 * each arc to one ArcProfileEdge. */
function faceToProfileLoop(face: { edges: HalfEdge[] }, state: SketchState): ProfileLoop {
  const out: ProfileEdge[] = [];
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

/** A planar region in the sketch — one outer loop, optionally with one or
 * more inner loops cut out (holes). For two concentric circles the
 * detector emits two regions: the inner disk (outer=inner-loop, no holes)
 * and the annulus (outer=outer-loop, holes=[inner-loop]). For three
 * nested loops A⊃B⊃C, three regions: innermost disk (C, no holes), middle
 * ring (B, holes=[C]), outer ring (A, holes=[B]). Holes are *direct*
 * children only — grandchildren are already excluded by their own
 * parent's hole. */
export interface ProfileRegion {
  outer: ProfileLoop;
  holes: ProfileLoop[];
}

export interface RegionsResult {
  regions: ProfileRegion[];
  errors: string[];
}

export function extractRegions(
  state: SketchState, resolve: TextResolver = s => s,
): RegionsResult {
  const { loops, errors } = extractClosedLoops(state, resolve);
  // Pre-tessellate each loop once for the containment tests below. Use a
  // coarse chord tolerance — point-in-polygon doesn't need fidelity.
  const tessellated = loops.map(l => tessellateProfileLoop(l, 1.0));
  // Containment matrix: insideOf[i] contains every j such that loop i is
  // strictly inside loop j. Earlier we used a single centroid sample, but
  // for concentric circles every centroid coincides and the sample lands
  // inside every loop. Switching to all-vertices-in-polygon is robust:
  // extractClosedLoops produces non-self-intersecting loops, so if every
  // vertex of i lies inside j, i is contained in j.
  const insideOf: Set<number>[] = loops.map(() => new Set<number>());
  for (let i = 0; i < loops.length; i++) {
    for (let j = 0; j < loops.length; j++) {
      if (i === j) continue;
      if (loopContains(tessellated[i], tessellated[j])) insideOf[i].add(j);
    }
  }
  // Parent of i = the loop j∈insideOf[i] that itself has the most
  // ancestors (i.e. deepest container = direct parent). If insideOf[i] is
  // empty, i is a top-level loop with no parent.
  const parent: (number | null)[] = loops.map((_, i) => {
    let best: number | null = null;
    let bestDepth = -1;
    for (const j of insideOf[i]) {
      const depth = insideOf[j].size;
      if (depth > bestDepth) { best = j; bestDepth = depth; }
    }
    return best;
  });
  // Region for loop i = i's loop as the outer, plus every direct child of
  // i as a hole. Region indices line up with loop indices so an existing
  // ExtrudeFeature.loopIndices array continues to point at the right
  // entries in the non-nested case (where the two are identical).
  const regions: ProfileRegion[] = loops.map((loop, i) => {
    const holes: ProfileLoop[] = [];
    for (let c = 0; c < loops.length; c++) {
      if (parent[c] === i) holes.push(loops[c]);
    }
    return { outer: loop, holes };
  });
  return { regions, errors };
}

// Region indices whose loop is NOT contained inside any other loop — i.e. the
// top-level (outer) profiles. Holes/counters (a letter's inner bowl, an inner
// circle) are contained in a parent and excluded. Used to seed the extrude
// region selection for text so a whole word's letters extrude in one click,
// each with its counter already attached as a hole by extractRegions.
export function topLevelRegionIndices(
  state: SketchState, resolve: TextResolver = s => s,
): number[] {
  const { loops } = extractClosedLoops(state, resolve);
  const tess = loops.map(l => tessellateProfileLoop(l, 1.0));
  const out: number[] = [];
  for (let i = 0; i < loops.length; i++) {
    let contained = false;
    for (let j = 0; j < loops.length; j++) {
      if (i !== j && loopContains(tess[i], tess[j])) { contained = true; break; }
    }
    if (!contained) out.push(i);
  }
  return out;
}

// Point-in-polygon via the standard ray-cast crossings test. Works on the
// tessellated polyline produced by tessellateProfileLoop (vertex list,
// last vertex does NOT repeat the first).
function pointInPolygon(p: Point2, poly: Point2[]): boolean {
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

// True iff every vertex of `inner` lies strictly inside `outer`. Loops
// produced by extractClosedLoops are non-self-intersecting, so a vertex-
// containment majority implies the entire loop is contained — no
// boundary crossings are possible without one vertex falling outside.
// Nudge each test point a hair toward the inner loop's bounding-box
// centre to avoid the ambiguity when two loops share a vertex.
function loopContains(inner: Point2[], outer: Point2[]): boolean {
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

export function extractClosedLoop(state: SketchState): ProfileResult {
  // REQ 560: construction entities are excluded from profile extraction.
  const segments = segmentsOf(state);
  const lines = segments.filter(s => s.kind === 'line');
  const arcs  = segments.filter(s => s.kind === 'arc');
  const circles = state.entities.filter(
    (e): e is CircleEntity => e.kind === 'circle' && !e.construction,
  );

  // REQ 612 / 617: single-circle profile — sketch contains exactly one
  // non-construction circle and no non-construction lines or arcs. Return as a
  // single CircleProfileEdge so the kernel produces a true cylindrical face.
  if (segments.length === 0 && circles.length === 1) {
    const c = circles[0];
    const center = findPoint(state, c.centerId);
    if (!center) return { loop: null, error: `circle ${c.id}: center point not found` };
    return {
      loop: [{ kind: 'circle', center: { x: center.x, y: center.y }, radius: c.radius }],
    };
  }

  if (segments.length === 0) {
    return { loop: null, error: 'sketch has no lines or arcs (empty profile)' };
  }
  // A closed loop needs ≥3 segments when they're all straight (2 lines only
  // ever retrace the same edge — zero area). But 2 segments CLOSE a real region
  // when at least one is curved: a semicircle + its diameter line (D-shape), or
  // two arcs (lens). Only reject < 2, or exactly 2 straight lines.
  if (segments.length < 2 || (segments.length === 2 && arcs.length === 0)) {
    return { loop: null, error: 'closed profile requires at least 3 segments, or 2 with a curved (arc) edge' };
  }
  // Statistics in the error messages stay focused on lines vs arcs so
  // user-facing errors still read naturally for the common rectangle case.
  void lines;

  const adj = buildSegmentAdjacency(segments);
  for (const [pointId, incident] of adj) {
    if (incident.length === 1) {
      return { loop: null, error: `open chain detected at point ${pointId}` };
    }
    if (incident.length > 2) {
      return { loop: null, error: `point ${pointId} touches ${incident.length} edges (must be exactly 2)` };
    }
  }

  const start = segments[0];
  const visited = new Set<string>();
  const pointWalk: string[]   = [start.startId];
  const segmentWalk: string[] = [];
  let prevPoint = start.startId;
  let currentId: string | undefined = start.id;
  const segmentById = new Map(segments.map(s => [s.id, s] as const));
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    segmentWalk.push(currentId);
    const seg = segmentById.get(currentId)!;
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

  // Materialise each walked segment as the matching ProfileEdge kind. Arcs
  // walked in reverse direction (endId → startId) get their CCW flag
  // inverted so the kernel still sees the arc going from `start` to `end`
  // in the same rotational sense.
  const edges: ProfileEdge[] = [];
  for (let i = 0; i < segmentWalk.length; i++) {
    const seg = segmentById.get(segmentWalk[i])!;
    const aId = pointWalk[i];
    const bId = pointWalk[i + 1];
    const a = findPoint(state, aId);
    const b = findPoint(state, bId);
    if (!a || !b) return { loop: null, error: `profile walk hit missing point ${aId} or ${bId}` };
    if (seg.kind === 'line') {
      edges.push({ kind: 'line', start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } });
    } else {
      const arc = findEntity<ArcEntity>(state, seg.id);
      if (!arc || arc.kind !== 'arc') {
        return { loop: null, error: `arc ${seg.id}: entity not found` };
      }
      const center = findPoint(state, arc.centerId);
      if (!center) return { loop: null, error: `arc ${seg.id}: center point not found` };
      const startAngle = Math.atan2(a.y - center.y, a.x - center.x);
      const endAngle   = Math.atan2(b.y - center.y, b.x - center.x);
      // arc.ccw is the rotational sense from arc.startId → arc.endId. When
      // the walker traverses the arc in that same direction the CCW flag
      // applies as-is; when it walks the reverse direction the sense flips.
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
