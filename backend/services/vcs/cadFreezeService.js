'use strict';

// Phase 1 (REQ 684-685 / VC-16, VC-17) — geometry freeze. A released revision's
// geometry must be reproducible exactly without the kernel, because the kernel
// changes between versions (NAMING_VERSION has bumped 20×) and the BRep cache is
// evictable. On release we regenerate once and store the renderable mesh +
// per-body BReps as immutable content-addressed objects; the released commit's
// `meta.frozen` references them. Checking out a released commit reads those
// objects with zero kernel calls; drafts still regenerate live.

const cadRegen = require('../cadRegenService');
const { makeFreeze } = require('./vcsFreeze');

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

// The storage plumbing is written once in vcsFreeze; bind it to the CAD shape.
const freeze = makeFreeze({
  regen: (model, { kernelClient, db }) => cadRegen.regenerateModel(model, { kernelClient, includeBodyBreps: true, db }),
  snapshot: meshSnapshot,
  reconstruct: (snap, brepByBody) => ({
    ...snap,
    bodies: (snap.bodies || []).map(b => ({ ...b, brep: brepByBody.get(b.id) || null })),
    frozen: true,
  }),
});

module.exports = {
  meshSnapshot,
  freezeGeometry: freeze.freezeGeometry,
  loadFrozenGeometry: freeze.loadFrozenGeometry,
  geometryForCommit: freeze.geometryForCommit,
};
