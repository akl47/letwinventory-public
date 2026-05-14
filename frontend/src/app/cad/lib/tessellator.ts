import type {
  SketchState, SketchEntity, CircleEntity, ArcEntity, EllipseEntity, EllipticalArcEntity,
  PointEntity,
} from './types';
import { findPoint } from './types';

// ────────────────────────────────────────────────────────────────────────────
// Chord-tolerance tessellator (REQ 562).
//
// Converts curved sketch entities to polylines bounded by a configurable chord
// height ε. Output is consumed by:
//   • the renderer (curve drawing — REQ 563)
//   • profile extraction (so the pure-JS / OCCT extrude kernel sees polygons)
//
// Math: for a circle of radius r approximated by n equal-angle segments, the
// chord height (sagitta) is h = r·(1 − cos(π/n)). Solving for n given ε:
//
//     n = ⌈π / acos(1 − ε/r)⌉
//
// We clamp to a minimum of 3 segments per full circle, and to 1 per arc.
// ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_CHORD_TOLERANCE = 0.05;

export function segmentsForCircle(radius: number, chordTolerance: number): number {
  if (chordTolerance >= radius) return 3;
  const ratio = 1 - chordTolerance / radius;
  // Clamp ratio into the safe acos domain to avoid NaN from FP noise.
  const safe = Math.min(0.999999, Math.max(-1, ratio));
  const n = Math.ceil(Math.PI / Math.acos(safe));
  return Math.max(3, n);
}

export function segmentsForArc(radius: number, sweepAbs: number, chordTolerance: number): number {
  if (sweepAbs <= 0) return 1;
  const perRadian = segmentsForCircle(radius, chordTolerance) / (Math.PI * 2);
  return Math.max(1, Math.ceil(perRadian * sweepAbs));
}

export function tessellateCircle(
  center: { x: number; y: number }, radius: number, chordTolerance: number,
): Array<{ x: number; y: number }> {
  const n = segmentsForCircle(radius, chordTolerance);
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push({ x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) });
  }
  return out;
}

export function tessellateArc(
  center: { x: number; y: number },
  radius: number,
  startAngle: number,
  endAngle: number,
  ccw: boolean,
  chordTolerance: number,
): Array<{ x: number; y: number }> {
  let sweep = endAngle - startAngle;
  if (ccw) {
    while (sweep <= 0) sweep += Math.PI * 2;
  } else {
    while (sweep >= 0) sweep -= Math.PI * 2;
  }
  const sweepAbs = Math.abs(sweep);
  const n = segmentsForArc(radius, sweepAbs, chordTolerance);
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = startAngle + sweep * (i / n);
    out.push({ x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) });
  }
  return out;
}

function angleFromCenter(p: { x: number; y: number }, center: { x: number; y: number }): number {
  return Math.atan2(p.y - center.y, p.x - center.x);
}

function arcFromEntity(state: SketchState, arc: ArcEntity): {
  center: { x: number; y: number }; startAngle: number; endAngle: number;
} | null {
  const c = findPoint(state, arc.centerId);
  const s = findPoint(state, arc.startId);
  const e = findPoint(state, arc.endId);
  if (!c || !s || !e) return null;
  return {
    center: { x: c.x, y: c.y },
    startAngle: angleFromCenter(s, c),
    endAngle: angleFromCenter(e, c),
  };
}

export function tessellateEntity(
  state: SketchState, entity: SketchEntity, chordTolerance: number = DEFAULT_CHORD_TOLERANCE,
): Array<{ x: number; y: number }> {
  switch (entity.kind) {
    case 'point':
    case 'line':
      return [];
    case 'circle': {
      const c = findPoint(state, entity.centerId);
      if (!c) return [];
      return tessellateCircle({ x: c.x, y: c.y }, entity.radius, chordTolerance);
    }
    case 'arc': {
      const arc = arcFromEntity(state, entity);
      if (!arc) return [];
      return tessellateArc(arc.center, entity.radius, arc.startAngle, arc.endAngle, entity.ccw, chordTolerance);
    }
    case 'ellipse':
    case 'ellipticalArc':
    case 'spline':
    case 'conic':
      // Phase B/C: per-entity tessellators land alongside the entity tools.
      return [];
  }
}
