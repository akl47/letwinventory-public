// 3D assembly mate solver (REQ 748).
//
// Positions rigid component instances by solving geometric mate constraints.
// Each non-grounded instance has six DOF (3 translation + 3 rotation). We solve
// with Levenberg–Marquardt least-squares over a global twist increment vector;
// the Jacobian is numerically differentiated (analytic Jacobians are a perf
// follow-up — numeric is robust and simple enough for the assembly sizes here).
//
// This module is intentionally framework-free (no THREE, no Angular) so the same
// algorithm runs in the browser for interactive drag and Node-side for the
// authoritative re-solve during regen. All math lives here.
//
// Parameterization: each free instance carries a pose (quaternion q, translate t).
// World point of a local point p is  x = rotate(q, p) + t. The optimization
// variables are per-instance local twists δ = (δω, δt) ∈ R⁶ applied as
//   q ← q ⊗ quatFromRotVec(δω)   (body-frame rotation, well-conditioned)
//   t ← t + δt                   (world-frame translation)
// Residuals are evaluated from the current pose; LM iterates δ to drive them to 0.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

// ---------------------------------------------------------------------------
// Vector / quaternion helpers
// ---------------------------------------------------------------------------

const vadd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vscale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vlen = (a: Vec3): number => Math.sqrt(vdot(a, a));
function vnorm(a: Vec3): Vec3 {
  const l = vlen(a);
  return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

const IDENTITY_Q: Quat = [0, 0, 0, 1];

function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function qNorm(q: Quat): Quat {
  const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return l < 1e-12 ? IDENTITY_Q : [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

// Rotate a vector by a (unit) quaternion: v' = q * v * q⁻¹.
function qRotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

// Quaternion from a rotation vector (axis * angle).
function quatFromRotVec(r: Vec3): Quat {
  const angle = vlen(r);
  if (angle < 1e-12) return IDENTITY_Q;
  const s = Math.sin(angle / 2) / angle;
  return qNorm([r[0] * s, r[1] * s, r[2] * s, Math.cos(angle / 2)]);
}

// Rotation vector (so(3) log) of a unit quaternion.
function rotVecOfQuat(q: Quat): Vec3 {
  const qn = qNorm(q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q); // shortest arc
  const v: Vec3 = [qn[0], qn[1], qn[2]];
  const s = vlen(v);
  if (s < 1e-12) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, qn[3]);
  return vscale(v, angle / s);
}

const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A mate-able geometric feature expressed in an instance's LOCAL frame. */
export type MateGeom =
  | { kind: 'plane'; origin: Vec3; normal: Vec3 }
  | { kind: 'axis'; origin: Vec3; direction: Vec3; radius?: number };

export interface SolverInstance {
  id: string;
  grounded?: boolean;
  translate: Vec3;
  quaternion: Quat;
}

export type MateType =
  | 'coincident'
  | 'concentric'
  | 'parallel'
  | 'perpendicular'
  | 'distance'
  | 'angle'
  | 'tangent'
  | 'lock';

export interface MateRef {
  instanceId: string;
  geom: MateGeom;
}

export interface Mate {
  id: string;
  type: MateType;
  a: MateRef;
  b: MateRef;
  /** distance (mm) or angle (radians) for parameterized mates. */
  value?: number;
  /** flip the alignment sense (e.g. normals parallel instead of anti-parallel). */
  flip?: boolean;
  suppressed?: boolean;
}

export interface Pose {
  translate: Vec3;
  quaternion: Quat;
}

export type ConstraintState = 'under' | 'fully' | 'over';

export interface SolveResult {
  poses: Record<string, Pose>;
  converged: boolean;
  residualNorm: number;
  /** remaining free degrees of freedom (0 = fully constrained). */
  dof: number;
  state: ConstraintState;
  iterations: number;
}

export interface SolveOptions {
  maxIterations?: number;
  tolerance?: number;
}

// ---------------------------------------------------------------------------
// Residuals
// ---------------------------------------------------------------------------

interface WorldPlane { origin: Vec3; normal: Vec3; }
interface WorldAxis { origin: Vec3; direction: Vec3; radius: number; }

function worldPlane(pose: Pose, g: MateGeom): WorldPlane {
  if (g.kind !== 'plane') throw new Error('expected plane geometry for this mate');
  return {
    origin: vadd(qRotate(pose.quaternion, g.origin), pose.translate),
    normal: vnorm(qRotate(pose.quaternion, g.normal)),
  };
}

function worldAxis(pose: Pose, g: MateGeom): WorldAxis {
  if (g.kind !== 'axis') throw new Error('expected axis geometry for this mate');
  return {
    origin: vadd(qRotate(pose.quaternion, g.origin), pose.translate),
    direction: vnorm(qRotate(pose.quaternion, g.direction)),
    radius: g.radius ?? 0,
  };
}

// Component of (b - a) perpendicular to unit direction d.
function perpComponent(delta: Vec3, d: Vec3): Vec3 {
  return vsub(delta, vscale(d, vdot(delta, d)));
}

/** Residual vector for one mate given the current world poses of its two refs. */
function mateResiduals(mate: Mate, poseA: Pose, poseB: Pose): number[] {
  switch (mate.type) {
    case 'coincident': {
      const pa = worldPlane(poseA, mate.a.geom);
      const pb = worldPlane(poseB, mate.b.geom);
      // Anti-parallel normals (parallel if flipped) + zero plane separation.
      const orient = mate.flip ? vsub(pa.normal, pb.normal) : vadd(pa.normal, pb.normal);
      const sep = vdot(pa.normal, vsub(pb.origin, pa.origin));
      return [orient[0], orient[1], orient[2], sep];
    }
    case 'distance': {
      const pa = worldPlane(poseA, mate.a.geom);
      const pb = worldPlane(poseB, mate.b.geom);
      const orient = mate.flip ? vsub(pa.normal, pb.normal) : vadd(pa.normal, pb.normal);
      const sep = vdot(pa.normal, vsub(pb.origin, pa.origin)) - (mate.value ?? 0);
      return [orient[0], orient[1], orient[2], sep];
    }
    case 'parallel': {
      const pa = worldPlane(poseA, mate.a.geom);
      const pb = worldPlane(poseB, mate.b.geom);
      return vcross(pa.normal, pb.normal);
    }
    case 'perpendicular': {
      const pa = worldPlane(poseA, mate.a.geom);
      const pb = worldPlane(poseB, mate.b.geom);
      return [vdot(pa.normal, pb.normal)];
    }
    case 'angle': {
      const pa = worldPlane(poseA, mate.a.geom);
      const pb = worldPlane(poseB, mate.b.geom);
      return [vdot(pa.normal, pb.normal) - Math.cos(mate.value ?? 0)];
    }
    case 'concentric': {
      const aa = worldAxis(poseA, mate.a.geom);
      const ab = worldAxis(poseB, mate.b.geom);
      // Axes parallel + axis lines coincident (perp component of origin delta = 0).
      const par = vcross(aa.direction, ab.direction);
      const off = perpComponent(vsub(ab.origin, aa.origin), aa.direction);
      return [par[0], par[1], par[2], off[0], off[1], off[2]];
    }
    case 'tangent': {
      // Cylinder axis (a) tangent to plane (b): axis parallel to plane and the
      // perpendicular distance from the axis to the plane equals the radius.
      const ax = worldAxis(poseA, mate.a.geom);
      const pl = worldPlane(poseB, mate.b.geom);
      const parallelToPlane = vdot(ax.direction, pl.normal);
      const signedDist = vdot(pl.normal, vsub(ax.origin, pl.origin));
      const wantedDist = mate.flip ? -ax.radius : ax.radius;
      return [parallelToPlane, signedDist - wantedDist];
    }
    case 'lock': {
      // Hold the relative pose of B w.r.t. A at its value captured at solve start
      // (see captureLockTargets). Residual = rotation error (3) + translation
      // error (3) of B expressed in A's frame.
      const target = lockTargets.get(mate.id);
      if (!target) return [0, 0, 0, 0, 0, 0];
      const relQ = qMul(qConj(poseA.quaternion), poseB.quaternion);
      const rotErr = rotVecOfQuat(qMul(relQ, qConj(target.relQ)));
      const relT = qRotate(qConj(poseA.quaternion), vsub(poseB.translate, poseA.translate));
      const transErr = vsub(relT, target.relT);
      return [rotErr[0], rotErr[1], rotErr[2], transErr[0], transErr[1], transErr[2]];
    }
    default:
      return [];
  }
}

// Lock mates need the initial relative pose; captured per solve() call.
const lockTargets = new Map<string, { relQ: Quat; relT: Vec3 }>();

// ---------------------------------------------------------------------------
// Linear algebra (small dense systems)
// ---------------------------------------------------------------------------

// Solve (A + λI) x = b for symmetric A (n×n), in place tolerant of singularity.
function solveDamped(A: number[][], b: number[], lambda: number): number[] {
  const n = b.length;
  const M = A.map((row, i) => row.map((v, j) => (i === j ? v + lambda : v)));
  const x = b.slice();
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) continue; // singular column — leave x unchanged
    if (piv !== col) { [M[piv], M[col]] = [M[col], M[piv]]; [x[piv], x[col]] = [x[col], x[piv]]; }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c < n; c++) M[r][c] -= f * M[col][c];
      x[r] -= f * x[col];
    }
  }
  for (let i = 0; i < n; i++) {
    if (Math.abs(M[i][i]) < 1e-14) { x[i] = 0; continue; }
    x[i] /= M[i][i];
  }
  return x;
}

