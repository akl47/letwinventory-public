'use strict';

// Phase 1 (REQ 677-688) — CAD-facing VCS operations over the working copy.
// The DesignCADModel row is the editable working copy; this service maps
// checkout / check-in / lock / history onto the generic vcsService object store
// and the cadSerializer binding. No HTTP here — the controller wraps these.

const RestError = require('../../util/RestError');
const vcs = require('./vcsService');
const { cadSerialize, cadDeserialize } = require('./cadSerializer');
const freeze = require('./cadFreezeService');
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

/** Zero-padded 2-digit numeric revision string (matches partRevisionService). */
function padNumeric(n) { return String(n).padStart(2, '0'); }

/** Highest numeric revision in the part lineage = the max numeric
 * `Parts.revision` for this part name. The Parts table is the single source of
 * truth for revision numbers — it advances ONLY on a dev release or a manual
 * "new revision" in the part editor. (Matches `nextNumericRevision` so the
 * displayed draft rev always equals what a release will actually mint.) 0 if
 * the part has no numeric revision yet. */
async function highestReleasedNumeric(model, db) {
  const D = dbOf(db);
  const part = await D.Part.findByPk(model.partID);
  if (!part) return 0;
  const rows = await D.Part.findAll({ where: { name: part.name }, attributes: ['revision'] });
  const nums = rows.map((p) => p.revision).filter((s) => /^\d+$/.test(s)).map((s) => parseInt(s, 10));
  return nums.length ? Math.max(...nums) : 0;
}

/** The numeric revision a draft branch would release as = highest part revision
 * + 1. Derived, not stored — so every concurrent draft branch shows the SAME
 * number, and it bumps as soon as a new revision is released/created. */
async function derivedDraftRev(model, db) {
  return padNumeric((await highestReleasedNumeric(model, db)) + 1);
}

/** Seed a brand-new repo: commit the model's current doc to `main` with no
 * parent and create the `main` ref. No-op (returns the existing head) if `main`
 * already exists. `main` is protected thereafter — it only advances via the
 * submit → approve → release path. Returns the main head commit hash. */
