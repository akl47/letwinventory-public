// Pure orientation math for placing a NEW child part into an assembly (REQ 933).
//
// When a user creates a part in-context and picks its origin, they may also
// rotate/flip the part's axes relative to the assembly's origin axes before it
// is inserted. This module is the pure, dependency-free core of that control so
// it can be unit-tested without Angular/three: accumulate 90° rotations about
// the ASSEMBLY axes, align the part's +Z to a picked face normal, and describe
// the resulting orientation for the dialog.
//
// Quaternion convention matches the rest of the assembly code: [x, y, z, w].

export type Quat = [number, number, number, number];
export type Vec3 = [number, number, number];

export const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

/** Hamilton product a*b (applies b first, then a). */
export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qNorm(q: Quat): Quat {
  const [x, y, z, w] = q;
  const m = Math.hypot(x, y, z, w) || 1;
  return [x / m, y / m, z / m, w / m];
}

/** Rotate vector v by quaternion q (v' = q * v * q⁻¹, expanded). */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z] = q;
  const w = q[3];
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

export function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(angleRad / 2);
  return [(axis[0] / len) * s, (axis[1] / len) * s, (axis[2] / len) * s, Math.cos(angleRad / 2)];
}

const AXIS_VEC: Record<'x' | 'y' | 'z', Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/**
 * Rotate an existing orientation by `deg` about an ASSEMBLY axis (extrinsic /
 * fixed-frame). Pre-multiplying the delta means each successive click rotates
 * about the assembly's own X/Y/Z — not the part's already-rotated axes — which
 * is what a user picking against the visible assembly triad expects. Composing
 * 90° increments about x/y/z reaches all 24 axis-aligned orientations, so a
 * "flip" is just two clicks (180°); a separate mirror control is intentionally
 * omitted (a reflection is not a rigid instance placement).
 */
export function rotateAboutAssemblyAxis(q: Quat, axis: 'x' | 'y' | 'z', deg = 90): Quat {
  const delta = quatFromAxisAngle(AXIS_VEC[axis], (deg * Math.PI) / 180);
  return qNorm(qMul(delta, q));
}

/** Shortest-arc quaternion rotating the part's +Z onto `normal` (assembly frame). */
export function alignZToNormal(normal: Vec3): Quat {
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  if (len < 1e-9) return IDENTITY_QUAT;
  const n: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len];
  const d = n[2]; // dot([0,0,1], n)
  if (d > 1 - 1e-9) return IDENTITY_QUAT;
  if (d < -1 + 1e-9) return [1, 0, 0, 0]; // antiparallel → 180° about X
  // axis = cross([0,0,1], n) = [-n.y, n.x, 0]
  return qNorm([-n[1], n[0], 0, 1 + d]);
}

const ASM_AXES: [string, Vec3][] = [
  ['+X', [1, 0, 0]], ['−X', [-1, 0, 0]],
  ['+Y', [0, 1, 0]], ['−Y', [0, -1, 0]],
  ['+Z', [0, 0, 1]], ['−Z', [0, 0, -1]],
];

function nearestAsmAxis(v: Vec3): string {
  let best = ASM_AXES[0], bestDot = -Infinity;
  for (const a of ASM_AXES) {
    const dd = v[0] * a[1][0] + v[1] * a[1][1] + v[2] * a[1][2];
    if (dd > bestDot) { bestDot = dd; best = a; }
  }
  return best[0];
}

/** Human-readable axis mapping for the dialog, e.g. "+X→+X · +Y→−Z · +Z→+Y". */
export function axisMappingLabel(q: Quat): string {
  const x = nearestAsmAxis(qRotate(q, [1, 0, 0]));
  const y = nearestAsmAxis(qRotate(q, [0, 1, 0]));
  const z = nearestAsmAxis(qRotate(q, [0, 0, 1]));
  return `+X→${x} · +Y→${y} · +Z→${z}`;
}
