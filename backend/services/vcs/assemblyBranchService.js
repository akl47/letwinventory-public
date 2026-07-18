'use strict';

// Assembly branch operations — a thin binding over the shared vcsBranchOps
// factory (create / list / switch / archive written once).

const RestError = require('../../util/RestError');
const vcs = require('./vcsService');
const { makeBranchOps } = require('./vcsBranchOps');
const { repoForAssembly, applyBundle } = require('./assemblyVcsService');
const { assemblySerialize, assemblyDeserialize } = require('./assemblySerializer');

const ops = makeBranchOps({
  repoFor: repoForAssembly,
  deserialize: assemblyDeserialize,
  applyDoc: applyBundle,  // REQ 913 — restores skeleton columns too
});

const mateKey = (m) => m.mateId || m.id;

// Feature-level merge (the assembly analogue of cadBranchService): start from
// main's CURRENT doc and splice in the SELECTED branch instances/mates (add or
// replace; a selected id absent from the branch = a branch deletion → removed),
// then commit onto the branch with parents=[mainHead]. So the branch gets main's
// latest + the chosen branch changes.
async function mergedReconcileDoc(assembly, branchName, sel, db) {
  const selection = Array.isArray(sel) ? { instanceIds: sel, mateIds: [] } : (sel || {});
  const instanceIds = selection.instanceIds || [];
  const mateIds = selection.mateIds || [];
  if (!branchName || branchName === 'main') throw new RestError('Cannot merge into main directly', 409);
  const repo = await repoForAssembly(assembly, db);
  const mainRef = await vcs.getRef(repo, 'main', db);
  const branchRef = await vcs.getRef(repo, branchName, db);
  if (!mainRef || !branchRef) throw new RestError('main or branch not found', 404);

  const mainCommit = await vcs.getCommit(repo, mainRef.targetHash, db);
  const branchCommit = await vcs.getCommit(repo, branchRef.targetHash, db);
  const baseBundle = await assemblyDeserialize(repo, mainCommit.treeHash, db);   // main's latest
  const branchBundle = await assemblyDeserialize(repo, branchCommit.treeHash, db);

  // Merged bundle: main's latest assemblyDoc + selected branch instance/mate
  // changes. The SKELETON (sketchDoc/featureTree/equations) comes from the
  // BRANCH — the merge commit lands on the branch, and the branch's skeleton
  // work-in-progress must survive the reconcile (REQ 913). Main-side skeleton
  // edits are branch-wins here, same last-writer semantics as the part-CAD
  // reconcile's unselected content.
  const doc = JSON.parse(JSON.stringify(baseBundle.assemblyDoc || {}));
  doc.instances = doc.instances || [];
  doc.mates = doc.mates || [];
  const branchInstances = (branchBundle.assemblyDoc && branchBundle.assemblyDoc.instances) || [];
  const branchMates = (branchBundle.assemblyDoc && branchBundle.assemblyDoc.mates) || [];

  for (const iid of new Set(instanceIds)) {
    const bi = branchInstances.find((i) => i.instanceId === iid);
    const idx = doc.instances.findIndex((i) => i.instanceId === iid);
    if (bi) { if (idx >= 0) doc.instances[idx] = bi; else doc.instances.push(bi); }
    else if (idx >= 0) doc.instances.splice(idx, 1);
  }
  for (const mid of new Set(mateIds)) {
    const bm = branchMates.find((m) => mateKey(m) === mid);
    const idx = doc.mates.findIndex((m) => mateKey(m) === mid);
    if (bm) { if (idx >= 0) doc.mates[idx] = bm; else doc.mates.push(bm); }
    else if (idx >= 0) doc.mates.splice(idx, 1);
  }
  const bundle = {
    assemblyDoc: doc,
    sketchDoc: branchBundle.sketchDoc,
    featureTree: branchBundle.featureTree,
    equations: branchBundle.equations,
  };
  return { bundle, repo, branchName, mainHead: mainRef.targetHash };
}

async function reconcileBranch(assembly, sel, userId, { at } = {}, db) {
  if (assembly.dirty) throw new RestError('Check in your changes before merging', 409);
  const { bundle, repo, branchName, mainHead } = await mergedReconcileDoc(assembly, assembly.branchName || 'main', sel, db);
  // CAS anchor: the branch head the merged doc was computed against (REQ 901).
  const branchRefAtMerge = await vcs.getRef(repo, branchName, db);
  const treeHash = await assemblySerialize(repo, bundle, db);
  return vcs.inTransaction(db, async () => {
    const newCommit = await vcs.createCommit(repo, {
      treeHash, parents: [mainHead], authorUserID: userId,
      message: `merge main into ${branchName}`,
      timestamp: (at ? new Date(at) : new Date()).toISOString(),
    }, db);
    try {
      await vcs.updateBranch(repo, branchName, newCommit, userId, db,
        branchRefAtMerge ? branchRefAtMerge.targetHash : undefined);
    } catch (err) {
      if (err.code === 'REF_MOVED') throw new RestError(err.message, 409);
      throw err;
    }
    await assembly.update({ ...applyBundle(assembly, bundle), baseCommitHash: newCommit, dirty: false });
    return { commitHash: newCommit, assembly };
  });
}

// The instances/mates that differ between main and the branch (for the merge
// picker). Returns [{ kind:'instance'|'mate', id }].
async function reconcileChanges(assembly, db) {
  const branchName = assembly.branchName || 'main';
  if (branchName === 'main') return [];
  const repo = await repoForAssembly(assembly, db);
  const mainRef = await vcs.getRef(repo, 'main', db);
  const branchRef = await vcs.getRef(repo, branchName, db);
  if (!mainRef || !branchRef) return [];
  const mainCommit = await vcs.getCommit(repo, mainRef.targetHash, db);
  const branchCommit = await vcs.getCommit(repo, branchRef.targetHash, db);
  const mainDoc = (await assemblyDeserialize(repo, mainCommit.treeHash, db)).assemblyDoc;
  const branchDoc = (await assemblyDeserialize(repo, branchCommit.treeHash, db)).assemblyDoc;
  const out = [];
  const im = new Map((mainDoc.instances || []).map((i) => [i.instanceId, JSON.stringify(i)]));
  const ib = new Map((branchDoc.instances || []).map((i) => [i.instanceId, JSON.stringify(i)]));
  for (const id of new Set([...im.keys(), ...ib.keys()])) if (im.get(id) !== ib.get(id)) out.push({ kind: 'instance', id });
  const mm = new Map((mainDoc.mates || []).map((m) => [mateKey(m), JSON.stringify(m)]));
  const mb = new Map((branchDoc.mates || []).map((m) => [mateKey(m), JSON.stringify(m)]));
  for (const id of new Set([...mm.keys(), ...mb.keys()])) if (mm.get(id) !== mb.get(id)) out.push({ kind: 'mate', id });
  return out;
}

module.exports = {
  createBranch: ops.createBranch,
  listBranches: ops.listBranches,
  switchBranch: ops.switchBranch,
  archiveBranch: ops.archiveBranch,
  mergedReconcileDoc,
  reconcileBranch,
  reconcileChanges,
};
