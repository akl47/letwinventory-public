import type { SketchState, LineEntity, CircleEntity, ArcEntity } from './types';
import { findPoint, linesOf } from './types';
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

function buildLineAdjacency(lines: LineEntity[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const l of lines) {
    if (!adj.has(l.startId)) adj.set(l.startId, []);
    if (!adj.has(l.endId)) adj.set(l.endId, []);
    adj.get(l.startId)!.push(l.id);
    adj.get(l.endId)!.push(l.id);
  }
  return adj;
}

// REQ 620 — partition the sketch into independent closed-loop profiles
// (connected components by shared endpoints). Each non-construction circle is
// trivially its own loop; line clusters validate via extractClosedLoop on a
// subset state. Returns every valid loop in stable order so an ExtrudeFeature's
// loopIndices array maps to the same loop across regenerations.
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

  // Line components: BFS through shared endpoints.
  const lines = linesOf(state).filter(l => !l.construction);
  const adj = buildLineAdjacency(lines);
  const visitedLines = new Set<string>();
  for (const startLine of lines) {
    if (visitedLines.has(startLine.id)) continue;
    const componentLineIds = new Set<string>([startLine.id]);
    const componentPointIds = new Set<string>([startLine.startId, startLine.endId]);
    const queue: string[] = [startLine.id];
    while (queue.length > 0) {
      const lid = queue.shift()!;
      const line = lines.find(l => l.id === lid)!;
      for (const pid of [line.startId, line.endId]) {
        for (const adjLid of adj.get(pid) ?? []) {
          if (componentLineIds.has(adjLid)) continue;
          componentLineIds.add(adjLid);
          queue.push(adjLid);
          const adjLine = lines.find(l => l.id === adjLid)!;
          componentPointIds.add(adjLine.startId);
          componentPointIds.add(adjLine.endId);
        }
      }
    }
    for (const lid of componentLineIds) visitedLines.add(lid);
    const subLines = lines.filter(l => componentLineIds.has(l.id));
    const subState: SketchState = {
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

export function extractClosedLoop(state: SketchState): ProfileResult {
  // REQ 560: construction entities are excluded from profile extraction.
  const lines = linesOf(state).filter(l => !l.construction);
  const circles = state.entities.filter(
    (e): e is CircleEntity => e.kind === 'circle' && !e.construction,
  );
  const arcs = state.entities.filter(
    (e): e is ArcEntity => e.kind === 'arc' && !e.construction,
  );

  // REQ 612 / 617: single-circle profile — sketch contains exactly one
  // non-construction circle and no non-construction lines or arcs. Return as a
  // single CircleProfileEdge so the kernel produces a true cylindrical face.
  if (lines.length === 0 && arcs.length === 0 && circles.length === 1) {
    const c = circles[0];
    const center = findPoint(state, c.centerId);
    if (!center) return { loop: null, error: `circle ${c.id}: center point not found` };
    return {
      loop: [{ kind: 'circle', center: { x: center.x, y: center.y }, radius: c.radius }],
    };
  }

  if (lines.length === 0) {
    return { loop: null, error: 'sketch has no lines (empty profile)' };
  }
  if (lines.length < 3) {
    return { loop: null, error: 'closed profile requires at least 3 line segments' };
  }

  const adj = buildLineAdjacency(lines);
  for (const [pointId, incident] of adj) {
    if (incident.length === 1) {
      return { loop: null, error: `open chain detected at point ${pointId}` };
    }
    if (incident.length > 2) {
      return { loop: null, error: `point ${pointId} touches ${incident.length} edges (must be exactly 2)` };
    }
  }

  const startLine = lines[0];
  const visitedLines = new Set<string>();
  const walk: string[] = [];
  let prevPoint = startLine.startId;
  walk.push(prevPoint);
  let currentLine: string | undefined = startLine.id;
  while (currentLine && !visitedLines.has(currentLine)) {
    visitedLines.add(currentLine);
    const line = lines.find(l => l.id === currentLine)!;
    const nextPoint = line.startId === prevPoint ? line.endId : line.startId;
    walk.push(nextPoint);
    prevPoint = nextPoint;
    const incident = adj.get(prevPoint) || [];
    currentLine = incident.find(id => id !== currentLine);
  }
  if (walk[0] !== walk[walk.length - 1]) {
    return { loop: null, error: 'profile is not a closed loop' };
  }
  if (visitedLines.size !== lines.length) {
    return { loop: null, error: 'sketch contains multiple disjoint loops' };
  }

  // Materialise as line edges in walked order. walk has length lines.length + 1
  // with walk[0] == walk[last]; emit N edges joining consecutive vertices.
  const edges: ProfileEdge[] = [];
  for (let i = 0; i < walk.length - 1; i++) {
    const a = findPoint(state, walk[i]);
    const b = findPoint(state, walk[i + 1]);
    if (!a || !b) return { loop: null, error: `profile walk hit missing point ${walk[i]} or ${walk[i + 1]}` };
    edges.push({
      kind: 'line',
      start: { x: a.x, y: a.y },
      end: { x: b.x, y: b.y },
    });
  }
  return { loop: edges };
}
