'use strict';

// Assembly geometry freeze — binds the shared vcsFreeze storage to the composed
// assembly geometry. On release we regenerate the composed assembly (mesh +
// per-body BReps) and store it so a released assembly reconstructs with zero
// kernel calls, exactly like a released part-CAD model.

const assemblyRegen = require('../assemblyRegenService');
const { makeFreeze } = require('./vcsFreeze');

function dbOf(db) { return db || global.db; }

// Snapshot the composed assembly's renderable geometry (no BReps — stored
// separately, content-addressed).
function assemblySnapshot(composed) {
  return {
    bodies: (composed.bodies || []).map((b) => ({
      id: b.id, name: b.name ?? null, instanceId: b.instanceId, partID: b.partID,
      placement: b.placement, faces: b.faces || [], vertices: b.vertices || [], edges: b.edges || [],
    })),
    instances: composed.instances || [],
    constraintState: composed.constraintState || null,
    errors: composed.errors || [],
  };
}

// Rebuild the AssemblyRegenResponse shape the editor consumes from the snapshot.
function assemblyReconstruct(snap, brepByBody) {
  const bodies = (snap.bodies || []).map((b) => ({ ...b, brep: brepByBody.get(b.id) || null }));
  return {
    faces: bodies.flatMap((b) => b.faces || []),
    vertices: bodies.flatMap((b) => b.vertices || []),
    edges: bodies.flatMap((b) => b.edges || []),
    bodies,
    instances: snap.instances || [],
    constraintState: snap.constraintState || null,
    errors: snap.errors || [],
    frozen: true,
  };
}

const freeze = makeFreeze({
  regen: (assembly, { kernelClient, db }) => assemblyRegen.regenerateAssembly(assembly, { db: dbOf(db), kernelClient }),
  snapshot: assemblySnapshot,
  reconstruct: assemblyReconstruct,
});

module.exports = {
  assemblySnapshot,
  freezeGeometry: freeze.freezeGeometry,
  loadFrozenGeometry: freeze.loadFrozenGeometry,
  geometryForCommit: freeze.geometryForCommit,
};
