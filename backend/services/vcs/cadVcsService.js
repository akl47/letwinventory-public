'use strict';

// Phase 1 (REQ 677-688) — CAD-facing VCS operations over the working copy.
// The DesignCADModel row is the editable working copy; this service maps
// checkout / check-in / lock / history onto the generic vcsService object store
// and the cadSerializer binding. No HTTP here — the controller wraps these.

const RestError = require('../../util/RestError');
const vcs = require('./vcsService');
const { cadSerialize } = require('./cadSerializer');
const { NAMING_VERSION } = require('../cadRegenService');

const DEFAULT_LOCK_TTL_MS = Number(process.env.CAD_LOCK_TTL_MS) || 30 * 60 * 1000; // 30 min

function dbOf(db) { return db || global.db; }
// `at` lets tests drive time deterministically; production passes nothing.
function nowAt(at) { return at ? new Date(at) : new Date(); }

/** Kernel + naming versions stamped into every commit (REQ 683 / VC-15). */
function cadVersionInfo() {
  return { kernelVersion: `occt-naming-${NAMING_VERSION}`, namingVersion: NAMING_VERSION };
}

/** The repo for a model = (cad, lineage-root partID). Walks Part
 * previousRevisionID so history is continuous across Part revisions (VC-20). */
async function repoForModel(model, db) {
  const D = dbOf(db);
  let part = await D.Part.findByPk(model.partID);
  const seen = new Set();
  while (part && part.previousRevisionID && !seen.has(part.id)) {
    seen.add(part.id);
    const prev = await D.Part.findByPk(part.previousRevisionID);
    if (!prev) break;
    part = prev;
  }
  return { repoType: 'cad', repoId: String(part ? part.id : model.partID) };
}

function docOf(model) {
  return {
    featureTree: model.featureTree,
    sketchDoc: model.sketchDoc,
    equations: model.equations || { entries: {} },
  };
}

function lockHeldByOther(model, userId, at) {
  if (!model.lockedByUserID) return false;
  if (model.lockedByUserID === userId) return false;
  if (model.lockExpiresAt && nowAt(at) > new Date(model.lockExpiresAt)) return false; // expired
  return true;
}

/** Acquire the exclusive branch lock and point the working copy at the branch
 * head. Throws 423 if another user holds a live lock (REQ 678 / VC-10). */
async function checkout(model, userId, { lockTtlMs = DEFAULT_LOCK_TTL_MS, at } = {}, db) {
  const D = dbOf(db);
  if (lockHeldByOther(model, userId, at)) {
    const holder = await D.User.findByPk(model.lockedByUserID);
    throw new RestError(`Model is checked out by ${holder ? holder.displayName : 'another user'}`, 423);
  }
  const repo = await repoForModel(model, db);
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

/** Release the lock — holder, or an administrator via `force` (REQ 679). */
async function releaseLock(model, userId, { force = false } = {}, db) {
  if (model.lockedByUserID && model.lockedByUserID !== userId && !force) {
    throw new RestError('You do not hold the lock on this model', 423);
  }
  await model.update({ lockedByUserID: null, lockedAt: null, lockExpiresAt: null });
  return model;
}

/** Check-in = commit the working copy. Requires the lock; chains the parent;
 * advances the branch; clears dirty (REQ 680 / VC-12). */
async function checkin(model, userId, message, { at } = {}, db) {
  if (!model.lockedByUserID || model.lockedByUserID !== userId) {
    throw new RestError('Check-in requires holding the model lock (check out first)', 423);
  }
  const repo = await repoForModel(model, db);
  const branch = model.branchName || 'main';
  const treeHash = await cadSerialize(repo, docOf(model), db);
  const head = await vcs.getRef(repo, branch, db);
  const commitHash = await vcs.createCommit(repo, {
    treeHash,
    parents: head ? [head.targetHash] : [],
    authorUserID: userId,
    message: message || '',
    timestamp: nowAt(at).toISOString(),
    meta: cadVersionInfo(),
  }, db);
  if (head) await vcs.updateBranch(repo, branch, commitHash, userId, db);
  else await vcs.createBranch(repo, branch, commitHash, userId, db);
  await model.update({ baseCommitHash: commitHash, dirty: false });
  return { commitHash, model };
}

/** Flag the working copy as having uncommitted edits (autosave path, VC-13). */
async function markDirty(model, db) {
  if (!model.dirty) await model.update({ dirty: true });
  return model;
}

/** Ordered commit history for the model's branch (newest first), or []. */
async function history(model, db) {
  const repo = await repoForModel(model, db);
  const branch = model.branchName || 'main';
  if (!(await vcs.getRef(repo, branch, db))) return [];
  return vcs.log(repo, branch, db);
}

/** Clear locks whose expiry has passed (stale-lock sweep, REQ 679). */
async function sweepExpiredLocks(at, db) {
  const D = dbOf(db);
  const { Op } = D.Sequelize;
  const [count] = await D.DesignCADModel.update(
    { lockedByUserID: null, lockedAt: null, lockExpiresAt: null },
    { where: { lockedByUserID: { [Op.ne]: null }, lockExpiresAt: { [Op.lt]: nowAt(at) } } },
  );
  return count;
}

module.exports = {
  DEFAULT_LOCK_TTL_MS,
  cadVersionInfo,
  repoForModel,
  checkout,
  releaseLock,
  checkin,
  markDirty,
  history,
  sweepExpiredLocks,
};
