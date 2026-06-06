'use strict';

// Assembly analysis (REQ 767/768): interference detection and mass properties
// over a composed assembly geometry (the output of assemblyRegenService).
// Mass properties are pure JS; interference uses an AABB broad phase (pure) then
// confirms candidate pairs with a kernel boolean intersection.

// ── mass properties (REQ 768) ─────────────────────────────────────────────────

/**
 * Total volume (sum of component solid volumes) and the volume-weighted center
 * of mass of the placed components. Bodies without reported volume/centroid are
 * skipped (and counted) so the caller can tell the result is partial.
 */
function massProperties(composed) {
  const bodies = (composed && composed.bodies) || [];
  let volume = 0; const acc = [0, 0, 0]; let withMass = 0;
  for (const b of bodies) {
    if (typeof b.volume !== 'number' || !Array.isArray(b.centroid)) continue;
    volume += b.volume;
    acc[0] += b.centroid[0] * b.volume;
    acc[1] += b.centroid[1] * b.volume;
    acc[2] += b.centroid[2] * b.volume;
    withMass++;
  }
  const centerOfMass = volume > 0 ? [acc[0] / volume, acc[1] / volume, acc[2] / volume] : null;
  return { volume, centerOfMass, bodyCount: bodies.length, bodiesWithMass: withMass };
}

// ── interference (REQ 767) ────────────────────────────────────────────────────

// Axis-aligned bounding box from a body's (already-placed) face positions.
function aabbOf(body) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const f of body.faces || []) {
    const p = f.positions || [];
    for (let i = 0; i + 2 < p.length; i += 3) {
      any = true;
      for (let k = 0; k < 3; k++) { const v = p[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    }
  }
  return any ? { min, max } : null;
}

function aabbOverlap(a, b, tol = 1e-6) {
  return a.min[0] <= b.max[0] + tol && a.max[0] >= b.min[0] - tol
    && a.min[1] <= b.max[1] + tol && a.max[1] >= b.min[1] - tol
    && a.min[2] <= b.max[2] + tol && a.max[2] >= b.min[2] - tol;
}

// Bake an instance placement into a BRep via the kernel pattern op (rotate then
// translate) — mirrors the export path.
async function placeBrep(brep, placement, client) {
  let out = brep;
  const q = (placement && placement.quaternion) || [0, 0, 0, 1];
  const t = (placement && placement.translate) || [0, 0, 0];
  const vlen = Math.hypot(q[0], q[1], q[2]);
  if (vlen > 1e-9) {
    const angle = 2 * Math.atan2(vlen, q[3]);
    if (Math.abs(angle) > 1e-9) {
      const axis = [q[0] / vlen, q[1] / vlen, q[2] / vlen];
      const rpc = await client.call('buildPattern', { brepBytes: out, transforms: [{ kind: 'rotate', origin: [0, 0, 0], direction: axis, angleRad: angle }] });
      out = rpc.brepBytes;
    }
  }
  if (t[0] || t[1] || t[2]) {
    const rpc = await client.call('buildPattern', { brepBytes: out, transforms: [{ kind: 'translate', dx: t[0], dy: t[1], dz: t[2] }] });
    out = rpc.brepBytes;
  }
  return out;
}

/**
 * Detect interference between component bodies. Returns one record per
 * AABB-overlapping pair of bodies belonging to different instances:
 *   { a, b, aabbOverlap: true, interfering: true|false|null }
 * `interfering` is null when the kernel was unavailable (AABB candidate only).
 */
async function interference(composed, { kernelClient } = {}) {
  const bodies = ((composed && composed.bodies) || [])
    .map((b) => ({ body: b, aabb: aabbOf(b) }))
    .filter((x) => x.aabb);
  const out = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i]; const B = bodies[j];
      if (A.body.instanceId === B.body.instanceId) continue; // same component
      if (!aabbOverlap(A.aabb, B.aabb)) continue;
      let interfering = null;
      if (kernelClient && A.body.brep && B.body.brep) {
        try {
          const pa = await placeBrep(A.body.brep, A.body.placement, kernelClient);
          const pb = await placeBrep(B.body.brep, B.body.placement, kernelClient);
          const rpc = await kernelClient.call('buildBoolean', { featureId: 'interference', op: 'common', aBrep: pa, bBrep: pb });
          interfering = ((rpc.solids || []).length > 0) || ((rpc.faces || []).length > 0);
        } catch (e) {
          interfering = null; // kernel error → leave as AABB candidate
        }
      }
      out.push({ a: A.body.instanceId, b: B.body.instanceId, aabbOverlap: true, interfering });
    }
  }
  return out;
}

module.exports = { massProperties, interference, aabbOf, aabbOverlap };
