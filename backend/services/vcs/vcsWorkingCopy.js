'use strict';

// Generic VCS working-copy operations, written ONCE and shared by every
// version-controlled document (part-CAD models and assemblies). The
// checkout / check-in / undo / lock / history / seed logic is identical across
// document types — only the document body (what gets serialized) and the repo
// key differ. Those differences are supplied by a `binding`:
//
//   binding = {
//     noun,                          // 'model' | 'assembly' (error wording)
//     repoFor(model, db),            // async → { repoType, repoId }
//     docOf(model),                  // → serializable document
//     serialize(repo, doc, db),      // async → treeHash
//     deserialize(repo, hash, db),   // async → document
//     applyDoc(model, doc),          // → model.update() patch restoring the doc
//     commitMeta?(),                 // optional commit meta (e.g. namingVersion)
//   }
//
// `cadVcsService` and `assemblyVcsService` are thin bindings over this factory.

const RestError = require('../../util/RestError');
const vcs = require('./vcsService');

const DEFAULT_LOCK_TTL_MS = Number(process.env.CAD_LOCK_TTL_MS) || 30 * 60 * 1000; // 30 min

function dbOf(db) { return db || global.db; }
function nowAt(at) { return at ? new Date(at) : new Date(); }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function makeWorkingCopy(binding) {
  const noun = binding.noun || 'document';
  const meta = () => (binding.commitMeta ? binding.commitMeta() : undefined);

  function lockHeldByOther(model, userId, at) {
    if (!model.lockedByUserID) return false;
    if (model.lockedByUserID === userId) return false;
    if (model.lockExpiresAt && nowAt(at) > new Date(model.lockExpiresAt)) return false; // expired
    return true;
  }

  // Seed a brand-new repo: commit the current doc to `main` with no parent and
  // create the `main` ref. No-op (returns the existing head) if `main` exists.
  async function seedMain(model, userId, { at } = {}, db) {
    const repo = await binding.repoFor(model, db);
    const existing = await vcs.getRef(repo, 'main', db);
    if (existing) return existing.targetHash;
    const treeHash = await binding.serialize(repo, binding.docOf(model), db);
    const commitHash = await vcs.createCommit(repo, {
      treeHash, parents: [], authorUserID: userId, message: 'initial',
      timestamp: nowAt(at).toISOString(), meta: meta(),
    }, db);
    await vcs.createBranch(repo, 'main', commitHash, userId, db);
    return commitHash;
  }

  // Acquire the exclusive edit lock and point the working copy at the branch head.
  async function checkout(model, userId, { lockTtlMs = DEFAULT_LOCK_TTL_MS, at } = {}, db) {
    const D = dbOf(db);
    if (lockHeldByOther(model, userId, at)) {
      const holder = await D.User.findByPk(model.lockedByUserID);
      throw new RestError(`${cap(noun)} is checked out by ${holder ? holder.displayName : 'another user'}`, 423);
    }
    const repo = await binding.repoFor(model, db);
    const branch = model.branchName || 'main';
    const ref = await vcs.getRef(repo, branch, db);
    const t = nowAt(at);
    await model.update({
      branchName: branch,
      lockedByUserID: userId,
      lockedAt: t,
      lockExpiresAt: new Date(t.getTime() + lockTtlMs),
      baseCommitHash: ref ? ref.targetHash : model.baseCommitHash,
    });
    return model;
  }

  // Release the lock — holder, or an administrator via `force`.
  async function releaseLock(model, userId, { force = false } = {}, db) {
    if (model.lockedByUserID && model.lockedByUserID !== userId && !force) {
      throw new RestError(`You do not hold the lock on this ${noun}`, 423);
    }
    await model.update({ lockedByUserID: null, lockedAt: null, lockExpiresAt: null });
    return model;
  }

  // Undo a checkout: discard uncommitted changes, roll the doc back to the base
  // commit, and release the lock. Requires holding the lock.
  async function undoCheckout(model, userId, db) {
    if (!model.lockedByUserID || model.lockedByUserID !== userId) {
      throw new RestError(`You do not hold the lock on this ${noun}`, 423);
    }
    const patch = { lockedByUserID: null, lockedAt: null, lockExpiresAt: null, dirty: false };
    if (model.baseCommitHash) {
      const repo = await binding.repoFor(model, db);
      const commit = await vcs.getCommit(repo, model.baseCommitHash, db);
      if (commit) Object.assign(patch, binding.applyDoc(model, await binding.deserialize(repo, commit.treeHash, db)));
    }
    await model.update(patch);
    return model;
  }

  // Check-in = commit the working copy; chains the parent, advances the branch,
  // clears dirty. Requires holding the lock.
  async function checkin(model, userId, message, { at } = {}, db) {
    if (!model.lockedByUserID || model.lockedByUserID !== userId) {
      throw new RestError(`Check-in requires holding the ${noun} lock (check out first)`, 423);
    }
    const repo = await binding.repoFor(model, db);
    const branch = model.branchName || 'main';
    const treeHash = await binding.serialize(repo, binding.docOf(model), db);
    const head = await vcs.getRef(repo, branch, db);
    const commitHash = await vcs.createCommit(repo, {
      treeHash,
      parents: head ? [head.targetHash] : [],
      authorUserID: userId,
      message: message || '',
      timestamp: nowAt(at).toISOString(),
      meta: meta(),
    }, db);
    if (head) await vcs.updateBranch(repo, branch, commitHash, userId, db);
    else await vcs.createBranch(repo, branch, commitHash, userId, db);
    await model.update({ baseCommitHash: commitHash, dirty: false });
    return { commitHash, model };
  }

  // Ordered commit history for the document's current branch (newest first), or [].
  async function history(model, db) {
    const repo = await binding.repoFor(model, db);
    const branch = model.branchName || 'main';
    if (!(await vcs.getRef(repo, branch, db))) return [];
    return vcs.log(repo, branch, db);
  }

  return { lockHeldByOther, seedMain, checkout, releaseLock, undoCheckout, checkin, history };
}

module.exports = { makeWorkingCopy, DEFAULT_LOCK_TTL_MS };
