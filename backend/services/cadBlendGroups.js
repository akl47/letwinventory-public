// REQ 1017 — OCCT's MakeFillet/MakeChamfer fails when the rounds of
// different edges overrun the face between them; SolidWorks lets them run
// into each other. Retry by splitting the edges into groups that each blend
// on their own, blending every group on the ORIGINAL body, and combining:
// additive (concave) groups fuse, subtractive (convex) groups intersect.

function isBlendOverrunError(err) {
  return /(fillet|chamfer) did not complete/.test((err && err.message) || '');
}

/**
 * @param edges          picked edges (any shape; passed through to `blend`)
 * @param baseBrep       the body before the blend
 * @param blend(edges)   → rpc result ({ brepBytes, faces, topology, solids }); throws on failure
 * @param volume(brep)   → number
 * @param boolean(op, a, b) → rpc result of fusing/intersecting two breps
 * @param originalError  rethrown whenever the fallback can't produce a sound result
 */
async function blendInGroups({ edges, baseBrep, blend, volume, boolean, originalError }) {
  // Greedy: each edge joins the first group it can blend with.
  const groups = [];
  for (const e of edges) {
    let placed = false;
    for (const g of groups) {
      try {
        g.rpc = await blend([...g.edges, e]);
        g.edges.push(e);
        placed = true;
        break;
      } catch (err) {
        if (!isBlendOverrunError(err)) throw err;
      }
    }
    if (placed) continue;
    try {
      groups.push({ edges: [e], rpc: await blend([e]) });
    } catch (err) {
      if (!isBlendOverrunError(err)) throw err;
      throw originalError;  // too large even on its own
    }
  }
  if (groups.length < 2) throw originalError;

  const baseVol = await volume(baseBrep);
  const deltas = [];
  for (const g of groups) deltas.push((await volume(g.rpc.brepBytes)) - baseVol);
  const tol = Math.max(1e-6, Math.abs(baseVol) * 1e-6);
  const additive = deltas.every(d => d > tol);
  const subtractive = deltas.every(d => d < -tol);
  if (!additive && !subtractive) throw originalError;

  const op = additive ? 'fuse' : 'common';
  let rpc = groups[0].rpc;
  for (const g of groups.slice(1)) rpc = await boolean(op, rpc.brepBytes, g.rpc.brepBytes);

  // Overlap between groups only shrinks the net change, so the combined
  // volume must lie between the largest single change and the sum of them.
  const sum = deltas.reduce((s, d) => s + d, 0);
  const vol = await volume(rpc.brepBytes);
  const sound = additive ? vol <= baseVol + sum + tol : vol >= baseVol + sum - tol;
  if (!sound) throw originalError;
  return { rpc, groups: groups.map(g => g.edges) };
}

module.exports = { blendInGroups, isBlendOverrunError };
