'use strict';

// Version-graph builder for the part's CAD history UI (D1 timeline / D4 table).
// Walks every branch ref, collects all reachable commits, assigns each a lane
// (main vs an experiment branch), attaches release tags, the current HEAD, and
// resolved author info. The per-node "what changed" diff is computed on demand
// by cadDiffService.commitDiff — not bundled here.

const vcs = require('./vcsService');
const { repoForModel } = require('./cadVcsService');

function dbOf(db) { return db || global.db; }

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Build the full version graph for a model. Returns
 * `{ head, branches: [{name, head}], nodes: [...] }`, newest node first. */
async function buildGraph(model, db) {
  return buildGraphForRepo(await repoForModel(model, db), model.baseCommitHash, db);
}

// Repo-keyed graph builder — usable for any document repo (CAD or assembly).
// `headHash` marks the working copy's current commit (else falls back to main).
async function buildGraphForRepo(repo, headHash, db) {
  const D = dbOf(db);
  const branches = await vcs.listRefs(repo, 'branch', db);
  const tags = await vcs.listRefs(repo, 'tag', db);

  const tagsByCommit = {};
  for (const t of tags) (tagsByCommit[t.targetHash] = tagsByCommit[t.targetHash] || []).push(t.name);

  // Collect every commit reachable from any branch tip.
  const commitMap = new Map();
  for (const b of branches) {
    for (const c of await vcs.log(repo, b.name, db)) {
      if (!commitMap.has(c.hash)) commitMap.set(c.hash, c);
    }
  }

  // Lane assignment: everything reachable from `main` is on the main lane; any
  // commit reachable only from another branch takes that branch's lane.
  const mainBranch = branches.find(b => b.name === 'main') || branches[0];
  const laneOf = new Map();
  if (mainBranch) {
    for (const c of await vcs.log(repo, mainBranch.name, db)) laneOf.set(c.hash, 'main');
  }
  for (const b of branches) {
    if (!mainBranch || b.name === mainBranch.name) continue;
    for (const c of await vcs.log(repo, b.name, db)) if (!laneOf.has(c.hash)) laneOf.set(c.hash, b.name);
  }

  const headCommit = headHash || (mainBranch && mainBranch.targetHash) || null;

  // Resolve authors in one query.
  const authorIds = [...new Set([...commitMap.values()].map(c => c.authorUserID).filter(Boolean))];
  const users = authorIds.length ? await D.User.findAll({ where: { id: authorIds } }) : [];
  const userById = new Map(users.map(u => [u.id, u]));

  const nodes = [...commitMap.values()]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) // newest first
    .map(c => {
      const branch = laneOf.get(c.hash) || 'main';
      const tagList = tagsByCommit[c.hash] || [];
      const u = c.authorUserID ? userById.get(c.authorUserID) : null;
      return {
        hash: c.hash,
        shortHash: c.hash.slice(0, 4),
        parents: c.parents || [],
        message: c.message || '',
        timestamp: c.timestamp,
        branch,
        lane: branch === 'main' ? 'main' : 'exp',
        tags: tagList,
        isHead: c.hash === headCommit,
        author: u ? { id: u.id, name: u.displayName, initials: initialsOf(u.displayName) } : null,
        state: tagList.length ? 'released' : 'draft',
      };
    });

  return {
    head: headCommit,
    branches: branches.map(b => ({ name: b.name, head: b.targetHash })),
    nodes,
  };
}

module.exports = { buildGraph, buildGraphForRepo, initialsOf };
