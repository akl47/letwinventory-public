// Planar arrangement for sketch profile extraction.
//
// Given a sketch state, `splitAtIntersections` produces a new state where every
// non-construction curve is cut at every intersection with another curve, with
// new point entities introduced at each intersection. `extractArrangementFaces`
// then runs the standard DCEL face-walker over the resulting graph: it builds
// directed half-edges, sorts them by tangent angle at each shared vertex, and
// enumerates faces by always turning left.
//
// This is what lets the region detector see "circle cut by a line" as two
// half-disk regions even when the line's endpoints don't lie on the circle.

import type {
  SketchState, SketchEntity, PointEntity,
  CircleEntity, ArcEntity,
} from './types';
import { findPoint } from './types';
import {
  lineLineIntersection, lineCircleIntersection, circleCircleIntersection,
  angleInArcSweep, type Pt,
} from './geometry';

const EPS = 1e-9;
// Spatial-bucket tolerance used to deduplicate intersection points and to
// recognise a new intersection that happens to coincide with an existing
// endpoint. Tight enough that two numerically distinct intersections stay
// distinct, loose enough that fp drift doesn't fragment what should be a
// single vertex.
const POINT_TOL = 1e-4;

// ───────── Internal curve descriptors used during splitting ─────────────────

interface LineCurve {
  kind: 'line';
  id: string;
  startId: string;
  endId: string;
  a: Pt;
  b: Pt;
}
interface CircleCurve {
  kind: 'circle';
  id: string;
  centerId: string;
  center: Pt;
  radius: number;
}
interface ArcCurve {
  kind: 'arc';
  id: string;
  centerId: string;
  startId: string;
  endId: string;
  center: Pt;
  startPt: Pt;
  endPt: Pt;
  radius: number;
  ccw: boolean;
  startAngle: number;
  endAngle: number;
}
type Curve = LineCurve | CircleCurve | ArcCurve;

interface Hit { pointId: string; param: number; }

// ───────── Public: splitAtIntersections ─────────────────────────────────────

/** Build a new SketchState where every non-construction line / circle / arc
 * is split at every point where another non-construction curve crosses it.
 * Construction entities and points pass through untouched. */
