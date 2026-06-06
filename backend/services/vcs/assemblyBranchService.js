'use strict';

// Assembly branch operations — a thin binding over the shared vcsBranchOps
// factory (create / list / switch / archive written once).

const { makeBranchOps } = require('./vcsBranchOps');
const { repoForAssembly } = require('./assemblyVcsService');
const { assemblyDeserialize } = require('./assemblySerializer');

const ops = makeBranchOps({
  repoFor: repoForAssembly,
  deserialize: assemblyDeserialize,
  applyDoc: (model, doc) => ({ assemblyDoc: doc }),
});

module.exports = {
  createBranch: ops.createBranch,
  listBranches: ops.listBranches,
  switchBranch: ops.switchBranch,
  archiveBranch: ops.archiveBranch,
};
