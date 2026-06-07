'use strict';

// Generic geometry freeze, written once for every version-controlled document.
// On release a document is regenerated once and its renderable mesh + per-body
// BReps are stored as immutable content-addressed objects so a released commit
// reconstructs with zero kernel calls. Only *what* gets regenerated and how the
// snapshot is shaped/reconstructed differ — supplied by a binding:
//
//   binding = {
//     regen(model, { kernelClient, db }),   // async → geometry { bodies:[{id,brep,...}], ... }
//     snapshot(geometry),                   // → content-addressable mesh snapshot (no breps)
//     reconstruct(snapshot, brepByBody),    // → renderable geometry with breps merged back
//   }

const vcs = require('./vcsService');

function makeFreeze(binding) {
  // Regenerate + store the geometry. Returns `{ meshHash, bodies:[{bodyId,brepHash}] }`.
  async function freezeGeometry(repo, model, { kernelClient } = {}, db) {
    const geometry = await binding.regen(model, { kernelClient, db });
    const meshHash = await vcs.writeBlob(repo, binding.snapshot(geometry), db);
    const bodies = [];
    for (const b of geometry.bodies || []) {
      if (!b.brep) { bodies.push({ bodyId: b.id, brepHash: null }); continue; }
      const brepHash = await vcs.putBinary(repo, 'geometry', Buffer.from(b.brep, 'utf8'), db);
      bodies.push({ bodyId: b.id, brepHash });
    }
    return { meshHash, bodies };
  }

  // Reconstruct renderable geometry from frozen metadata — stored objects only.
  async function loadFrozenGeometry(repo, frozen, db) {
    const meshObj = await vcs.getObject(repo, frozen.meshHash, db);
    const snap = (meshObj && meshObj.content) || {};
    const brepByBody = new Map();
    for (const b of frozen.bodies || []) {
      if (!b.brepHash) continue;
      const o = await vcs.getObject(repo, b.brepHash, db);
      if (o && o.bytes) brepByBody.set(b.bodyId, o.bytes.toString('utf8'));
    }
    return binding.reconstruct(snap, brepByBody);
  }

  // Geometry for a checked-out commit: frozen objects if the commit was frozen
  // on release (no kernel), otherwise a live regeneration.
  async function geometryForCommit(repo, model, commitHash, { kernelClient } = {}, db) {
    const commit = await vcs.getCommit(repo, commitHash, db);
    if (commit && commit.meta && commit.meta.frozen) {
      return loadFrozenGeometry(repo, commit.meta.frozen, db);
    }
    return binding.regen(model, { kernelClient, db });
  }

  return { freezeGeometry, loadFrozenGeometry, geometryForCommit };
}

module.exports = { makeFreeze };