export function splitAtIntersections(state: SketchState): SketchState {
  // Canonicalize point ids first: the sketch editor draws each line with
  // unique fresh endpoint ids and only links them via `coincident`
  // constraints (SW-style — entities own their endpoints, shared positions
  // are enforced by constraints, not by id reuse). The face walker keys
  // adjacency on point id, so a four-line square ends up with 8 vertices
  // of degree 1 instead of 4 vertices of degree 2, and no closed face is
  // found. Merging coincident point ids to a single representative fixes
  // that without touching the rest of the pipeline.
  state = canonicalizePoints(state);
  const curves = gatherCurves(state);

  // Spatial bucket map for point dedup. Seeded with every existing point so
  // an intersection that lands on an existing endpoint reuses that point id
  // rather than introducing a duplicate.
  const KEY_RES = Math.round(1 / POINT_TOL);
  const keyFor = (p: Pt) => `${Math.round(p.x * KEY_RES)}/${Math.round(p.y * KEY_RES)}`;
  const pointMap = new Map<string, string>();
  for (const e of state.entities) {
    if (e.kind === 'point') pointMap.set(keyFor(e), e.id);
  }

  const newPoints: PointEntity[] = [];
  let pointSeq = 1;
  const acquirePoint = (p: Pt): string => {
    const k = keyFor(p);
    const existing = pointMap.get(k);
    if (existing) return existing;
    const id = `arr_pt_${pointSeq++}`;
    pointMap.set(k, id);
    newPoints.push({ kind: 'point', id, x: p.x, y: p.y });
    return id;
  };

  // Per-curve hit list, populated by pairwise intersection below.
  const hits = new Map<string, Hit[]>();
  for (const c of curves) hits.set(c.id, []);

  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const a = curves[i], b = curves[j];
      const pts = intersectCurves(a, b);
      for (const p of pts) {
        if (!isInteriorHit(a, p) || !isInteriorHit(b, p)) continue;
        const pid = acquirePoint(p);
        hits.get(a.id)!.push({ pointId: pid, param: paramOnCurve(a, p) });
        hits.get(b.id)!.push({ pointId: pid, param: paramOnCurve(b, p) });
      }
    }
  }

  // Output: original points + new intersection points + construction entities +
  // split sub-entities (or originals if untouched).
  const out: SketchEntity[] = [];
  for (const e of state.entities) if (e.kind === 'point') out.push(e);
  for (const np of newPoints) out.push(np);
  for (const e of state.entities) {
    if (e.kind === 'point') continue;
    if (e.construction) out.push(e);
  }

  let entSeq = 1;
  const origById = new Map(state.entities.map(e => [e.id, e] as const));

  for (const c of curves) {
    const h = hits.get(c.id)!;
    if (h.length === 0) {
      const orig = origById.get(c.id);
      if (orig) out.push(orig);
      continue;
    }

    if (c.kind === 'line') {
      h.sort((x, y) => x.param - y.param);
      let prev = c.startId;
      for (const hit of h) {
        if (hit.pointId === prev) continue;
        out.push({ kind: 'line', id: `arr_ln_${entSeq++}`, startId: prev, endId: hit.pointId });
        prev = hit.pointId;
      }
      if (prev !== c.endId) {
        out.push({ kind: 'line', id: `arr_ln_${entSeq++}`, startId: prev, endId: c.endId });
      }
    } else if (c.kind === 'circle') {
      const uniqueByPoint = new Map<string, Hit>();
      for (const hit of h) uniqueByPoint.set(hit.pointId, hit);
      const uniq = [...uniqueByPoint.values()].sort((a, b) => a.param - b.param);
      if (uniq.length < 2) {
        const orig = origById.get(c.id);
        if (orig) out.push(orig);
        continue;
      }
      for (let k = 0; k < uniq.length; k++) {
        const aHit = uniq[k];
        const bHit = uniq[(k + 1) % uniq.length];
        out.push({
          kind: 'arc',
          id: `arr_ar_${entSeq++}`,
          centerId: c.centerId,
          startId: aHit.pointId,
          endId: bHit.pointId,
          radius: c.radius,
          ccw: true,
        });
      }
    } else {
      const alongSweep = (angle: number): number => {
        const TAU = Math.PI * 2;
        const norm = (a: number) => { const m = a % TAU; return m < 0 ? m + TAU : m; };
        return c.ccw ? norm(angle - c.startAngle) : norm(c.startAngle - angle);
      };
      const sorted = h
        .filter(hit => hit.pointId !== c.startId && hit.pointId !== c.endId)
        .sort((x, y) => alongSweep(x.param) - alongSweep(y.param));
      const dedup: Hit[] = [];
      for (const hit of sorted) {
        if (dedup.length > 0 && dedup[dedup.length - 1].pointId === hit.pointId) continue;
        dedup.push(hit);
      }
      let prev = c.startId;
      for (const hit of dedup) {
        out.push({
          kind: 'arc',
          id: `arr_ar_${entSeq++}`,
          centerId: c.centerId,
          startId: prev,
          endId: hit.pointId,
          radius: c.radius,
          ccw: c.ccw,
        });
        prev = hit.pointId;
      }
      if (prev !== c.endId) {
        out.push({
          kind: 'arc',
          id: `arr_ar_${entSeq++}`,
          centerId: c.centerId,
          startId: prev,
          endId: c.endId,
          radius: c.radius,
          ccw: c.ccw,
        });
      }
    }
  }

  // Constraints aren't relevant to face extraction — drop them.
  return { entities: out, constraints: [] };
}

/** Merge point ids that the sketch treats as the same vertex. Two sources
 * of equivalence: (1) an explicit `coincident` constraint between two
 * points, (2) two points sitting within `spatialTol` of each other (catches
 * accidental duplicates the user hasn't yet constrained). Returns a new
 * SketchState where every entity's point reference (line.startId/endId,
 * circle.centerId, arc.*Id) is rewritten to the union-find representative,
 * so downstream adjacency keyed on point id correctly sees the chained
 * topology. The original PointEntity records pass through unchanged. */
