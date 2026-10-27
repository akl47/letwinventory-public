'use strict';

// REQ 883 — closed curve → cubic Bézier conversion for extrude profiles.
// Server-side port of `frontend/src/app/cad/lib/curveBeziers.ts`. Closed
// splines and ellipses become chains of cubic Bézier profile edges so the
// kernel builds one smooth face per curve (OCCT Edge::bezier), exactly like
// text glyph outlines.
//
// ── KEEP IN SYNC WITH frontend/src/app/cad/lib/curveBeziers.ts ──
// Both MUST produce identical control points (same knot-insertion order, same
// kappa, same arithmetic) or the in-browser extrude preview and the committed
// solid diverge. The `cad-profile-curves.test.js` / `profile-curves.spec.ts`
// pair pins the same fixtures on both sides as a drift guard.

/**
 * @typedef {{x:number, y:number}} CurvePoint
 */

/** 4·(√2−1)/3 — the classic 4-segment cubic-Bézier circle constant. */
const KAPPA = 0.5522847498307936;

/**
 * Convert a clamped uniform B-spline to a chain of cubic Bézier segments.
 *
 * v1 scope: degree-3 splines convert EXACTLY via Böhm knot insertion (every
 * interior knot raised to multiplicity 3, then each run of 4 control points
 * stepping by 3 is one cubic span). The sketch tools only ever create
 * degree-3 splines (store.ts addSpline / addSplineByPoints default degree=3),
 * so other degrees return null — no profile — rather than approximating.
 * Deliberate choice: an exact degree elevation/reduction can slot in later
 * without changing callers, and a silent approximation would let the preview
 * and the committed solid drift apart.
 *
 * The knot vector is the clamped uniform form [0×4, 1..m−1, m×4] — the same
 * convention as the sketch tessellator — so the converted Béziers trace the
 * exact curve the sketch renderer draws. A CLOSED spline (first and last
 * control points coincident / same id) therefore yields a closed chain: the
 * clamped curve interpolates both endpoints.
 *
 * @param {CurvePoint[]} controlPoints
 * @param {number} degree
 * @returns {CurvePoint[][] | null} one CurvePoint[4] per span (segment i ends
 *   where i+1 starts), or null when out of v1 scope (degree ≠ 3 or < 4 pts).
 */
function bezierSegsFromSpline(controlPoints, degree) {
  const n = controlPoints.length;
  if (degree !== 3 || n < 4) return null;
  const m = n - 3;  // cubic span count
  let knots = [0, 0, 0, 0];
  for (let i = 1; i < m; i++) knots.push(i);
  knots.push(m, m, m, m);
  let ctrl = controlPoints.map((p) => ({ x: p.x, y: p.y }));
  // Böhm insertion: each interior knot appears once; insert it twice more to
  // reach multiplicity 3 (== degree).
  for (let u = 1; u < m; u++) {
    for (let rep = 0; rep < 2; rep++) {
      const r = insertKnot(knots, ctrl, 3, u);
      knots = r.knots;
      ctrl = r.ctrl;
    }
  }
  // After full insertion ctrl has 3m+1 points; span j is ctrl[3j .. 3j+3].
  const segs = [];
  for (let j = 0; j < m; j++) {
    segs.push([ctrl[3 * j], ctrl[3 * j + 1], ctrl[3 * j + 2], ctrl[3 * j + 3]]);
  }
  return segs;
}

/**
 * One Böhm knot insertion of value `u` into a degree-`p` B-spline.
 * @param {number[]} knots @param {CurvePoint[]} ctrl @param {number} p
 * @param {number} u @returns {{knots:number[], ctrl:CurvePoint[]}}
 */
function insertKnot(knots, ctrl, p, u) {
  // Span k: the largest index with knots[k] <= u < knots[k+1].
  let k = -1;
  for (let i = 0; i < knots.length - 1; i++) {
    if (knots[i] <= u && u < knots[i + 1]) k = i;
  }
  const out = [];
  for (let i = 0; i <= k - p; i++) out.push(ctrl[i]);
  for (let i = k - p + 1; i <= k; i++) {
    const denom = knots[i + p] - knots[i];
    const a = denom > 1e-12 ? (u - knots[i]) / denom : 0;
    out.push({
      x: (1 - a) * ctrl[i - 1].x + a * ctrl[i].x,
      y: (1 - a) * ctrl[i - 1].y + a * ctrl[i].y,
    });
  }
  for (let i = k; i < ctrl.length; i++) out.push(ctrl[i]);
  return {
    knots: [...knots.slice(0, k + 1), u, ...knots.slice(k + 1)],
    ctrl: out,
  };
}

/**
 * Four-quadrant kappa-handle cubic Béziers for a full ellipse, CCW from the
 * major-axis end. Axes are oriented along the major direction (center →
 * majorAxisEnd) and its +90° perpendicular. Max relative radial error of the
 * kappa approximation ≈ 2.7e-4 (the Bézier bulges past the true curve
 * mid-quadrant by ~0.027% of the local radius) — far inside kernel tolerance.
 *
 * @param {CurvePoint} center @param {CurvePoint} majorAxisEnd
 * @param {number} minorRadius
 * @returns {CurvePoint[][] | null} 4 CurvePoint[4] segments forming a closed
 *   chain, or null for degenerate axes.
 */
function bezierSegsFromEllipse(center, majorAxisEnd, minorRadius) {
  const ax = majorAxisEnd.x - center.x;
  const ay = majorAxisEnd.y - center.y;
  const a = Math.hypot(ax, ay);
  if (!(a > 1e-9) || !(minorRadius > 1e-9)) return null;
  const ux = ax / a, uy = ay / a;   // major-axis direction
  const vx = -uy, vy = ux;          // minor-axis direction (+90° CCW)
  const b = minorRadius;
  const k = KAPPA;
  const pt = (mu, mv) => ({
    x: center.x + mu * ux + mv * vx,
    y: center.y + mu * uy + mv * vy,
  });
  return [
    [pt(a, 0), pt(a, k * b), pt(k * a, b), pt(0, b)],
    [pt(0, b), pt(-k * a, b), pt(-a, k * b), pt(-a, 0)],
    [pt(-a, 0), pt(-a, -k * b), pt(-k * a, -b), pt(0, -b)],
    [pt(0, -b), pt(k * a, -b), pt(a, -k * b), pt(a, 0)],
  ];
}

module.exports = {
  KAPPA,
  bezierSegsFromSpline,
  bezierSegsFromEllipse,
};
