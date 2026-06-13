'use strict';

// Assembly-facing VCS operations over the working copy. A thin binding over the
// shared `vcsWorkingCopy` factory (the checkout/check-in/undo/lock/history logic
// is written once there) plus the assembly serializer.

const vcs = require('./vcsService');
const { makeWorkingCopy } = require('./vcsWorkingCopy');
const { makeRelease } = require('./vcsRelease');
const assemblyFreeze = require('./assemblyFreezeService');
const { assemblySerialize, assemblyDeserialize } = require('./assemblySerializer');
const cadVcsService = require('./cadVcsService');
const assemblyRegen = require('../assemblyRegenService');

function dbOf(db) { return db || global.db; }

// The repo is keyed to the part revision lineage root (so history is continuous
// across revisions), with its own repoType so it never collides with CAD repos.
async function repoForAssembly(assembly, db) {
  const D = dbOf(db);
  let part = await D.Part.findByPk(assembly.partID);
  const seen = new Set();
  while (part && part.previousRevisionID && !seen.has(part.id)) {
    seen.add(part.id);
    const prev = await D.Part.findByPk(part.previousRevisionID);
    if (!prev) break;
    part = prev;
  }
  return { repoType: 'assembly', repoId: String(part ? part.id : assembly.partID) };
}

function docOf(assembly) {
  return assembly.assemblyDoc || { nextInstanceSeq: 1, nextMateSeq: 1, instances: [], mates: [] };
}

const wc = makeWorkingCopy({
  noun: 'assembly',
  repoFor: repoForAssembly,
  docOf,
  serialize: assemblySerialize,
  deserialize: assemblyDeserialize,
  applyDoc: (model, doc) => ({ assemblyDoc: doc }),
});

// Release-the-revision, written once in vcsRelease; freezes the COMPOSED
// assembly geometry so a released assembly reconstructs without the kernel.
const { release } = makeRelease({
  repoFor: repoForAssembly,
  serialize: assemblySerialize,
  docOf,
  freeze: assemblyFreeze,
});

// REQ 789 — pin every instance to the head commit of its tracked branch (or the
// part's current branch for legacy instances; falling back to main) so the
// committed assembly doc records exactly which child states it saw. Mirrors
// cadVcsService.pinCrossPartRefs. Returns the pins for VcsUsage edges.
async function pinInstanceBranches(assembly, db) {
  const D = dbOf(db);
  const doc = JSON.parse(JSON.stringify(docOf(assembly)));
  const pinned = [];
  let changed = false;
  for (const inst of doc.instances || []) {
    let src;
    try { src = await assemblyRegen.resolveChildSource(inst, D); } catch { continue; }
    const row = src.row;
    const repo = row.isAssembly ? await repoForAssembly(row, D) : await cadVcsService.repoForModel(row, D);
    const branch = (inst.ref && inst.ref.branch) || row.branchName || 'main';
    let ref = await vcs.getRef(repo, branch, D);
    if (!ref) ref = await vcs.getRef(repo, 'main', D);
    if (!ref) continue; // repo never seeded — nothing to pin
    if (inst.pinnedCommitHash !== ref.targetHash) { inst.pinnedCommitHash = ref.targetHash; changed = true; }
    pinned.push({ repo, instanceId: inst.instanceId, commitHash: ref.targetHash });
  }
  if (changed) await assembly.update({ assemblyDoc: doc });
  return pinned;
}

// Check-in wrapper: pin instance branch heads first (so the committed doc
// carries them), commit, then record a VcsUsage edge per instance for impact
// analysis ("which assembly commits used part B?").
async function checkin(assembly, userId, message, opts = {}, db) {
  const D = dbOf(db);
  const pinned = await pinInstanceBranches(assembly, D);
  const result = await wc.checkin(assembly, userId, message, opts, D);
  if (D.VcsUsage && pinned.length) {
    const repoA = await repoForAssembly(assembly, D);
    for (const p of pinned) {
      await D.VcsUsage.create({
        childRepoType: p.repo.repoType, childRepoId: p.repo.repoId,
        parentRepoType: repoA.repoType, parentRepoId: repoA.repoId,
        parentCommitHash: result.commitHash, instanceId: p.instanceId,
      });
    }
  }
  return result;
}

// Seed + record the base commit on the working-copy row (so the assembly shows
// version history from creation).
async function seedMain(assembly, userId, opts = {}, db) {
  const commitHash = await wc.seedMain(assembly, userId, opts, db);
  if (!assembly.baseCommitHash) {
    await assembly.update({ branchName: assembly.branchName || 'main', baseCommitHash: commitHash });
  }
  return commitHash;
}

module.exports = {
  repoForAssembly,
  docOf,
  seedMain,
  release,
  checkout: wc.checkout,
  releaseLock: wc.releaseLock,
  undoCheckout: wc.undoCheckout,
  checkin,
  history: wc.history,
};
