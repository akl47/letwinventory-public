'use strict';

// Assembly-facing VCS operations over the working copy. A thin binding over the
// shared `vcsWorkingCopy` factory (the checkout/check-in/undo/lock/history logic
// is written once there) plus the assembly serializer.

const vcs = require('./vcsService');
const { makeWorkingCopy } = require('./vcsWorkingCopy');
const { makeRelease } = require('./vcsRelease');
const assemblyFreeze = require('./assemblyFreezeService');
const { assemblySerialize, assemblyDeserialize } = require('./assemblySerializer');

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
  checkin: wc.checkin,
  history: wc.history,
};
