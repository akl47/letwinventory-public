'use strict';

// Wire-harness version control. The harness backend is separate from CAD (own
// table `WireHarnesses`, own API under /api/parts/harness), but its workflow is
// the CAD one: the checkout / check-in / branch / release machinery is the
// shared, document-agnostic VCS factories bound to a WireHarness row and the
// harness serializer. Each WireHarness row is its own repository.
//
// Unlike CAD, a harness revision is not a Parts row: the released revision
// labels are the repository's write-once tags, and `WireHarness.revision`
// carries the working revision (the released label on main, the next numeric
// on a draft branch).

const RestError = require('../../util/RestError');
const vcs = require('./vcsService');
const { makeWorkingCopy, DEFAULT_LOCK_TTL_MS } = require('./vcsWorkingCopy');
const { makeBranchOps } = require('./vcsBranchOps');
const { makeRelease } = require('./vcsRelease');
const { harnessSerialize, harnessDeserialize } = require('./harnessSerializer');

function dbOf(db) { return db || global.db; }
function padNumeric(n) { return String(n).padStart(2, '0'); }
const isNumeric = (s) => /^\d+$/.test(String(s || ''));
const isLetter = (s) => /^[A-Z]+$/.test(String(s || ''));

async function repoFor(harness) {
  return { repoType: 'harness', repoId: String(harness.id) };
}

function docOf(harness) {
  return { name: harness.name, description: harness.description || null, harnessData: harness.harnessData || {} };
}

/** model.update() patch restoring a deserialized document onto the row. */
function applyDoc(harness, doc) {
  return { name: doc.name || harness.name, description: doc.description, harnessData: doc.harnessData || {} };
}

const binding = { noun: 'harness', repoFor, docOf, serialize: harnessSerialize, deserialize: harnessDeserialize, applyDoc };
const wc = makeWorkingCopy(binding);
const branchOps = makeBranchOps(binding);
// A harness has no kernel geometry to freeze — the committed document is the
// released artifact.
const { release } = makeRelease({ ...binding, freeze: { freezeGeometry: async () => null } });

async function tagNames(harness, db) {
  return (await vcs.listRefs(await repoFor(harness), 'tag', db)).map((t) => t.name);
}

/** Highest released numeric revision (0 when nothing numeric is released). */
async function highestReleasedNumeric(harness, db) {
  const nums = (await tagNames(harness, db)).filter(isNumeric).map((n) => parseInt(n, 10));
  return nums.length ? Math.max(...nums) : 0;
}

/** The numeric revision a draft branch releases as. A harness adopted from
 * before version control keeps the numeric revision it already carried. */
async function draftRevision(harness, db) {
  const next = (await highestReleasedNumeric(harness, db)) + 1;
  const own = isNumeric(harness.revision) ? parseInt(harness.revision, 10) : 0;
  return padNumeric(Math.max(next, own));
}

/** Next production letter: A → B → … → Z → AA. */
function nextLetter(current) {
  if (!isLetter(current)) return 'A';
  const chars = current.split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] !== 'Z') {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join('');
    }
    chars[i] = 'A';
  }
  return 'A' + chars.join('');
}

async function nextProductionRevision(harness, db) {
  const letters = (await tagNames(harness, db)).filter(isLetter)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  return nextLetter(letters[letters.length - 1]);
}

// Create the repository for a harness that has none (a new harness, or one from
// before version control — REQ 1066). A released harness becomes the released
// main line tagged with its revision. Anything else gets an empty `main` and a
// draft branch whose working copy is the row's current content, uncommitted.
async function ensureRepo(harness, userId, db) {
  const repo = await repoFor(harness);
  if (await vcs.getRef(repo, 'main', db)) return harness;
  if (harness.releaseState === 'released') {
    const head = await wc.seedMain(harness, userId, {}, db);
    if (!(await vcs.getRef(repo, String(harness.revision), db))) {
      await vcs.createTag(repo, String(harness.revision), head, userId, db);
    }
    await harness.update({ branchName: 'main', baseCommitHash: head, dirty: false, releaseLocked: true });
    return harness;
  }
  return vcs.inTransaction(db, async () => {
    const empty = { name: harness.name, description: harness.description || null, harnessData: {} };
    const emptyTree = await harnessSerialize(repo, empty, db);
    const head = await vcs.createCommit(repo, {
      treeHash: emptyTree, parents: [], authorUserID: userId, message: 'initial', timestamp: new Date().toISOString(),
    }, db);
    await vcs.createBranch(repo, 'main', head, userId, db);
    const revision = isNumeric(harness.revision) ? harness.revision : '01';
    const draft = `draft/${revision}`;
    await vcs.createBranch(repo, draft, head, userId, db);
    const dirty = (await harnessSerialize(repo, docOf(harness), db)) !== emptyTree;
    await harness.update({
      branchName: draft, baseCommitHash: head, dirty, releaseLocked: false, releaseState: 'draft', revision,
    });
    return harness;
  });
}

