'use strict';

// Assembly branch operations — a thin binding over the shared vcsBranchOps
// factory (create / list / switch / archive written once).

const RestError = require('../../util/RestError');
const vcs = require('./vcsService');
const { makeBranchOps } = require('./vcsBranchOps');
const { repoForAssembly } = require('./assemblyVcsService');
const { assemblySerialize, assemblyDeserialize } = require('./assemblySerializer');

const ops = makeBranchOps({
  repoFor: repoForAssembly,
  deserialize: assemblyDeserialize,
  applyDoc: (model, doc) => ({ assemblyDoc: doc }),
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
  const baseDoc = await assemblyDeserialize(repo, mainCommit.treeHash, db);   // main's latest
  const branchDoc = await assemblyDeserialize(repo, branchCommit.treeHash, db);

  const doc = JSON.parse(JSON.stringify(baseDoc));
  doc.instances = doc.instances || [];
  doc.mates = doc.mates || [];
  const branchInstances = branchDoc.instances || [];
  const branchMates = branchDoc.mates || [];

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
  return { doc, repo, branchName, mainHead: mainRef.targetHash };
}

async function reconcileBranch(assembly, sel, userId, { at } = {}, db) {
  if (assembly.dirty) throw new RestError('Check in your changes before merging', 409);
  const { doc, repo, branchName, mainHead } = await mergedReconcileDoc(assembly, assembly.branchName || 'main', sel, db);
  const treeHash = await assemblySerialize(repo, doc, db);
  const newCommit = await vcs.createCommit(repo, {
    treeHash, parents: [mainHead], authorUserID: userId,
    message: `merge main into ${branchName}`,
    timestamp: (at ? new Date(at) : new Date()).toISOString(),
  }, db);
  await vcs.updateBranch(repo, branchName, newCommit, userId, db);
  await assembly.update({ assemblyDoc: doc, baseCommitHash: newCommit, dirty: false });
  return { commitHash: newCommit, assembly };
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
  const mainDoc = await assemblyDeserialize(repo, mainCommit.treeHash, db);
  const branchDoc = await assemblyDeserialize(repo, branchCommit.treeHash, db);
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