function canonicalizePoints(state: SketchState, spatialTol: number = 1e-4): SketchState {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let p = parent.get(id) ?? id;
    while (parent.has(p) && parent.get(p) !== p) p = parent.get(p)!;
    parent.set(id, p);
    return p;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  const pointIds = new Set<string>();
  for (const e of state.entities) {
    if (e.kind === 'point') { parent.set(e.id, e.id); pointIds.add(e.id); }
  }

  // (1) Coincident constraints between two points. We only union the
  // point-point form; point-on-line / point-on-curve aren't id-equivalence.
  for (const c of state.constraints) {
    if (c.type !== 'coincident' || c.targets.length !== 2) continue;
    const a = c.targets[0]?.entityId, b = c.targets[1]?.entityId;
    if (a && b && pointIds.has(a) && pointIds.has(b)) union(a, b);
  }

  // (2) Spatial coincidence. Bucket by rounded coordinate; the first
  // point in each bucket wins as the representative and subsequent points
  // union into it.
  const KEY = Math.round(1 / spatialTol);
  const bucketRep = new Map<string, string>();
  for (const e of state.entities) {
    if (e.kind !== 'point') continue;
    const key = `${Math.round(e.x * KEY)}/${Math.round(e.y * KEY)}`;
    const existing = bucketRep.get(key);
    if (existing) union(existing, e.id);
    else bucketRep.set(key, e.id);
  }

  // Fast path: nothing got merged → no rewrite needed.
  let anyMerged = false;
  for (const id of pointIds) {
    if (find(id) !== id) { anyMerged = true; break; }
  }
  if (!anyMerged) return state;

  const rewrite = (id: string): string => pointIds.has(id) ? find(id) : id;
  const rewritten: SketchEntity[] = state.entities.map(e => {
    if (e.kind === 'line') return { ...e, startId: rewrite(e.startId), endId: rewrite(e.endId) };
    if (e.kind === 'circle') return { ...e, centerId: rewrite(e.centerId) };
    if (e.kind === 'arc') return { ...e, centerId: rewrite(e.centerId), startId: rewrite(e.startId), endId: rewrite(e.endId) };
    return e;
  });
  return { entities: rewritten, constraints: state.constraints };
}

function gatherCurves(state: SketchState): Curve[] {
  const out: Curve[] = [];
  for (const e of state.entities) {
    if (e.kind === 'point' || e.construction) continue;
    if (e.kind === 'line') {
      const a = findPoint(state, e.startId);
      const b = findPoint(state, e.endId);
      if (a && b) out.push({ kind: 'line', id: e.id, startId: e.startId, endId: e.endId, a, b });
    } else if (e.kind === 'circle') {
      const ce = findPoint(state, (e as CircleEntity).centerId);
      if (ce) out.push({ kind: 'circle', id: e.id, centerId: (e as CircleEntity).centerId, center: ce, radius: (e as CircleEntity).radius });
    } else if (e.kind === 'arc') {
      const ae = e as ArcEntity;
      const ce = findPoint(state, ae.centerId);
      const sp = findPoint(state, ae.startId);
      const fp = findPoint(state, ae.endId);
      if (ce && sp && fp) {
        out.push({
          kind: 'arc', id: ae.id, centerId: ae.centerId,
          startId: ae.startId, endId: ae.endId,
          center: ce, startPt: sp, endPt: fp,
          radius: ae.radius, ccw: ae.ccw,
          startAngle: Math.atan2(sp.y - ce.y, sp.x - ce.x),
          endAngle: Math.atan2(fp.y - ce.y, fp.x - ce.x),
        });
      }
    }
  }
  return out;
}

function intersectCurves(a: Curve, b: Curve): Pt[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const r = lineLineIntersection(a.a, a.b, b.a, b.b);
    if (!r) return [];
    if (r.t1 > -EPS && r.t1 < 1 + EPS && r.t2 > -EPS && r.t2 < 1 + EPS) return [r.p];
    return [];
  }
  if (a.kind === 'line' && b.kind !== 'line') {
    return lineCircleIntersection(a.a, a.b, b.center, b.radius).filter(p => {
      const dx = a.b.x - a.a.x, dy = a.b.y - a.a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < EPS) return false;
      const t = ((p.x - a.a.x) * dx + (p.y - a.a.y) * dy) / len2;
      if (t < -EPS || t > 1 + EPS) return false;
      if (b.kind === 'arc') {
        const angle = Math.atan2(p.y - b.center.y, p.x - b.center.x);
        return angleInArcSweep(angle, b.startAngle, b.endAngle, b.ccw);
      }
      return true;
    });
  }
  if (a.kind !== 'line' && b.kind === 'line') return intersectCurves(b, a);
  // Two circle-like curves (circle/circle, circle/arc, arc/arc).
  if (a.kind === 'line' || b.kind === 'line') return [];  // exhaustive narrowing for TS
  const ca = a as CircleCurve | ArcCurve;
  const cb = b as CircleCurve | ArcCurve;
  return circleCircleIntersection(ca.center, ca.radius, cb.center, cb.radius).filter(p => {
    if (ca.kind === 'arc') {
      const angle = Math.atan2(p.y - ca.center.y, p.x - ca.center.x);
      if (!angleInArcSweep(angle, ca.startAngle, ca.endAngle, ca.ccw)) return false;
    }
    if (cb.kind === 'arc') {
      const angle = Math.atan2(p.y - cb.center.y, p.x - cb.center.x);
      if (!angleInArcSweep(angle, cb.startAngle, cb.endAngle, cb.ccw)) return false;
    }
    return true;
  });
}

