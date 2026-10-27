'use strict';

// Shared rigid-transform math for CAD in-context / cross-part references
// (REQ 771). A Placement is { translate:[x,y,z], quaternion:[x,y,z,w] } and maps a
// local point p to world as  x = rotate(q, p) + t  (same convention as the mate
// solver). `relativePlacement(a, b)` returns B expressed in A's local frame — the
// formula already used inline for lock mates in assemblyMateSolver.js — which is
// exactly the transform that brings a source part's geometry into a dependent
// part's frame for an in-context reference.
//
// NOTE: assemblyMateSolver.js / assemblyRegenService.js carry their own copies of
// the quaternion/vector primitives below; consolidating them onto this module is a
// safe follow-up cleanup (kept separate here to avoid touching the solver mid-feature).

// ── primitives (identical to assemblyMateSolver.js) ──
function qRotate(q, v) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}
function qMul(a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vneg = (a) => [-a[0], -a[1], -a[2]];

const IDENTITY_PLACEMENT = { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] };

// ── placement algebra ──
/** Inverse of a placement: maps a world point back to the placement's local frame. */
function inverseTransform(p) {
  const qi = qConj(p.quaternion);
  return { quaternion: qi, translate: vneg(qRotate(qi, p.translate)) };
}
/** Compose two placements: the result maps p as a(b(p)) (apply b, then a). */
function composePlacements(a, b) {
  return {
    quaternion: qMul(a.quaternion, b.quaternion),
    translate: vadd(a.translate, qRotate(a.quaternion, b.translate)),
  };
}
/** B expressed in A's local frame = inverse(a) ∘ b. */
function relativePlacement(a, b) {
  return {
    quaternion: qMul(qConj(a.quaternion), b.quaternion),
    translate: qRotate(qConj(a.quaternion), vsub(b.translate, a.translate)),
  };
}
/** Map a local point through a placement to its target frame. */
function transformPoint(p, v) {
  return vadd(qRotate(p.quaternion, v), p.translate);
}
/** Map a direction (rotation only — translation-free) through a placement. */
function transformDir(p, v) {
  return qRotate(p.quaternion, v);
}

module.exports = {
  inverseTransform, composePlacements, relativePlacement, transformPoint, transformDir,
  IDENTITY_PLACEMENT,
  // primitives (exported for reuse / consolidation)
  qRotate, qMul, qConj, vadd, vsub, vscale, vneg,
};