async function seedMain(model, userId, { at } = {}, db) {
  const repo = await repoForModel(model, db);
  const existing = await vcs.getRef(repo, 'main', db);
  if (existing) return existing.targetHash;
  const treeHash = await cadSerialize(repo, docOf(model), db);
  const commitHash = await vcs.createCommit(repo, {
    treeHash, parents: [], authorUserID: userId, message: 'initial',
    timestamp: nowAt(at).toISOString(), meta: cadVersionInfo(),
  }, db);
  await vcs.createBranch(repo, 'main', commitHash, userId, db);
  return commitHash;
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

/** Release the lock — holder, or an administrator via `force` (REQ 679).
 * Used by admin force-unlock; the holder uses undoCheckout. */
async function releaseLock(model, userId, { force = false } = {}, db) {
  if (model.lockedByUserID && model.lockedByUserID !== userId && !force) {
    throw new RestError('You do not hold the lock on this model', 423);
  }
  await model.update({ lockedByUserID: null, lockedAt: null, lockExpiresAt: null });
  return model;
}

/** Undo a checkout: discard the working copy's uncommitted changes, roll it
 * back to the last checked-in state (its base commit), and release the lock.
 * Requires the caller to hold the lock. */
async function undoCheckout(model, userId, db) {
  if (!model.lockedByUserID || model.lockedByUserID !== userId) {
    throw new RestError('You do not hold the lock on this model', 423);
  }
  const patch = { lockedByUserID: null, lockedAt: null, lockExpiresAt: null, dirty: false };
  // Roll the doc back to the base commit (the last check-in), if there is one.
  if (model.baseCommitHash) {
    const repo = await repoForModel(model, db);
    const commit = await vcs.getCommit(repo, model.baseCommitHash, db);
    if (commit) {
      const doc = await cadDeserialize(repo, commit.treeHash, db);
      patch.featureTree = doc.featureTree;
      patch.sketchDoc = doc.sketchDoc;
      patch.equations = doc.equations;
    }
  }
  await model.update(patch);
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

/** Release the working copy as a Part revision (VC-18): commit the current
 * state, freeze its geometry into that commit, advance the branch, and create a
 * write-once tag named for the revision. Returns { commitHash, tag }. */
async function release(model, userId, revisionLabel, { kernelClient, at, parents } = {}, db) {
  const repo = await repoForModel(model, db);
  const branch = model.branchName || 'main';
  const tag = String(revisionLabel);

  // Write-once: refuse a re-release BEFORE mutating anything. Otherwise a
  // repeated, raced, or double-clicked release would create a duplicate
  // `release N` commit and advance the branch past the already-tagged commit
  // (orphaning it) before the 409 ever fires — corrupting the history graph.
  if (await vcs.getRef(repo, tag, db)) {
    throw new RestError(`Revision ${tag} has already been released (tags are write-once)`, 409);
  }

  const treeHash = await cadSerialize(repo, docOf(model), db);
  const head = await vcs.getRef(repo, branch, db);
  const frozen = await freeze.freezeGeometry(repo, model, { kernelClient }, db);
  // `parents` override lets a branch→main release chain off the BRANCH head so
  // the branch's commits become ancestors of main (git-style merge, not a
  // squash). Default: chain off the target branch's current head.
  const commitParents = parents || (head ? [head.targetHash] : []);
  const commitHash = await vcs.createCommit(repo, {
    treeHash,
    parents: commitParents,
    authorUserID: userId,
    message: `release ${revisionLabel}`,
    timestamp: nowAt(at).toISOString(),
    meta: { ...cadVersionInfo(), frozen },
  }, db);
  // Claim the write-once tag BEFORE advancing the branch, so a concurrent
  // racing release fails here (leaving only a harmless unreachable commit
  // object) rather than after it has already moved the branch head.
  await vcs.createTag(repo, tag, commitHash, userId, db);
  if (head) await vcs.updateBranch(repo, branch, commitHash, userId, db);
  else await vcs.createBranch(repo, branch, commitHash, userId, db);
  await model.update({ baseCommitHash: commitHash, dirty: false });
  return { commitHash, tag };
}

/** Development release (REQ 715-718): self-service. The design must be checked
 * in; freeze + write-once-tag the current numeric Part revision, then lock the
 * design read-only (releaseLocked) and the Part (revisionLocked). No approval. */
async function devRelease(model, userId, { kernelClient, at } = {}, db) {
  const D = dbOf(db);
  if (model.releaseLocked) throw new RestError('This revision is already released and locked', 409);
  if (model.dirty || !model.baseCommitHash) {
    throw new RestError('Check in the design before releasing it', 409);
  }
  const part = await D.Part.findByPk(model.partID);
  const revision = part && part.revision;
  if (!revision) throw new RestError('Part has no revision to release as', 400);
  const { commitHash, tag } = await release(model, userId, revision, { kernelClient, at }, db);
  await model.update({ releaseLocked: true });
  if (!part.revisionLocked) await part.update({ revisionLocked: true });
  return { commitHash, tag };
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

// ── Commit thumbnails (REQ 710) ───────────────────────────────────────────────
// A low-resolution PNG captured client-side from the model's default view at
// check-in. Stored as a binary object keyed by a synthetic `thumb-<commit>`
// address (deterministic per commit, not content-addressed) so the version
// history can show each commit instantly without a kernel regeneration.

// Thumbnails are keyed by their commit but must fit VcsObject.hash (varchar 64).
// A literal `thumb-<64-char-hash>` is 70 chars and silently fails to insert on
// Postgres, so derive a 64-char key by hashing. Deterministic per commit.
function thumbKey(commitHash) {
  return require('crypto').createHash('sha256').update(`thumb:${commitHash}`).digest('hex');
}

/** Decode a `data:image/...;base64,...` URL (or a raw base64 string) to a Buffer. */
function decodeThumbnail(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 && dataUrl.startsWith('data:') ? dataUrl.slice(comma + 1) : dataUrl;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

/** Store the thumbnail PNG for a commit (no-op on empty/invalid input). */
async function storeThumbnail(model, commitHash, dataUrl, db) {
  const buf = decodeThumbnail(dataUrl);
  if (!buf) return null;
  const D = dbOf(db);
  const repo = await repoForModel(model, db);
  await D.VcsObject.findOrCreate({
    where: { repoType: repo.repoType, repoId: String(repo.repoId), hash: thumbKey(commitHash) },
    defaults: { kind: 'thumbnail', content: null, bytes: buf, size: buf.length },
  });
  return commitHash;
}

/** Load a commit's thumbnail PNG bytes, or null if none was captured. */
async function loadThumbnail(model, commitHash, db) {
  const D = dbOf(db);
  const repo = await repoForModel(model, db);
  const row = await D.VcsObject.findOne({
    where: { repoType: repo.repoType, repoId: String(repo.repoId), hash: thumbKey(commitHash) },
  });
  return row && row.bytes != null ? Buffer.from(row.bytes) : null;
}

module.exports = {
  DEFAULT_LOCK_TTL_MS,
  cadVersionInfo,
  repoForModel,
  padNumeric,
  highestReleasedNumeric,
  derivedDraftRev,
  seedMain,
  checkout,
  releaseLock,
  undoCheckout,
  checkin,
  release,
  devRelease,
  markDirty,
  history,
  sweepExpiredLocks,
  storeThumbnail,
  loadThumbnail,
};
