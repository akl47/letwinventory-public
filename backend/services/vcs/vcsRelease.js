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

    // Freeze OUTSIDE the transaction: it drives a full kernel regeneration
    // (seconds), and its objects are content-addressed — an aborted release
    // leaves only unreachable objects for GC, never inconsistency.
    const treeHash = await binding.serialize(repo, binding.docOf(model), db);
    const frozen = await binding.freeze.freezeGeometry(repo, model, { kernelClient }, db);

    // Atomic + compare-and-swap (REQ 901): commit, write-once tag, ref
    // advance, and model row land together; the ref only advances from the
    // head this release chained on, and a raced duplicate tag rolls the
    // whole release back (unique ref index turns the race into an error).
    return vcs.inTransaction(db, async () => {
      const head = await vcs.getRef(repo, branch, db);
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
      await vcs.createTag(repo, tag, commitHash, userId, db);
      try {
        if (head) await vcs.updateBranch(repo, branch, commitHash, userId, db, head.targetHash);
        else await vcs.createBranch(repo, branch, commitHash, userId, db);
      } catch (err) {
        if (err.code === 'REF_MOVED') throw new RestError(err.message, 409);
        throw err;
      }
      await model.update({ baseCommitHash: commitHash, dirty: false });
      return { commitHash, tag };
    });
  }

  return { release };
}

module.exports = { makeRelease };
