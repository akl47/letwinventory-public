'use strict';

// 3D assembly mate solver (REQ 755-757) — Node port of the proven frontend
// solver (frontend/src/app/cad/lib/mateSolver.ts). Positions rigid component
// instances by solving geometric mate constraints with Levenberg-Marquardt
// least-squares over a global twist-increment vector; the Jacobian is numerically
// differentiated. This is the authoritative server-side solve run during
// regeneration; the frontend keeps an identical copy for interactive drag.
//
// Each non-grounded instance carries a pose (quaternion q, translate t). World
// point of a local point p is x = rotate(q, p) + t. Optimization variables are
// per-instance local twists δ = (δω, δt) ∈ R⁶ applied as
//   q ← q ⊗ quatFromRotVec(δω)   (body-frame rotation)
//   t ← t + δt                   (world-frame translation)

// ── vec / quat helpers ────────────────────────────────────────────────────────
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
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.sqrt(vdot(a, a));
function vnorm(a) { const l = vlen(a); return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]; }

const IDENTITY_Q = [0, 0, 0, 1];
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
function qNorm(q) {
  const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return l < 1e-12 ? IDENTITY_Q : [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
function quatFromRotVec(r) {
  const angle = vlen(r);
  if (angle < 1e-12) return IDENTITY_Q;
  const s = Math.sin(angle / 2) / angle;
  return qNorm([r[0] * s, r[1] * s, r[2] * s, Math.cos(angle / 2)]);
}
function rotVecOfQuat(q) {
  const qn = qNorm(q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q);
  const v = [qn[0], qn[1], qn[2]];
  const s = vlen(v);
  if (s < 1e-12) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, qn[3]);
  return vscale(v, angle / s);
}
const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];

// ── mate geometry in world space ──────────────────────────────────────────────
function worldPlane(pose, g) {
  return { origin: vadd(qRotate(pose.quaternion, g.origin), pose.translate), normal: vnorm(qRotate(pose.quaternion, g.normal)) };
}
function worldAxis(pose, g) {
  return {
    origin: vadd(qRotate(pose.quaternion, g.origin), pose.translate),
    direction: vnorm(qRotate(pose.quaternion, g.direction)),
    radius: g.radius || 0,
  };
}
function worldPoint(pose, g) {
  return vadd(qRotate(pose.quaternion, g.origin), pose.translate);
}
const perpComponent = (delta, d) => vsub(delta, vscale(d, vdot(delta, d)));

const lockTargets = new Map();

function mateResiduals(mate, poseA, poseB) {
  switch (mate.type) {
    case 'coincident': {
      // Origin-point pair → coincident points (3 residuals).
      if (mate.a.geom.kind === 'point' && mate.b.geom.kind === 'point') {
        const a = worldPoint(poseA, mate.a.geom); const b = worldPoint(poseB, mate.b.geom);
        return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      }
      const pa = worldPlane(poseA, mate.a.geom); const pb = worldPlane(poseB, mate.b.geom);
      const orient = mate.flip ? vsub(pa.normal, pb.normal) : vadd(pa.normal, pb.normal);
      const sep = vdot(pa.normal, vsub(pb.origin, pa.origin));
      return [orient[0], orient[1], orient[2], sep];
    }
    case 'distance': {
      // Origin-point pair → Euclidean distance equals the value.
      if (mate.a.geom.kind === 'point' && mate.b.geom.kind === 'point') {
        const a = worldPoint(poseA, mate.a.geom); const b = worldPoint(poseB, mate.b.geom);
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        return [d - (mate.value || 0)];
      }
      const pa = worldPlane(poseA, mate.a.geom); const pb = worldPlane(poseB, mate.b.geom);
      const orient = mate.flip ? vsub(pa.normal, pb.normal) : vadd(pa.normal, pb.normal);
      const sep = vdot(pa.normal, vsub(pb.origin, pa.origin)) - (mate.value || 0);
      return [orient[0], orient[1], orient[2], sep];
    }
    case 'parallel': {
      const pa = worldPlane(poseA, mate.a.geom); const pb = worldPlane(poseB, mate.b.geom);
      return vcross(pa.normal, pb.normal);
    }
    case 'perpendicular': {
      const pa = worldPlane(poseA, mate.a.geom); const pb = worldPlane(poseB, mate.b.geom);
      return [vdot(pa.normal, pb.normal)];
    }
    case 'angle': {
      const pa = worldPlane(poseA, mate.a.geom); const pb = worldPlane(poseB, mate.b.geom);
      return [vdot(pa.normal, pb.normal) - Math.cos(mate.value || 0)];
    }
    case 'concentric': {
      const aa = worldAxis(poseA, mate.a.geom); const ab = worldAxis(poseB, mate.b.geom);
      const par = vcross(aa.direction, ab.direction);
      const off = perpComponent(vsub(ab.origin, aa.origin), aa.direction);
      return [par[0], par[1], par[2], off[0], off[1], off[2]];
    }
    case 'tangent': {
      const ax = worldAxis(poseA, mate.a.geom); const pl = worldPlane(poseB, mate.b.geom);
      const parallelToPlane = vdot(ax.direction, pl.normal);
      const signedDist = vdot(pl.normal, vsub(ax.origin, pl.origin));
      const wantedDist = mate.flip ? -ax.radius : ax.radius;
      return [parallelToPlane, signedDist - wantedDist];
    }
    case 'lock': {
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

// ── small dense linear algebra ────────────────────────────────────────────────
function solveDamped(A, b, lambda) {
  const n = b.length;
  const M = A.map((row, i) => row.map((v, j) => (i === j ? v + lambda : v)));
  const x = b.slice();
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) continue;
    if (piv !== col) { const tm = M[piv]; M[piv] = M[col]; M[col] = tm; const tx = x[piv]; x[piv] = x[col]; x[col] = tx; }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c < n; c++) M[r][c] -= f * M[col][c];
      x[r] -= f * x[col];
    }
  }
  for (let i = 0; i < n; i++) { if (Math.abs(M[i][i]) < 1e-14) { x[i] = 0; continue; } x[i] /= M[i][i]; }
  return x;
}

