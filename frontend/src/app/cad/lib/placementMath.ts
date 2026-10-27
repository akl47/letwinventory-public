// Shared rigid-transform math for CAD in-context / cross-part references (REQ 771).
// Frontend twin of backend/services/cadTransform.js — kept byte-for-byte equivalent
// (a shared golden-vector fixture in the specs proves it). A Placement maps a local
// point p to its target frame as  x = rotate(q, p) + t. `relativePlacement(a, b)`
// returns B expressed in A's local frame (the lock-mate formula), which brings a
// source part's geometry into a dependent part's frame for an in-context reference.
import type { Placement } from './assembly.types';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

// ── primitives (identical to mateSolver.ts / cadTransform.js) ──
function qRotate(q: Quat, v: Vec3): Vec3 {
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
function qMul(a: Quat, b: Quat): Quat {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const vadd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vneg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];

export const IDENTITY_PLACEMENT: Placement = { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] };

/** Inverse of a placement: maps a target-frame point back into the local frame. */
export function inverseTransform(p: Placement): Placement {
  const qi = qConj(p.quaternion as Quat);
  return { quaternion: qi, translate: vneg(qRotate(qi, p.translate as Vec3)) };
}
/** Compose two placements: the result maps p as a(b(p)) (apply b, then a). */
export function composePlacements(a: Placement, b: Placement): Placement {
  return {
    quaternion: qMul(a.quaternion as Quat, b.quaternion as Quat),
    translate: vadd(a.translate as Vec3, qRotate(a.quaternion as Quat, b.translate as Vec3)),
  };
}
/** B expressed in A's local frame = inverse(a) ∘ b. */
export function relativePlacement(a: Placement, b: Placement): Placement {
  return {
    quaternion: qMul(qConj(a.quaternion as Quat), b.quaternion as Quat),
    translate: qRotate(qConj(a.quaternion as Quat), vsub(b.translate as Vec3, a.translate as Vec3)),
  };
}
/** Map a local point through a placement to its target frame. */
export function transformPoint(p: Placement, v: Vec3): Vec3 {
  return vadd(qRotate(p.quaternion as Quat, v), p.translate as Vec3);
}
/** Map a direction (rotation only — translation-free) through a placement. */
export function transformDir(p: Placement, v: Vec3): Vec3 {
  return qRotate(p.quaternion as Quat, v);
}
