'use strict';

// REQ 689 (VC-21) — one-time, idempotent import of existing CAD models into the
// VCS object store. For each active model we serialize its current document and
// create an initial commit on the model's branch (chained onto whatever the
// repo's branch head already is, so multiple revisions of one part form a
// continuous history), set the working copy's baseCommitHash, and tag released
// models with their revision. Non-destructive: revision/releaseState columns are
// untouched (their retirement is a later step).
//
// Run via `node backend/scripts/migrate-cad-to-vcs.js`. Safe to re-run — a model
// whose branch head already matches its serialized tree is skipped.

const vcs = require('./vcsService');
const cadvcs = require('./cadVcsService');
const { cadSerialize } = require('./cadSerializer');

function dbOf(db) { return db || global.db; }

/** Import a single model into its repo. Returns { repo, commitHash, created }. */
async function migrateModelToVcs(model, db) {
  const repo = await cadvcs.repoForModel(model, db);
  const branch = model.branchName || 'main';
  const doc = {
    featureTree: model.featureTree,
    sketchDoc: model.sketchDoc,
    equations: model.equations || { entries: {} },
  };
  const treeHash = await cadSerialize(repo, doc, db);
  const head = await vcs.getRef(repo, branch, db);

  // Idempotent: if the branch head already captures this exact tree, just make
  // sure the working copy points at it.
  if (head) {
    const headCommit = await vcs.getCommit(repo, head.targetHash, db);
    if (headCommit && headCommit.treeHash === treeHash) {
      if (model.baseCommitHash !== head.targetHash) {
        await model.update({ baseCommitHash: head.targetHash, dirty: false, branchName: branch });
      }
      return { repo, commitHash: head.targetHash, created: false };
    }
  }

  const author = model.createdByUserID || null;
  const commitHash = await vcs.createCommit(repo, {
    treeHash,
    parents: head ? [head.targetHash] : [],
    authorUserID: author,
    message: head ? `migrate revision ${model.revision || ''}`.trim() : 'initial import (migrated)',
    timestamp: (model.updatedAt ? new Date(model.updatedAt) : new Date()).toISOString(),
    meta: cadvcs.cadVersionInfo(),
  }, db);
  if (head) await vcs.updateBranch(repo, branch, commitHash, author, db);
  else await vcs.createBranch(repo, branch, commitHash, author, db);
  await model.update({ baseCommitHash: commitHash, dirty: false, branchName: branch });

  // Released models become a write-once tag named for their revision (VC-18).
  if (model.releaseState === 'released' && model.revision) {
    const tagName = String(model.revision);
    if (!(await vcs.getRef(repo, tagName, db))) {
      await vcs.createTag(repo, tagName, commitHash, author, db);
    }
  }

  return { repo, commitHash, created: true };
}

/** Import every active model. Processes in id order so revisions of one part
 * chain in creation order. Returns { total, created }. */
async function migrateAll(db) {
  const D = dbOf(db);
  const models = await D.DesignCADModel.findAll({ where: { activeFlag: true }, order: [['id', 'ASC']] });
  let created = 0;
  for (const m of models) {
    const r = await migrateModelToVcs(m, db);
    if (r.created) created++;
  }
  return { total: models.length, created };
}

module.exports = { migrateModelToVcs, migrateAll };
