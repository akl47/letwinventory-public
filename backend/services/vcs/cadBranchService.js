'use strict';

// Phase 2 (REQ 692-697 / VC-24..29) — variant branches + cherry-pick over the
// working copy. Branches are mutable refs in the object store; switching loads a
// branch's committed doc into the working copy; cherry-pick is the ONLY
// cross-branch reconciliation (no merge).

const RestError = require('../../util/RestError');
const vcs = require('./vcsService');
const { repoForModel } = require('./cadVcsService');
const { cadDeserialize } = require('./cadSerializer');

/** Create a named branch at a commit (default: the current branch head). */
async function createBranch(model, name, { fromCommit } = {}, userId = null, db) {
  const repo = await repoForModel(model, db);
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

/** List a model repository's branches. */
async function listBranches(model, db) {
  const repo = await repoForModel(model, db);
  return vcs.listRefs(repo, 'branch', db);
}

/** Switch the working copy to another branch — load that branch's head doc in.
 * Rejected while the working copy has uncommitted changes. */
async function switchBranch(model, name, userId = null, db) {
  if (model.dirty) throw new RestError('Check in your changes before switching branches', 409);
  const repo = await repoForModel(model, db);
  const ref = await vcs.getRef(repo, name, db);
  if (!ref || ref.kind !== 'branch') throw new RestError(`Branch "${name}" does not exist`, 404);
  const commit = await vcs.getCommit(repo, ref.targetHash, db);
  if (!commit) throw new RestError(`Branch "${name}" has no commit yet`, 400);
  const doc = await cadDeserialize(repo, commit.treeHash, db);
  await model.update({
    branchName: name,
    baseCommitHash: ref.targetHash,
    dirty: false,
    featureTree: doc.featureTree,
    sketchDoc: doc.sketchDoc,
    equations: doc.equations,
  });
  return model;
}

/** Archive (remove) a branch ref. The current branch and `main` are protected. */
async function archiveBranch(model, name, db) {
  if (name === (model.branchName || 'main')) throw new RestError('Cannot archive the current branch', 409);
  if (name === 'main') throw new RestError('Cannot archive the default branch', 409);
  const repo = await repoForModel(model, db);
  const ref = await vcs.getRef(repo, name, db);
  if (!ref || ref.kind !== 'branch') throw new RestError(`Branch "${name}" does not exist`, 404);
  await vcs.deleteRef(repo, name, db);
  return { archived: name };
}

/** Sketch ids a feature references (sketchId / sketchIds / *SketchId fields). */
function referencedSketchIds(feature) {
  const ids = new Set();
  if (feature.sketchId) ids.add(feature.sketchId);
  if (Array.isArray(feature.sketchIds)) for (const s of feature.sketchIds) if (s) ids.add(s);
  for (const [k, v] of Object.entries(feature)) {
    if (typeof v === 'string' && v && /sketchId$/i.test(k)) ids.add(v);
  }
  return [...ids];
}

/** Cherry-pick a single feature from a source commit into the working copy:
 * splice the feature (replacing one with the same id, else appended) and the
 * sketches it references, and mark dirty. No merge of histories (VC-28/29). */
async function cherryPick(model, sourceCommit, featureId, userId = null, db) {
  const repo = await repoForModel(model, db);
  const commit = await vcs.getCommit(repo, sourceCommit, db);
  if (!commit) throw new RestError(`Commit ${sourceCommit} not found`, 404);
  const sourceDoc = await cadDeserialize(repo, commit.treeHash, db);
  const feature = (sourceDoc.featureTree.features || []).find(f => f.id === featureId);
  if (!feature) throw new RestError(`Feature ${featureId} not found in commit ${sourceCommit}`, 404);

  const featureTree = JSON.parse(JSON.stringify(model.featureTree || { features: [] }));
  const sketchDoc = JSON.parse(JSON.stringify(model.sketchDoc || { sketches: {} }));
  const features = featureTree.features || (featureTree.features = []);
  const idx = features.findIndex(f => f.id === featureId);
  if (idx >= 0) features[idx] = feature; else features.push(feature);

  const sketches = sketchDoc.sketches || (sketchDoc.sketches = {});
  const srcSketches = (sourceDoc.sketchDoc && sourceDoc.sketchDoc.sketches) || {};
  for (const sid of referencedSketchIds(feature)) {
    if (srcSketches[sid]) sketches[sid] = srcSketches[sid];
  }

  await model.update({ featureTree, sketchDoc, dirty: true });
  return { model, feature: featureId };
}

module.exports = { createBranch, listBranches, switchBranch, archiveBranch, cherryPick, referencedSketchIds };
