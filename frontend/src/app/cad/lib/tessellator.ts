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
  // Upper cap so a very small (zoom-adaptive) tolerance on a large radius
  // can't request thousands of segments. 512 is visually smooth at any zoom.
  return Math.max(3, Math.min(512, n));
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

export function tessellateEllipse(
  center: { x: number; y: number },
  majorAxisEnd: { x: number; y: number },
  minorRadius: number,
  chordTolerance: number,
): Array<{ x: number; y: number }> {
  const majorRadius = Math.hypot(majorAxisEnd.x - center.x, majorAxisEnd.y - center.y);
  if (majorRadius < 1e-9) return [];
  // Number of segments — use the larger of the two radii to satisfy chord
  // tolerance everywhere on the curve. An ellipse has higher curvature near
  // its major-axis endpoints, so under-segmenting using the minor radius
  // would produce visible kinks at the ends.
  const n = segmentsForCircle(Math.max(majorRadius, minorRadius), chordTolerance);
  // Major-axis direction in world frame; perpendicular direction is rotate-90.
  const ux = (majorAxisEnd.x - center.x) / majorRadius;
  const uy = (majorAxisEnd.y - center.y) / majorRadius;
  const vx = -uy, vy = ux;
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const a = majorRadius * Math.cos(t);
    const b = minorRadius * Math.sin(t);
    out.push({ x: center.x + ux * a + vx * b, y: center.y + uy * a + vy * b });
  }
  return out;
}

export function tessellateEllipticalArc(
  center: { x: number; y: number },
  majorAxisEnd: { x: number; y: number },
  minorRadius: number,
  startAngle: number,
  endAngle: number,
  ccw: boolean,
  chordTolerance: number,
): Array<{ x: number; y: number }> {
  const majorRadius = Math.hypot(majorAxisEnd.x - center.x, majorAxisEnd.y - center.y);
  if (majorRadius < 1e-9) return [];
  // Sweep in the ellipse's parametric frame, applying the same CCW/CW
  // normalisation as a circular arc so start→end traces the intended side.
  let sweep = endAngle - startAngle;
  if (ccw) {
    while (sweep <= 0) sweep += Math.PI * 2;
  } else {
    while (sweep >= 0) sweep -= Math.PI * 2;
  }
  // Segment count from the larger radius and the swept fraction of a full
  // ellipse — high curvature near the major-axis ends needs the major radius.
  const full = segmentsForCircle(Math.max(majorRadius, minorRadius), chordTolerance);
  const n = Math.max(1, Math.ceil(full * (Math.abs(sweep) / (Math.PI * 2))));
  const ux = (majorAxisEnd.x - center.x) / majorRadius;
  const uy = (majorAxisEnd.y - center.y) / majorRadius;
  const vx = -uy, vy = ux;
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = startAngle + sweep * (i / n);
    const a = majorRadius * Math.cos(t);
    const b = minorRadius * Math.sin(t);
    out.push({ x: center.x + ux * a + vx * b, y: center.y + uy * a + vy * b });
  }
  return out;
}

/**
 * Open uniform clamped B-spline sampler via De Boor's algorithm.
 *
 * Knot vector is uniform-clamped: degree+1 zeros, then 1..(n-degree) for
 * the interior, then degree+1 of the final value. This is the canonical
 * "passes through the first and last control points" form used by every
 * sketch CAD package.
 *
 * Sampling: walk the parametric domain [degree, controlPoints-1] in equal
 * steps. Number of steps scales with the bounding-box diagonal of the
 * control polygon — coarse and conservative but adequate for chord
 * tolerance, since the spline lies within the convex hull of its controls.
 */
export function tessellateSpline(
  controlPoints: Array<{ x: number; y: number }>,
  degree: number,
  chordTolerance: number,
): Array<{ x: number; y: number }> {
  const m = controlPoints.length;
  if (m < degree + 1) return [];
  const knots: number[] = [];
  // Clamped knot vector.
  for (let i = 0; i <= degree; i++) knots.push(0);
  for (let i = 1; i <= m - degree - 1; i++) knots.push(i);
  for (let i = 0; i <= degree; i++) knots.push(m - degree);

  // Rough estimate of sample density: chord-polygon length / tolerance,
  // clamped to [n, 200·n] so we don't allocate insanely for huge sketches.
  let polyLen = 0;
  for (let i = 1; i < m; i++) {
    polyLen += Math.hypot(controlPoints[i].x - controlPoints[i - 1].x, controlPoints[i].y - controlPoints[i - 1].y);
  }
  const targetSamples = Math.max(m * 4, Math.ceil(polyLen / Math.max(chordTolerance, 1e-3)));
  const samples = Math.min(targetSamples, m * 200);

  const out: Array<{ x: number; y: number }> = [];
  const uMin = knots[degree];
  const uMax = knots[knots.length - degree - 1];
  for (let i = 0; i <= samples; i++) {
    const u = uMin + ((uMax - uMin) * i) / samples;
    out.push(deBoor(controlPoints, knots, degree, u));
  }
  return out;
}