function symmetricRank(A, tol) {
  const n = A.length;
  if (n === 0) return 0;
  const M = A.map((row) => row.slice());
  let rank = 0;
  const used = new Set();
  for (let col = 0; col < n; col++) {
    let piv = -1; let best = tol;
    for (let r = 0; r < n; r++) { if (used.has(r)) continue; if (Math.abs(M[r][col]) > best) { best = Math.abs(M[r][col]); piv = r; } }
    if (piv < 0) continue;
    used.add(piv); rank++;
    for (let r = 0; r < n; r++) {
      if (r === piv || used.has(r)) continue;
      const f = M[r][col] / M[piv][col];
      for (let c = col; c < n; c++) M[r][c] -= f * M[piv][c];
    }
  }
  return rank;
}

const norm2 = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

/**
 * Solve a set of mates over the given instances.
 * @param instances [{ id, grounded?, translate:[3], quaternion:[4] }]
 * @param mates [{ id, type, a:{instanceId, geom}, b:{instanceId, geom}, value?, flip?, suppressed? }]
 *   where geom is { kind:'plane', origin, normal } | { kind:'axis', origin, direction, radius? }
 *   in the instance LOCAL frame.
 * @returns { poses:{[id]:{translate,quaternion}}, converged, residualNorm, dof, state, iterations }
 */
/**
 * Solve a set of mates, auto-correcting flip-induced non-convergence.
 *
 * A coincident/distance/tangent mate's `flip` selects a normal ALIGNMENT
 * (normals same vs opposite). For a single mate either alignment is
 * satisfiable, but a combination across several mates can imply a REFLECTION
 * (improper rotation) rather than a rigid pose — then no pose satisfies them
 * and the solve reports `over` even though the mates are individually fine
 * (the user's symptom: "over-constrained until I flipped a mate's face").
 *
 * When the initial solve doesn't converge, we greedily toggle each flip-able
 * mate's flip, keeping any toggle that reduces the residual, to recover a
 * consistent set. The chosen flips are returned in `resolvedFlips` so callers
 * can persist the correction. If nothing converges, the assembly is genuinely
 * over-constrained and the best (still-`over`) result is returned unchanged.
 */
function solveMates(instances, mates, opts = {}) {
  let best = solveOnce(instances, mates, opts);
  best.resolvedFlips = {};
  for (const m of mates) if (!m.suppressed) best.resolvedFlips[m.id] = !!m.flip;
  if (best.converged) return best;

  const FLIP_TYPES = new Set(['coincident', 'distance', 'tangent']);
  const flipIdx = mates
    .map((m, i) => (!m.suppressed && FLIP_TYPES.has(m.type) ? i : -1))
    .filter((i) => i >= 0);
  if (flipIdx.length === 0) return best;

  const working = mates.map((m) => ({ ...m }));
  const goodEnough = Math.max((opts.tolerance || 1e-7) * 10, 1e-5);
  let improved = true;
  let guard = 0;
  while (improved && !best.converged && guard++ <= flipIdx.length) {
    improved = false;
    for (const i of flipIdx) {
      working[i].flip = !working[i].flip;
      const trial = solveOnce(instances, working, opts);
      if (trial.residualNorm < best.residualNorm - 1e-9) {
        best = trial;
        improved = true;
      } else {
        working[i].flip = !working[i].flip; // revert — toggle didn't help
      }
      if (best.residualNorm < goodEnough) break;
    }
  }
  best.resolvedFlips = {};
  for (const m of working) if (!m.suppressed) best.resolvedFlips[m.id] = !!m.flip;
  return best;
}