/** Switch branches, keeping the row's release state and working revision in step. */
async function switchBranch(harness, name, userId, db) {
  await branchOps.switchBranch(harness, name, userId, db);
  if (name === 'main') {
    const released = (await tagNames(harness, db)).length > 0;
    await harness.update({ releaseState: released ? 'released' : 'draft' });
  } else {
    const highest = await highestReleasedNumeric(harness, db);
    const patch = { releaseState: 'draft' };
    if (highest > 0 || !isNumeric(harness.revision)) patch.revision = padNumeric(highest + 1);
    await harness.update(patch);
  }
  return harness;
}

async function behindMain(harness, db) {
  const branch = harness.branchName || 'main';
  if (branch === 'main') return false;
  const repo = await repoFor(harness);
  const mainRef = await vcs.getRef(repo, 'main', db);
  const branchRef = await vcs.getRef(repo, branch, db);
  if (!mainRef || !branchRef) return false;
  return !(await vcs.isAncestor(repo, mainRef.targetHash, branchRef.targetHash, db));
}

// Release the checked-in draft branch onto main as the next numeric revision:
// commit + write-once tag, lock the harness as released, archive the branch.
async function releaseBranchToMain(harness, user, db) {
  const branchName = harness.branchName;
  if (!branchName || branchName === 'main') throw new RestError('Only a draft branch can be released to main', 409);
  if (harness.dirty || !harness.baseCommitHash) throw new RestError('Check in the branch before releasing it', 409);
  if (harness.lockedByUserID && harness.lockedByUserID !== user.id) {
    const holder = await dbOf(db).User.findByPk(harness.lockedByUserID);
    throw new RestError(`This branch is checked out by ${holder ? holder.displayName : 'another user'} — they must check it in or release it`, 423);
  }
  if (await behindMain(harness, db)) throw new RestError('Branch is behind main — merge main into it before releasing', 409);
  const repo = await repoFor(harness);
  const branchRef = await vcs.getRef(repo, branchName, db);
  const revision = await draftRevision(harness, db);
  harness.branchName = 'main';
  let result;
  try {
    result = await release(harness, user.id, revision, { parents: branchRef ? [branchRef.targetHash] : undefined }, db);
  } catch (err) {
    harness.branchName = branchName;
    throw err;
  }
  await harness.update({
    branchName: 'main', releaseLocked: true, revision,
    releaseState: 'released', releasedAt: new Date(), releasedBy: user.displayName || null,
    lockedByUserID: null, lockedAt: null, lockExpiresAt: null,
  });
  await vcs.deleteRef(repo, branchName, db);
  return { commitHash: result.commitHash, tag: result.tag, branch: branchName };
}

/** Clear expired locks on clean working copies (dirty ones keep attribution for takeover). */
async function sweepExpiredLocks(at, db) {
  const D = dbOf(db);
  const { Op } = D.Sequelize;
  const [count] = await D.WireHarness.update(
    { lockedByUserID: null, lockedAt: null, lockExpiresAt: null },
    { where: { lockedByUserID: { [Op.ne]: null }, lockExpiresAt: { [Op.lt]: at ? new Date(at) : new Date() }, dirty: false } },
  );
  return count;
}

module.exports = {
  DEFAULT_LOCK_TTL_MS,
  repoFor,
  docOf,
  padNumeric,
  highestReleasedNumeric,
  draftRevision,
  nextProductionRevision,
  ensureRepo,
  behindMain,
  releaseBranchToMain,
  sweepExpiredLocks,
  checkout: wc.checkout,
  renewLock: wc.renewLock,
  releaseLock: wc.releaseLock,
  undoCheckout: wc.undoCheckout,
  checkin: wc.checkin,
  history: wc.history,
  createBranch: branchOps.createBranch,
  listBranches: branchOps.listBranches,
  switchBranch,
  archiveBranch: branchOps.archiveBranch,
};
