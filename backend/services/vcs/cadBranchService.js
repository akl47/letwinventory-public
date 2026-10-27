'use strict';

// Phase 2 (REQ 692-697 / VC-24..29) — variant branches + cherry-pick over the
// working copy. Branches are mutable refs in the object store; switching loads a
// branch's committed doc into the working copy; cherry-pick is the ONLY
// cross-branch reconciliation (no merge).

const RestError = require('../../util/RestError');
const vcs = require('./vcsService');
const { repoForModel, cadVersionInfo } = require('./cadVcsService');
const { cadDeserialize, cadSerialize } = require('./cadSerializer');
const { makeBranchOps } = require('./vcsBranchOps');
const { assertEditableBy } = require('./vcsWorkingCopy');

// create / list / switch / archive are written once in vcsBranchOps; bind them
// to the CAD document. cherry-pick / reconcile / rebase below are feature-specific.
const { createBranch, listBranches, switchBranch, archiveBranch } = makeBranchOps({
  repoFor: repoForModel,
  deserialize: cadDeserialize,
  applyDoc: (model, doc) => ({ featureTree: doc.featureTree, sketchDoc: doc.sketchDoc, equations: doc.equations }),
});

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
  assertEditableBy(model, userId); // REQ 953
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

  // lastContentSavedAt — open editor sessions see the change (DOC_CONFLICT)
  // instead of overwriting it with their stale in-memory doc.
  await model.update({ featureTree, sketchDoc, dirty: true, lastContentSavedAt: new Date() });
  return { model, feature: featureId };
}

/** Is a draft branch behind main? True when main's head is NOT in the branch's
 * ancestry — i.e. main advanced (another branch was released) since this branch
 * last incorporated it. main itself is never "behind". */
async function behindMain(model, db) {
  const branchName = model.branchName || 'main';
  if (branchName === 'main') return false;
  const repo = await repoForModel(model, db);
  const mainRef = await vcs.getRef(repo, 'main', db);
  const branchRef = await vcs.getRef(repo, branchName, db);
  if (!mainRef || !branchRef) return false;
  return !(await vcs.isAncestor(repo, mainRef.targetHash, branchRef.targetHash, db)); // REQ 969
}

/** Merge main into a branch by reconciling at the feature level: start from
 * main's CURRENT doc (its latest features) and apply the SELECTED features from
 * the branch — each `featureId` present in the branch is spliced in (add/replace,
 * with its referenced sketches); each selected id absent from the branch is a
 * branch deletion and is removed from the base. The result is committed onto the
 * branch with main's head as parent, so the branch is up to date AND carries
 * main's latest plus the chosen branch changes. This is the supported 3-way
 * reconciliation (no automatic whole-tree merge). */