function solveOnce(instances, mates, opts = {}) {
  const maxIterations = opts.maxIterations || 80;
  const tolerance = opts.tolerance || 1e-7;

  const poses = {};
  for (const inst of instances) {
    poses[inst.id] = { translate: inst.translate.slice(), quaternion: qNorm(inst.quaternion || IDENTITY_Q) };
  }

  const active = mates.filter((m) => !m.suppressed);

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

  const freeIds = instances.filter((i) => !i.grounded).map((i) => i.id);
  const dofIndex = new Map();
  freeIds.forEach((id, k) => dofIndex.set(id, k * 6));
  const nDof = freeIds.length * 6;

  const residuals = (p) => {
    const out = [];
    for (const m of active) {
      const pa = p[m.a.instanceId]; const pb = p[m.b.instanceId];
      if (!pa || !pb) continue;
      const r = mateResiduals(m, pa, pb);
      for (let i = 0; i < r.length; i++) out.push(r[i]);
    }
    return out;
  };

  const applyDelta = (base, delta) => {
    const next = {};
    for (const id of Object.keys(base)) {
      const off = dofIndex.get(id);
      if (off === undefined) { next[id] = base[id]; continue; }
      const dw = [delta[off], delta[off + 1], delta[off + 2]];
      const dt = [delta[off + 3], delta[off + 4], delta[off + 5]];
      next[id] = { quaternion: qNorm(qMul(base[id].quaternion, quatFromRotVec(dw))), translate: vadd(base[id].translate, dt) };
    }
    return next;
  };

  const buildJtJ = (p) => {
    const r0 = residuals(p);
    const m = r0.length;
    const eps = 1e-6;
    const J = Array.from({ length: m }, () => new Array(nDof).fill(0));
    for (let j = 0; j < nDof; j++) {
      const delta = new Array(nDof).fill(0); delta[j] = eps;
      const rPert = residuals(applyDelta(p, delta));
      for (let i = 0; i < m; i++) J[i][j] = (rPert[i] - r0[i]) / eps;
    }
    const JtJ = Array.from({ length: nDof }, () => new Array(nDof).fill(0));
    for (let a = 0; a < nDof; a++) {
      for (let b = a; b < nDof; b++) {
        let s = 0; for (let i = 0; i < m; i++) s += J[i][a] * J[i][b];
        JtJ[a][b] = s; JtJ[b][a] = s;
      }
    }
    return { J, JtJ, r0, m };
  };

  let r0 = residuals(poses);
  let lambda = 1e-3;
  let iterations = 0;
  let lastJtJ = [];

  if (nDof > 0 && r0.length > 0) {
    for (let iter = 0; iter < maxIterations; iter++) {
      iterations = iter + 1;
      const { J, JtJ, r0: rr, m } = buildJtJ(poses);
      r0 = rr; lastJtJ = JtJ;
      const Jtr = new Array(nDof).fill(0);
      for (let a = 0; a < nDof; a++) { let s = 0; for (let i = 0; i < m; i++) s += J[i][a] * r0[i]; Jtr[a] = s; }

      const cost0 = norm2(r0);
      let accepted = false;
      for (let tries = 0; tries < 8; tries++) {
        const step = solveDamped(JtJ, Jtr.map((v) => -v), lambda);
        const trial = applyDelta(poses, step);
        const rTrial = residuals(trial);
        if (norm2(rTrial) < cost0) {
          for (const id of Object.keys(trial)) poses[id] = trial[id];
          r0 = rTrial;
          lambda = Math.max(lambda * 0.5, 1e-12);
          accepted = true;
          if (norm2(step) < tolerance) iter = maxIterations;
          break;
        }
        lambda *= 4;
      }
      if (!accepted) break;
      if (cost0 < tolerance) break;
    }
  }

  const residualNorm = norm2(r0);
  const converged = residualNorm < Math.max(tolerance * 10, 1e-5);
  const rankMatrix = lastJtJ.length ? lastJtJ : (nDof > 0 ? buildJtJ(poses).JtJ : []);
  const rank = nDof > 0 ? symmetricRank(rankMatrix, 1e-6) : 0;
  const dof = Math.max(0, nDof - rank);
  let state;
  if (!converged) state = 'over';
  else if (dof > 0) state = 'under';
  else state = 'fully';

  lockTargets.clear();
  return { poses, converged, residualNorm, dof, state, iterations };
}

module.exports = { solveMates };