// Numerical rank of a symmetric n×n matrix via Gaussian elimination pivot count.
function symmetricRank(A: number[][], tol: number): number {
  const n = A.length;
  if (n === 0) return 0;
  const M = A.map(row => row.slice());
  let rank = 0;
  const usedRows = new Set<number>();
  for (let col = 0; col < n; col++) {
    let piv = -1; let best = tol;
    for (let r = 0; r < n; r++) {
      if (usedRows.has(r)) continue;
      if (Math.abs(M[r][col]) > best) { best = Math.abs(M[r][col]); piv = r; }
    }
    if (piv < 0) continue;
    usedRows.add(piv);
    rank++;
    for (let r = 0; r < n; r++) {
      if (r === piv || usedRows.has(r)) continue;
      const f = M[r][col] / M[piv][col];
      for (let c = col; c < n; c++) M[r][c] -= f * M[piv][c];
    }
  }
  return rank;
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

const norm2 = (v: number[]): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

/**
 * Solve a set of mates over the given instances. Grounded instances stay fixed;
 * non-grounded instances are repositioned. Returns the solved poses plus
 * convergence and constraint-state diagnostics.
 */
export function solveMates(
  instances: SolverInstance[],
  mates: Mate[],
  opts: SolveOptions = {},
): SolveResult {
  const maxIterations = opts.maxIterations ?? 80;
  const tolerance = opts.tolerance ?? 1e-7;

  const poses: Record<string, Pose> = {};
  for (const inst of instances) {
    poses[inst.id] = { translate: inst.translate.slice() as Vec3, quaternion: qNorm(inst.quaternion) };
  }

  const active = mates.filter(m => !m.suppressed);

  // Capture lock targets from the initial poses.
  lockTargets.clear();
  for (const m of active) {
    if (m.type !== 'lock') continue;
    const pa = poses[m.a.instanceId]; const pb = poses[m.b.instanceId];
    if (!pa || !pb) continue;
    lockTargets.set(m.id, {
      relQ: qMul(qConj(pa.quaternion), pb.quaternion),
      relT: qRotate(qConj(pa.quaternion), vsub(pb.translate, pa.translate)),
    });
  }

  // Free instances → DOF block index.
  const freeIds = instances.filter(i => !i.grounded).map(i => i.id);
  const dofIndex = new Map<string, number>();
  freeIds.forEach((id, k) => dofIndex.set(id, k * 6));
  const nDof = freeIds.length * 6;

  const residuals = (p: Record<string, Pose>): number[] => {
    const out: number[] = [];
    for (const m of active) {
      const pa = p[m.a.instanceId]; const pb = p[m.b.instanceId];
      if (!pa || !pb) continue;
      out.push(...mateResiduals(m, pa, pb));
    }
    return out;
  };

  // Apply a global twist increment δ (length nDof) to a copy of the poses.
  const applyDelta = (base: Record<string, Pose>, delta: number[]): Record<string, Pose> => {
    const next: Record<string, Pose> = {};
    for (const id of Object.keys(base)) {
      const off = dofIndex.get(id);
      if (off === undefined) { next[id] = base[id]; continue; }
      const dw: Vec3 = [delta[off], delta[off + 1], delta[off + 2]];
      const dt: Vec3 = [delta[off + 3], delta[off + 4], delta[off + 5]];
      next[id] = {
        quaternion: qNorm(qMul(base[id].quaternion, quatFromRotVec(dw))),
        translate: vadd(base[id].translate, dt),
      };
    }
    return next;
  };

  let r0 = residuals(poses);
  let lambda = 1e-3;
  let iterations = 0;
  let lastJtJ: number[][] = [];

  if (nDof > 0 && r0.length > 0) {
    for (let iter = 0; iter < maxIterations; iter++) {
      iterations = iter + 1;
      const m = r0.length;
      // Numerical Jacobian J (m × nDof) via forward differences of twist columns.
      const eps = 1e-6;
      const J: number[][] = Array.from({ length: m }, () => new Array(nDof).fill(0));
      for (let j = 0; j < nDof; j++) {
        const delta = new Array(nDof).fill(0); delta[j] = eps;
        const rPert = residuals(applyDelta(poses, delta));
        for (let i = 0; i < m; i++) J[i][j] = (rPert[i] - r0[i]) / eps;
      }
      // JtJ (nDof × nDof) and Jtr (nDof).
      const JtJ: number[][] = Array.from({ length: nDof }, () => new Array(nDof).fill(0));
      const Jtr: number[] = new Array(nDof).fill(0);
      for (let a = 0; a < nDof; a++) {
        for (let b = a; b < nDof; b++) {
          let s = 0; for (let i = 0; i < m; i++) s += J[i][a] * J[i][b];
          JtJ[a][b] = s; JtJ[b][a] = s;
        }
        let s = 0; for (let i = 0; i < m; i++) s += J[i][a] * r0[i];
        Jtr[a] = s;
      }
      lastJtJ = JtJ;

      const cost0 = norm2(r0);
      // LM step with adaptive damping.
      let accepted = false;
      for (let tries = 0; tries < 8; tries++) {
        const step = solveDamped(JtJ, Jtr.map(v => -v), lambda);
        const trial = applyDelta(poses, step);
        const rTrial = residuals(trial);
        if (norm2(rTrial) < cost0) {
          for (const id of Object.keys(trial)) poses[id] = trial[id];
          r0 = rTrial;
          lambda = Math.max(lambda * 0.5, 1e-12);
          accepted = true;
          if (norm2(step) < tolerance) { iter = maxIterations; }
          break;
        }
        lambda *= 4;
      }
      if (!accepted) break; // damping blew up — converged or stuck
      if (cost0 < tolerance) break;
    }
  }

  const residualNorm = norm2(r0);
  const converged = residualNorm < Math.max(tolerance * 10, 1e-5);

  // Constraint state: rank of JtJ gives the number of constrained DOF.
  const rank = nDof > 0 ? symmetricRank(lastJtJ.length ? lastJtJ : buildJtJ(residuals, poses, applyDelta, nDof), 1e-6) : 0;
  const dof = Math.max(0, nDof - rank);
  let state: ConstraintState;
  if (!converged) state = 'over';
  else if (dof > 0) state = 'under';
  else state = 'fully';

  lockTargets.clear();
  return { poses, converged, residualNorm, dof, state, iterations };
}

// Build JtJ once (used for rank when the solve loop didn't run, e.g. already-solved input).
function buildJtJ(
  residuals: (p: Record<string, Pose>) => number[],
  poses: Record<string, Pose>,
  applyDelta: (base: Record<string, Pose>, delta: number[]) => Record<string, Pose>,
  nDof: number,
): number[][] {
  const r0 = residuals(poses);
  const m = r0.length;
  const eps = 1e-6;
  const J: number[][] = Array.from({ length: m }, () => new Array(nDof).fill(0));
  for (let j = 0; j < nDof; j++) {
    const delta = new Array(nDof).fill(0); delta[j] = eps;
    const rPert = residuals(applyDelta(poses, delta));
    for (let i = 0; i < m; i++) J[i][j] = (rPert[i] - r0[i]) / eps;
  }
  const JtJ: number[][] = Array.from({ length: nDof }, () => new Array(nDof).fill(0));
  for (let a = 0; a < nDof; a++) {
    for (let b = a; b < nDof; b++) {
      let s = 0; for (let i = 0; i < m; i++) s += J[i][a] * J[i][b];
      JtJ[a][b] = s; JtJ[b][a] = s;
    }
  }
  return JtJ;
}