function paramOnCurve(c: Curve, p: Pt): number {
  if (c.kind === 'line') {
    const dx = c.b.x - c.a.x, dy = c.b.y - c.a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) return 0;
    return ((p.x - c.a.x) * dx + (p.y - c.a.y) * dy) / len2;
  }
  return Math.atan2(p.y - c.center.y, p.x - c.center.x);
}

function isInteriorHit(c: Curve, p: Pt): boolean {
  if (c.kind === 'line') {
    const t = paramOnCurve(c, p);
    return t > EPS && t < 1 - EPS;
  }
  if (c.kind === 'circle') {
    return Math.abs(Math.hypot(p.x - c.center.x, p.y - c.center.y) - c.radius) < POINT_TOL * 10;
  }
  const a = paramOnCurve(c, p);
  if (!angleInArcSweep(a, c.startAngle, c.endAngle, c.ccw)) return false;
  if (Math.hypot(p.x - c.startPt.x, p.y - c.startPt.y) < POINT_TOL) return false;
  if (Math.hypot(p.x - c.endPt.x, p.y - c.endPt.y) < POINT_TOL) return false;
  return true;
}

// ───────── Public: DCEL face walker ─────────────────────────────────────────

/** One face of the planar arrangement: an ordered list of directed half-edges
 * around its boundary plus the shoelace signed area (positive for bounded
 * CCW interior faces, negative for the unbounded outer face). */
export interface ArrangementFace {
  edges: HalfEdge[];
  signedArea: number;
}

export interface HalfEdge {
  id: string;
  fromId: string;
  toId: string;
  twinId: string;
  kind: 'line' | 'arc';
  // Line data:
  from?: Pt;
  to?: Pt;
  // Arc data:
  arcCenter?: Pt;
  arcRadius?: number;
  arcCcw?: boolean;
  arcStartAngle?: number;
  arcEndAngle?: number;
  // Tangent direction leaving `fromId`, atan2 result in [-π, π].
  exitAngle: number;
}

/** Build directed half-edges for every non-construction line and arc.
 * Circles are NOT included — an untouched closed circle is a self-loop in
 * graph terms, which DCEL doesn't represent cleanly. Callers (extractClosedLoops)
 * handle standalone circles as their own ProfileLoop. */
export function buildHalfEdges(state: SketchState): HalfEdge[] {
  const edges: HalfEdge[] = [];
  let id = 1;
  for (const e of state.entities) {
    if (e.kind === 'point' || e.construction) continue;
    if (e.kind === 'line') {
      const a = findPoint(state, e.startId);
      const b = findPoint(state, e.endId);
      if (!a || !b) continue;
      const fwd: HalfEdge = {
        id: `he_${id++}`, fromId: e.startId, toId: e.endId,
        twinId: '', kind: 'line', from: a, to: b,
        exitAngle: Math.atan2(b.y - a.y, b.x - a.x),
      };
      const bwd: HalfEdge = {
        id: `he_${id++}`, fromId: e.endId, toId: e.startId,
        twinId: '', kind: 'line', from: b, to: a,
        exitAngle: Math.atan2(a.y - b.y, a.x - b.x),
      };
      fwd.twinId = bwd.id;
      bwd.twinId = fwd.id;
      edges.push(fwd, bwd);
    } else if (e.kind === 'arc') {
      const ae = e as ArcEntity;
      const c = findPoint(state, ae.centerId);
      const a = findPoint(state, ae.startId);
      const b = findPoint(state, ae.endId);
      if (!c || !a || !b) continue;
      const startAngle = Math.atan2(a.y - c.y, a.x - c.x);
      const endAngle = Math.atan2(b.y - c.y, b.x - c.x);
      // Tangent of a CCW arc at angle θ is (-sin θ, cos θ); CW arc is the
      // opposite. The forward half-edge inherits the arc's CCW flag; the
      // backward half-edge traverses the same arc in the opposite rotational
      // sense, so its CCW flag is flipped.
      const fwdTangent = ae.ccw
        ? Math.atan2(Math.cos(startAngle), -Math.sin(startAngle))
        : Math.atan2(-Math.cos(startAngle), Math.sin(startAngle));
      const bwdTangent = ae.ccw
        ? Math.atan2(-Math.cos(endAngle), Math.sin(endAngle))
        : Math.atan2(Math.cos(endAngle), -Math.sin(endAngle));
      const fwd: HalfEdge = {
        id: `he_${id++}`, fromId: ae.startId, toId: ae.endId,
        twinId: '', kind: 'arc',
        arcCenter: c, arcRadius: ae.radius, arcCcw: ae.ccw,
        arcStartAngle: startAngle, arcEndAngle: endAngle,
        exitAngle: fwdTangent,
      };
      const bwd: HalfEdge = {
        id: `he_${id++}`, fromId: ae.endId, toId: ae.startId,
        twinId: '', kind: 'arc',
        arcCenter: c, arcRadius: ae.radius, arcCcw: !ae.ccw,
        arcStartAngle: endAngle, arcEndAngle: startAngle,
        exitAngle: bwdTangent,
      };
      fwd.twinId = bwd.id;
      bwd.twinId = fwd.id;
      edges.push(fwd, bwd);
    }
  }
  return edges;
}