// Build the reconciled doc WITHOUT committing — main's current doc with the
// selected branch features spliced in. Returns the merged doc + repo + mainHead.
// Used by both the merge commit and the live 3D preview.
// `sel` = { featureIds, sketchIds } — the differing items the user chose to take
// from the branch. Each selected item gets the BRANCH's version applied onto
// main (added / replaced, or removed if the branch deleted it); everything
// unselected keeps main's version. Accepts a bare array for back-compat (treated
// as featureIds).
async function mergedReconcileDoc(model, branchName, sel, db) {
  const selection = Array.isArray(sel) ? { featureIds: sel, sketchIds: [] } : (sel || {});
  const featureIds = selection.featureIds || [];
  const sketchIds = selection.sketchIds || [];
  // REQ 955 — equations (global variables) are mergeable too. `equationNames`
  // = differing variables the user chose to take from the branch. When the
  // caller sends no list, branch-ONLY variables are still carried (they can't
  // be a main-side change), so a merge never silently drops a new variable.
  const equationNames = Array.isArray(selection.equationNames) ? selection.equationNames : null;
  if (!branchName || branchName === 'main') throw new RestError('Cannot merge into main directly', 409);
  const repo = await repoForModel(model, db);
  const mainRef = await vcs.getRef(repo, 'main', db);
  const branchRef = await vcs.getRef(repo, branchName, db);
  if (!mainRef || !branchRef) throw new RestError('main or branch not found', 404);

  const mainCommit = await vcs.getCommit(repo, mainRef.targetHash, db);
  const branchCommit = await vcs.getCommit(repo, branchRef.targetHash, db);
  const baseDoc = await cadDeserialize(repo, mainCommit.treeHash, db);     // main's latest
  const branchDoc = await cadDeserialize(repo, branchCommit.treeHash, db); // the branch

  const featureTree = JSON.parse(JSON.stringify(baseDoc.featureTree || { features: [] }));
  const sketchDoc = JSON.parse(JSON.stringify(baseDoc.sketchDoc || { sketches: {} }));
  const features = featureTree.features || (featureTree.features = []);
  const sketches = sketchDoc.sketches || (sketchDoc.sketches = {});
  const branchSketches = (branchDoc.sketchDoc && branchDoc.sketchDoc.sketches) || {};

  for (const fid of new Set(featureIds)) {
    const branchFeature = (branchDoc.featureTree.features || []).find((f) => f.id === fid);
    const idx = features.findIndex((f) => f.id === fid);
    if (branchFeature) {
      if (idx >= 0) features[idx] = branchFeature; else features.push(branchFeature);
      for (const sid of referencedSketchIds(branchFeature)) if (branchSketches[sid]) sketches[sid] = branchSketches[sid];
    } else if (idx >= 0) {
      features.splice(idx, 1); // branch removed it → apply the removal
    }
  }
  // Sketches chosen independently (e.g. a sketch edited without changing the
  // feature that consumes it): take the branch's version, or drop it if the
  // branch deleted it.
  for (const sid of new Set(sketchIds)) {
    if (branchSketches[sid]) sketches[sid] = branchSketches[sid];
    else if (sketches[sid]) delete sketches[sid];
  }
  const equations = JSON.parse(JSON.stringify(baseDoc.equations || { entries: {} }));
  equations.entries = equations.entries || {};
  const branchEntries = (branchDoc.equations && branchDoc.equations.entries) || {};
  const names = equationNames || Object.keys(branchEntries).filter((n) => !(n in equations.entries));
  for (const name of new Set(names)) {
    if (name in branchEntries) equations.entries[name] = branchEntries[name];
    else delete equations.entries[name]; // branch removed it → apply the removal
  }
  return {
    featureTree, sketchDoc, equations, repo, branchName,
    mainHead: mainRef.targetHash,
    // REQ 954 — the CAS anchor is the branch head this doc was built from.
    branchHead: branchRef.targetHash,
  };
}

async function reconcileBranch(model, sel, userId, { at } = {}, db) {
  assertEditableBy(model, userId); // REQ 954
  if (model.dirty) throw new RestError('Check in your changes before merging', 409);
  const { featureTree, sketchDoc, equations, repo, branchName, mainHead, branchHead } = await mergedReconcileDoc(model, model.branchName || 'main', sel, db);
  const treeHash = await cadSerialize(repo, { featureTree, sketchDoc, equations }, db);
  const newCommit = await vcs.inTransaction(db, async () => {
    const commit = await vcs.createCommit(repo, {
      treeHash,
      parents: [mainHead],
      authorUserID: userId,
      message: `merge main into ${branchName}`,
      timestamp: (at ? new Date(at) : new Date()).toISOString(),
      meta: cadVersionInfo(),
    }, db);
    try {
      await vcs.updateBranch(repo, branchName, commit, userId, db, branchHead);
    } catch (err) {
      if (err.code === 'REF_MOVED') throw new RestError(err.message, 409);
      throw err;
    }
    await model.update({ featureTree, sketchDoc, equations, baseCommitHash: commit, dirty: false, lastContentSavedAt: new Date() });
    return commit;
  });
  const selection = Array.isArray(sel) ? { featureIds: sel, sketchIds: [] } : (sel || {});
  return { model, commitHash: newCommit, applied: { featureIds: [...new Set(selection.featureIds || [])], sketchIds: [...new Set(selection.sketchIds || [])], equationNames: [...new Set(selection.equationNames || [])] } };
}

module.exports = { createBranch, listBranches, switchBranch, archiveBranch, cherryPick, referencedSketchIds, behindMain, reconcileBranch, mergedReconcileDoc };
