import type { SketchState, CircleEntity, ArcEntity } from './types';
import { findPoint, findEntity } from './types';
import { tessellateCircle, tessellateArc, DEFAULT_CHORD_TOLERANCE } from './tessellator';

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

export type ProfileEdge = LineProfileEdge | ArcProfileEdge | CircleProfileEdge;

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
    }
  }
  return out;
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

export function extractClosedLoops(state: SketchState): ProfilesResult {
  const loops: ProfileLoop[] = [];
  const errors: string[] = [];

  // Each non-construction circle is its own component.
  for (const e of state.entities) {
    if (e.kind !== 'circle' || e.construction) continue;
    const center = findPoint(state, e.centerId);
    if (!center) { errors.push(`circle ${e.id}: center point not found`); continue; }
    loops.push([{ kind: 'circle', center: { x: center.x, y: center.y }, radius: e.radius }]);
  }

  // Segment components (lines + arcs): BFS through shared endpoints so a
  // chain like "line → arc → line → arc → …" lands in a single component.
  // Without arcs in the adjacency, a filleted rectangle (4 lines + 4 arcs,
  // no two lines sharing an endpoint) gets split into 4 single-line
  // components that each fail the ≥3-segments check.
  const segments = segmentsOf(state);
  const adj = buildSegmentAdjacency(segments);
  const segById = new Map(segments.map(s => [s.id, s] as const));
  const visited = new Set<string>();
  for (const startSeg of segments) {
    if (visited.has(startSeg.id)) continue;
    const componentIds = new Set<string>([startSeg.id]);
    const componentPointIds = new Set<string>([startSeg.startId, startSeg.endId]);
    const queue: string[] = [startSeg.id];
    while (queue.length > 0) {
      const sid = queue.shift()!;
      const seg = segById.get(sid)!;
      for (const pid of [seg.startId, seg.endId]) {
        for (const adjSid of adj.get(pid) ?? []) {
          if (componentIds.has(adjSid)) continue;
          componentIds.add(adjSid);
          queue.push(adjSid);
          const adjSeg = segById.get(adjSid)!;
          componentPointIds.add(adjSeg.startId);
          componentPointIds.add(adjSeg.endId);
        }
      }
    }
    for (const sid of componentIds) visited.add(sid);
    // Arcs also reference a center point — include it in the sub-state so
    // extractClosedLoop can compute the arc's angles.
    const componentEntityIds = new Set<string>(componentIds);
    for (const id of componentIds) {
      const e = findEntity(state, id);
      if (e?.kind === 'arc') componentPointIds.add(e.centerId);
    }
    const subState: SketchState = {
      entities: state.entities.filter(e =>
        (e.kind === 'point' && componentPointIds.has(e.id)) ||
        componentEntityIds.has(e.id),
      ),
      constraints: [],
    };
    const sub = extractClosedLoop(subState);
    if (sub.loop) loops.push(sub.loop);
    else if (sub.error) errors.push(sub.error);
  }

  return { loops, errors };
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

export function extractRegions(state: SketchState): RegionsResult {
  const { loops, errors } = extractClosedLoops(state);
  // Pre-tessellate each loop once for the containment tests below. Use a
  // coarse chord tolerance — point-in-polygon doesn't need fidelity.
  const tessellated = loops.map(l => tessellateProfileLoop(l, 1.0));
  // Containment matrix: contains[i][j] = "loop i is inside loop j".
  // Use a representative point of loop i (its first vertex is fine — any
  // non-degenerate loop has a vertex strictly on its own boundary; we test
  // a sample point slightly interior by offsetting toward the polygon's
  // centroid, so boundary-on-boundary ambiguity doesn't break the test).
  const insideOf: Set<number>[] = loops.map(() => new Set<number>());
  for (let i = 0; i < loops.length; i++) {
    const sample = interiorSample(tessellated[i]);
    if (!sample) continue;
    for (let j = 0; j < loops.length; j++) {
      if (i === j) continue;
      if (pointInPolygon(sample, tessellated[j])) insideOf[i].add(j);
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

// Pick a sample point strictly inside the polygon. We use the centroid —
// for any non-self-intersecting polygon (which a valid profile loop must
// be) the centroid is in the interior. This avoids the "first vertex sits
// on the boundary" ambiguity of a naive ray-cast self-test.
function interiorSample(poly: Point2[]): Point2 | null {
  if (poly.length < 3) return null;
  let sx = 0, sy = 0;
  for (const p of poly) { sx += p.x; sy += p.y; }
  const centroid = { x: sx / poly.length, y: sy / poly.length };
  if (pointInPolygon(centroid, poly)) return centroid;
  // Centroid fell outside (concave polygon, rare for sketch loops). Fall
  // back to nudging the first vertex toward the centroid by a small
  // fraction — far enough off the boundary to escape the ambiguity.
  const v0 = poly[0];
  return {
    x: v0.x + (centroid.x - v0.x) * 0.01,
    y: v0.y + (centroid.y - v0.y) * 0.01,
  };
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
  if (segments.length < 3) {
    return { loop: null, error: 'closed profile requires at least 3 segments' };
  }
  // Statistics in the error messages stay focused on lines vs arcs so
  // user-facing errors still read naturally for the common rectangle case.
  void lines; void arcs;

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