/** Enumerate every face of the planar arrangement built from `state`'s
 * non-construction line+arc edges. Each face's signedArea sign tells you
 * whether it's bounded (positive) or the unbounded outer face (negative). */
export function extractArrangementFaces(state: SketchState): ArrangementFace[] {
  const edges = buildHalfEdges(state);
  if (edges.length === 0) return [];
  const edgeById = new Map(edges.map(e => [e.id, e] as const));

  // Sorted outgoing ring per vertex.
  const outgoing = new Map<string, HalfEdge[]>();
  for (const e of edges) {
    let arr = outgoing.get(e.fromId);
    if (!arr) { arr = []; outgoing.set(e.fromId, arr); }
    arr.push(e);
  }
  for (const arr of outgoing.values()) arr.sort((a, b) => a.exitAngle - b.exitAngle);
  const indexInRing = new Map<string, number>();
  for (const arr of outgoing.values()) arr.forEach((e, i) => indexInRing.set(e.id, i));

  // Standard left-face traversal: at the head of half-edge e, jump to its
  // twin (which originates from the same vertex), then walk back one step
  // CW in that vertex's CCW outgoing ring to find the next face edge.
  // Equivalently: the next edge is the one immediately to the LEFT of the
  // incoming direction at this vertex.
  const nextOf = (e: HalfEdge): HalfEdge => {
    const twin = edgeById.get(e.twinId)!;
    const ring = outgoing.get(twin.fromId)!;
    const idx = indexInRing.get(twin.id)!;
    const N = ring.length;
    return ring[(idx - 1 + N) % N];
  };

  const visited = new Set<string>();
  const faces: ArrangementFace[] = [];
  for (const start of edges) {
    if (visited.has(start.id)) continue;
    const cycle: HalfEdge[] = [];
    let curr: HalfEdge = start;
    // Safety bound: a single face can touch at most every half-edge once.
    let guard = edges.length + 2;
    while (guard-- > 0) {
      if (visited.has(curr.id)) break;
      visited.add(curr.id);
      cycle.push(curr);
      const nxt = nextOf(curr);
      if (nxt.id === start.id) break;
      curr = nxt;
    }
    if (cycle.length === 0) continue;
    faces.push({ edges: cycle, signedArea: computeSignedArea(cycle) });
  }
  return faces;
}

/** Approximate signed area of the polygon obtained by tessellating each
 * boundary edge. Sign is what the caller uses to distinguish bounded
 * (positive) from unbounded (negative) faces. Arc bulges are sampled
 * densely enough that a face whose true area is positive doesn't flip
 * sign due to chord undersampling. */
function computeSignedArea(edges: HalfEdge[]): number {
  const pts: Pt[] = [];
  const TAU = Math.PI * 2;
  const norm = (a: number) => { const m = a % TAU; return m < 0 ? m + TAU : m; };
  for (const e of edges) {
    if (e.kind === 'line' && e.from) {
      pts.push(e.from);
    } else if (e.kind === 'arc' && e.arcCenter && e.arcRadius !== undefined
               && e.arcStartAngle !== undefined && e.arcEndAngle !== undefined
               && e.arcCcw !== undefined) {
      const N = 24;
      const sweep = e.arcCcw
        ? norm(e.arcEndAngle - e.arcStartAngle)
        : -norm(e.arcStartAngle - e.arcEndAngle);
      for (let i = 0; i < N; i++) {
        const t = i / N;
        const angle = e.arcStartAngle + sweep * t;
        pts.push({
          x: e.arcCenter.x + e.arcRadius * Math.cos(angle),
          y: e.arcCenter.y + e.arcRadius * Math.sin(angle),
        });
      }
    }
  }
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return area / 2;
}
