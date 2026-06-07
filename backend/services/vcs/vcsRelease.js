'use strict';

// Generic "release the working copy as a revision" — written once for every
// version-controlled document (VC-18). Commit the current doc, freeze its
// geometry into that commit, create a write-once tag named for the revision, and
// advance the branch. Only the serializer / freeze / commit-meta differ, via a
// binding:
//
//   binding = {
//     repoFor(model, db),
//     serialize(repo, doc, db),     // cadSerializer | assemblySerializer
//     docOf(model),
//     freeze,                       // { freezeGeometry(repo, model, opts, db) }
//     commitMeta(),                 // namingVersion etc.
//   }

const RestError = require('../../util/RestError');
const vcs = require('./vcsService');

function nowAt(at) { return at ? new Date(at) : new Date(); }

function makeRelease(binding) {
  async function release(model, userId, revisionLabel, { kernelClient, at, parents } = {}, db) {
    const repo = await binding.repoFor(model, db);
    const branch = model.branchName || 'main';
    const tag = String(revisionLabel);

    // Write-once: refuse a re-release BEFORE mutating anything, so a raced or
    // double-clicked release can't orphan a duplicate commit past the tag.
    if (await vcs.getRef(repo, tag, db)) {
      throw new RestError(`Revision ${tag} has already been released (tags are write-once)`, 409);
    }

    const treeHash = await binding.serialize(repo, binding.docOf(model), db);
    const head = await vcs.getRef(repo, branch, db);
    const frozen = await binding.freeze.freezeGeometry(repo, model, { kernelClient }, db);
    // `parents` override lets a branch→main release chain off the BRANCH head so
    // the branch's commits become ancestors of main (git-style merge).
    const commitParents = parents || (head ? [head.targetHash] : []);
    const commitHash = await vcs.createCommit(repo, {
      treeHash,
      parents: commitParents,
      authorUserID: userId,
      message: `release ${revisionLabel}`,
      timestamp: nowAt(at).toISOString(),
      meta: { ...(binding.commitMeta ? binding.commitMeta() : {}), frozen },
    }, db);
    // Claim the write-once tag BEFORE advancing the branch (race-safe).
    await vcs.createTag(repo, tag, commitHash, userId, db);
    if (head) await vcs.updateBranch(repo, branch, commitHash, userId, db);
    else await vcs.createBranch(repo, branch, commitHash, userId, db);
    await model.update({ baseCommitHash: commitHash, dirty: false });
    return { commitHash, tag };
  }

  return { release };
}

module.exports = { makeRelease };
