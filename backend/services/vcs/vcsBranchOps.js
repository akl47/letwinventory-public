'use strict';

// Generic branch operations (create / list / switch / archive) shared by every
// version-controlled document. Only the repo key and how a branch's committed
// doc is loaded back into the working copy differ — supplied by a binding:
//
//   binding = {
//     repoFor(model, db),            // async → { repoType, repoId }
//     deserialize(repo, hash, db),   // async → document
//     applyDoc(model, doc),          // → model.update patch restoring the doc
//   }
//
// (cherry-pick / reconcile / rebase are content-specific and stay in the
// per-document service.)

const RestError = require('../../util/RestError');
const vcs = require('./vcsService');

function makeBranchOps(binding) {
  // Create a named branch at a commit (default: the current branch head).
  async function createBranch(model, name, { fromCommit } = {}, userId = null, db) {
    const repo = await binding.repoFor(model, db);
    let commitHash = fromCommit;
    if (!commitHash) {
      const head = await vcs.getRef(repo, model.branchName || 'main', db);
      commitHash = head && head.targetHash;
    }
    if (!commitHash) throw new RestError('Cannot create a branch before the first check-in', 400);
    if (await vcs.getRef(repo, name, db)) throw new RestError(`A ref named "${name}" already exists`, 409);
    await vcs.createBranch(repo, name, commitHash, userId, db);
    return { name, targetHash: commitHash };
  }

  // List the repository's branches.
  async function listBranches(model, db) {
    const repo = await binding.repoFor(model, db);
    return vcs.listRefs(repo, 'branch', db);
  }

  // Switch the working copy to another branch — load that branch's head doc in.
  // Rejected while the working copy has uncommitted changes.
  async function switchBranch(model, name, userId = null, db) {
    if (model.dirty) throw new RestError('Check in your changes before switching branches', 409);
    const repo = await binding.repoFor(model, db);
    const ref = await vcs.getRef(repo, name, db);
    if (!ref || ref.kind !== 'branch') throw new RestError(`Branch "${name}" does not exist`, 404);
    const commit = await vcs.getCommit(repo, ref.targetHash, db);
    if (!commit) throw new RestError(`Branch "${name}" has no commit yet`, 400);
    const doc = await binding.deserialize(repo, commit.treeHash, db);
    await model.update({
      branchName: name,
      baseCommitHash: ref.targetHash,
      dirty: false,
      // main is the protected/released line; a draft branch is editable.
      releaseLocked: name === 'main',
      ...binding.applyDoc(model, doc),
    });
    return model;
  }

  // Archive (remove) a branch ref. The current branch and `main` are protected.
  async function archiveBranch(model, name, db) {
    if (name === (model.branchName || 'main')) throw new RestError('Cannot archive the current branch', 409);
    if (name === 'main') throw new RestError('Cannot archive the default branch', 409);
    const repo = await binding.repoFor(model, db);
    const ref = await vcs.getRef(repo, name, db);
    if (!ref || ref.kind !== 'branch') throw new RestError(`Branch "${name}" does not exist`, 404);
    await vcs.deleteRef(repo, name, db);
    return { archived: name };
  }

  return { createBranch, listBranches, switchBranch, archiveBranch };
}

module.exports = { makeBranchOps };
