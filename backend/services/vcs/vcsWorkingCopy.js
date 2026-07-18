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
    return vcs.inTransaction(db, async () => {
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
    });
  }

  // Preserve a dirty working copy as a recoverable `stash/<branch>/<ts>` ref
  // (REQ 874): commit the dirty doc parented on its base, authored by the
  // PRIOR holder, and hang a normal mutable branch on it. Recovery = open /
  // cherry-pick / merge that branch; cleanup = archive it.
  async function stash(model, priorHolderId, takerUserId, { at } = {}, db) {
    const repo = await binding.repoFor(model, db);
    const treeHash = await binding.serialize(repo, binding.docOf(model), db);
    const commitHash = await vcs.createCommit(repo, {
      treeHash,
      parents: model.baseCommitHash ? [model.baseCommitHash] : [],
      authorUserID: priorHolderId,
      message: 'stash: uncommitted work rescued at checkout takeover',
      timestamp: nowAt(at).toISOString(),
      meta: meta(),
    }, db);
    const ts = nowAt(at).toISOString().replace(/[:.]/g, '-');
    const name = `stash/${model.branchName || 'main'}/${ts}`;
    await vcs.createBranch(repo, name, commitHash, takerUserId, db);
    return name;
  }

  // Acquire the exclusive edit lock and point the working copy at the branch head.
  //
  // REQ 874: a checkout NEVER exposes another user's uncommitted edits —
  //   - taking over an EXPIRED lock with a dirty copy requires `takeover:
  //     true` (409 TAKEOVER_REQUIRED otherwise); the dirty doc is stashed
  //     first and the copy resets to the branch head;
  //   - a clean checkout fast-forwards the doc to the branch head.
  // Returns { model, stashedTo } — stashedTo is null unless a takeover
  // rescued prior work.
  async function checkout(model, userId, { lockTtlMs = DEFAULT_LOCK_TTL_MS, at, takeover = false } = {}, db) {
    const D = dbOf(db);
    if (lockHeldByOther(model, userId, at)) {
      const holder = await D.User.findByPk(model.lockedByUserID);
      throw new RestError(`${cap(noun)} is checked out by ${holder ? holder.displayName : 'another user'}`, 423);
    }
    // Atomic (REQ 901): stash commit + ref + doc reset + lock fields land
    // together or not at all — a failure mid-takeover must not leave the
    // prior holder's work half-stashed with the lock already reassigned.
    return vcs.inTransaction(db, async () => {
      const repo = await binding.repoFor(model, db);
      const branch = model.branchName || 'main';
      const ref = await vcs.getRef(repo, branch, db);
      const t = nowAt(at);
      let stashedTo = null;
      const patch = {
        branchName: branch,
        lockedByUserID: userId,
        lockedAt: t,
        lockExpiresAt: new Date(t.getTime() + lockTtlMs),
        baseCommitHash: ref ? ref.targetHash : model.baseCommitHash,
      };
      const expiredOther = model.lockedByUserID && model.lockedByUserID !== userId;
      if (expiredOther && model.dirty) {
        if (!takeover) {
          const holder = await D.User.findByPk(model.lockedByUserID);
          const err = new RestError(
            `${cap(noun)} has uncommitted changes from ${holder ? holder.displayName : 'another user'} whose checkout expired — take over to continue (their work will be preserved on a stash branch)`,
            409,
          );
          err.payload = { code: 'TAKEOVER_REQUIRED', holder: holder ? holder.displayName : null };
          throw err;
        }
        stashedTo = await stash(model, model.lockedByUserID, userId, { at }, db);
        if (ref) {
          const head = await vcs.getCommit(repo, ref.targetHash, db);
          if (head) Object.assign(patch, binding.applyDoc(model, await binding.deserialize(repo, head.treeHash, db)));
        }
        patch.dirty = false;
      } else if (!model.dirty && ref && ref.targetHash !== model.baseCommitHash) {
        // Clean copy behind the branch head (e.g. after another user's release
        // or an expired-then-abandoned checkout): fast-forward the doc so this
        // user starts from the committed head, never a stale snapshot.
        const head = await vcs.getCommit(repo, ref.targetHash, db);
        if (head) Object.assign(patch, binding.applyDoc(model, await binding.deserialize(repo, head.treeHash, db)));
      }
      await model.update(patch);
      return { model, stashedTo };
    });
  }

  // Extend the holder's lock (REQ 875). Rejects non-holders. The attributed
  // holder may renew even PAST expiry (revival): browsers throttle the editor
  // heartbeat in hidden tabs and during sleep, so an open editor can miss the
  // TTL through no fault of its own. Attribution intact means nobody claimed
  // the lock in the meantime — takeover reassigns lockedByUserID, the sweep
  // and force-unlock clear it — so revival cannot race a completed takeover;
  // a concurrent one is decided by whichever update lands last, same as two
  // competing checkouts.
  async function renewLock(model, userId, { lockTtlMs = DEFAULT_LOCK_TTL_MS, at } = {}) {
    const t = nowAt(at);
    if (!model.lockedByUserID || model.lockedByUserID !== userId) {
      throw new RestError(`You do not hold the lock on this ${noun}`, 423);
    }
    await model.update({ lockExpiresAt: new Date(t.getTime() + lockTtlMs) });
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
    // Atomic + compare-and-swap (REQ 901): commit, ref advance, and model row
    // land together, and the ref only advances if it still points at the head
    // this commit was parented on — a concurrent check-in loses cleanly (409)
    // instead of silently orphaning this one's commit.
    return vcs.inTransaction(db, async () => {
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
      try {
        if (head) await vcs.updateBranch(repo, branch, commitHash, userId, db, head.targetHash);
        else await vcs.createBranch(repo, branch, commitHash, userId, db);
      } catch (err) {
        if (err.code === 'REF_MOVED') throw new RestError(err.message, 409);
        throw err;
      }
      await model.update({ baseCommitHash: commitHash, dirty: false });
      return { commitHash, model };
    });
  }

  // Ordered commit history for the document's current branch (newest first), or [].
  async function history(model, db) {
    const repo = await binding.repoFor(model, db);
    const branch = model.branchName || 'main';
    if (!(await vcs.getRef(repo, branch, db))) return [];
    return vcs.log(repo, branch, db);
  }

  return { lockHeldByOther, seedMain, checkout, renewLock, releaseLock, undoCheckout, checkin, history };
}

module.exports = { makeWorkingCopy, DEFAULT_LOCK_TTL_MS };