function deBoor(
  pts: Array<{ x: number; y: number }>,
  knots: number[],
  p: number,
  u: number,
): { x: number; y: number } {
  // Find the knot span k such that knots[k] <= u < knots[k+1].
  let k = p;
  for (; k < knots.length - p - 1; k++) {
    if (u < knots[k + 1]) break;
  }
  // Working coefficients d[j] = pts[k - p + j] for j in 0..p.
  const d: Array<{ x: number; y: number }> = [];
  for (let j = 0; j <= p; j++) {
    const idx = Math.min(Math.max(k - p + j, 0), pts.length - 1);
    d.push({ x: pts[idx].x, y: pts[idx].y });
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const denom = knots[j + 1 + k - r] - knots[j + k - p];
      const alpha = denom < 1e-12 ? 0 : (u - knots[j + k - p]) / denom;
      d[j] = {
        x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
        y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
      };
    }
  }
  return d[p];
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
    case 'ellipse': {
      const c = findPoint(state, entity.centerId);
      const m = findPoint(state, entity.majorAxisEndId);
      if (!c || !m) return [];
      return tessellateEllipse({ x: c.x, y: c.y }, { x: m.x, y: m.y }, entity.minorRadius, chordTolerance);
    }
    case 'spline': {
      const pts = entity.controlPointIds.map(id => findPoint(state, id)).filter((p): p is PointEntity => !!p);
      if (pts.length < entity.degree + 1) return [];
      return tessellateSpline(pts.map(p => ({ x: p.x, y: p.y })), entity.degree, chordTolerance);
    }
    case 'ellipticalArc': {
      const c = findPoint(state, entity.centerId);
      const m = findPoint(state, entity.majorAxisEndId);
      if (!c || !m) return [];
      return tessellateEllipticalArc(
        { x: c.x, y: c.y }, { x: m.x, y: m.y }, entity.minorRadius,
        entity.startAngle, entity.endAngle, entity.ccw, chordTolerance,
      );
    }
    case 'conic': {
      if (entity.conicType !== 'parabola') return [];
      return tessellateParabola(state, entity, chordTolerance);
    }
    case 'equation': {
      return tessellateEquationCurve(entity.xExpr, entity.yExpr, entity.tMin, entity.tMax, entity.samples);
    }
    case 'text':
    case 'picture':
    case 'intersection':
    case 'splineOnSurface':
      // Reference-only entities — drawn directly by the renderer
      // (raster picture, vector glyphs, 3D overlay). No polyline
      // contribution to profile extraction.
      return [];
  }
}

/** REQ 597 — Parabola tessellation. The parabola is defined by
 * three points: vertex V, focus F, and a sample point S on the
 * curve. The axis runs from V toward F; the curve opens in that
 * direction with focal distance p = |VF|. In local coords aligned
 * to the axis, the parabola is y = x²/(4p). We tessellate from
 * −s..+s where s = the sample point's local-x coord, sampled
 * uniformly in x. */
function tessellateParabola(
  state: SketchState, entity: import('./types').ConicEntity, chordTolerance: number,
): Array<{ x: number; y: number }> {
  if (entity.pointIds.length < 3) return [];
  const v = findPoint(state, entity.pointIds[0]);
  const f = findPoint(state, entity.pointIds[1]);
  const s = findPoint(state, entity.pointIds[2]);
  if (!v || !f || !s) return [];
  const ax = f.x - v.x, ay = f.y - v.y;
  const p = Math.hypot(ax, ay);
  if (p < 1e-9) return [];
  const ux = ax / p, uy = ay / p;       // axis unit vector
  const nx = -uy, ny = ux;              // perpendicular (axis × ẑ)
  // Sample point in local frame.
  const dx = s.x - v.x, dy = s.y - v.y;
  const sLocalY = dx * ux + dy * uy;    // along axis
  const sLocalX = dx * nx + dy * ny;    // perp from axis
  if (!Number.isFinite(sLocalX) || Math.abs(sLocalX) < 1e-9) return [];
  const halfWidth = Math.abs(sLocalX);
  // Adaptive sample count: more samples for higher curvature.
  // For y=x²/4p, the curvature is max at the vertex with radius
  // 2p. Use the circle-segment heuristic on that curvature.
  const segs = Math.max(16, segmentsForCircle(Math.max(1, 2 * p), chordTolerance));
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * 2 - 1;       // −1 .. +1
    const lx = t * halfWidth;
    const ly = (lx * lx) / (4 * p);
    out.push({ x: v.x + nx * lx + ux * ly, y: v.y + ny * lx + uy * ly });
  }
  return out;
}

/** REQ — Equation curve tessellation. Compiles `x(t)` and `y(t)`
 * once per call via the Function constructor; evaluates at N samples
 * and pushes valid (finite) points into the polyline. Skips any
 * (t) value that throws or yields a non-finite result so the rest
 * of the curve still renders. */
export function tessellateEquationCurve(
  xExpr: string, yExpr: string, tMin: number, tMax: number, samples: number,
): Array<{ x: number; y: number }> {
  const n = Math.max(8, Math.min(2000, Math.floor(samples)));
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin === tMax) return [];
  // Trusted code path — expressions come from the user's own
  // sketch document, no remote / network input. Function ctor is
  // appropriate here; we still try/catch in case the user types
  // a bad expression.
  let fx: (t: number) => number;
  let fy: (t: number) => number;
  try {
    fx = new Function('t', `with (Math) { return (${xExpr}); }`) as (t: number) => number;
    fy = new Function('t', `with (Math) { return (${yExpr}); }`) as (t: number) => number;
  } catch { return []; }
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = tMin + (i / n) * (tMax - tMin);
    let x: number, y: number;
    try { x = fx(t); y = fy(t); } catch { continue; }
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x, y });
  }
  return out;
}
