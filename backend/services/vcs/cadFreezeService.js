'use strict';

// Phase 1 (REQ 684-685 / VC-16, VC-17) — geometry freeze. A released revision's
// geometry must be reproducible exactly without the kernel, because the kernel
// changes between versions (NAMING_VERSION has bumped 20×) and the BRep cache is
// evictable. On release we regenerate once and store the renderable mesh +
// per-body BReps as immutable content-addressed objects; the released commit's
// `meta.frozen` references them. Checking out a released commit reads those
// objects with zero kernel calls; drafts still regenerate live.

const vcs = require('./vcsService');
const cadRegen = require('../cadRegenService');

// The renderable snapshot the viewer consumes, minus the (evictable) BReps and
// per-feature cache flags so it is stable and content-addressable.
function meshSnapshot(regen) {
  return {
    features: (regen.features || []).map(f => ({
      featureId: f.featureId,
      bodyId: f.bodyId ?? null,
      faces: f.faces || [],
      topology: f.topology || { vertices: [], edges: [] },
      error: f.error || null,
    })),
    bodies: (regen.bodies || []).map(b => ({ id: b.id, name: b.name ?? null })),
    errors: regen.errors || [],
  };
}

/** Regenerate the model and store its geometry as immutable content-addressed
 * objects. Returns the frozen metadata to attach to the release commit (VC-16):
 * `{ meshHash, bodies: [{ bodyId, brepHash }] }`. */
async function freezeGeometry(repo, model, { kernelClient } = {}, db) {
  const regen = await cadRegen.regenerateModel(model, { kernelClient, includeBodyBreps: true, db });
  const meshHash = await vcs.writeBlob(repo, meshSnapshot(regen), db);
  const bodies = [];
  for (const b of regen.bodies || []) {
    if (!b.brep) { bodies.push({ bodyId: b.id, brepHash: null }); continue; }
    const brepHash = await vcs.putBinary(repo, 'geometry', Buffer.from(b.brep, 'utf8'), db);
    bodies.push({ bodyId: b.id, brepHash });
  }
  return { meshHash, bodies };
}

/** Reconstruct the renderable geometry from frozen metadata, reading stored
 * objects only — never the kernel (VC-17). */
async function loadFrozenGeometry(repo, frozen, db) {
  const meshObj = await vcs.getObject(repo, frozen.meshHash, db);
  const snap = (meshObj && meshObj.content) || { features: [], bodies: [], errors: [] };
  const brepByBody = new Map();
  for (const b of frozen.bodies || []) {
    if (!b.brepHash) continue;
    const o = await vcs.getObject(repo, b.brepHash, db);
    if (o && o.bytes) brepByBody.set(b.bodyId, o.bytes.toString('utf8'));
  }
  const bodies = (snap.bodies || []).map(b => ({ ...b, brep: brepByBody.get(b.id) || null }));
  return { ...snap, bodies, frozen: true };
}

/** Geometry for a checked-out commit: frozen objects if the commit was frozen
 * on release (no kernel), otherwise a live regeneration from the recipe. */
async function geometryForCommit(repo, model, commitHash, { kernelClient } = {}, db) {
  const commit = await vcs.getCommit(repo, commitHash, db);
  if (commit && commit.meta && commit.meta.frozen) {
    return loadFrozenGeometry(repo, commit.meta.frozen, db);
  }
  return cadRegen.regenerateModel(model, { kernelClient, db });
}

module.exports = { meshSnapshot, freezeGeometry, loadFrozenGeometry, geometryForCommit };
