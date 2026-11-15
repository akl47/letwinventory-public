'use strict';

// VCS binding for wire harnesses — serializes the harness document
// `{ name, description, harnessData }` into a content-addressed tree and
// reconstructs an identical document:
//   - one blob per connector      (name `connector:<id>`)
//   - one blob per cable          (name `cable:<id>`)
//   - one blob per component      (name `component:<id>`)
//   - one blob per connection     (name `connection:<id>`)
//   - one blob per sub-harness    (name `subharness:<id>`)
//   - one meta blob               (name `meta`) carrying element order, name,
//     description and every other harnessData field (groups, canvas settings…)
// Per-element granularity gives structural sharing and a per-element diff —
// the harness analogue of cadSerializer / assemblySerializer.

const vcs = require('./vcsService');

// harnessData key → blob name prefix.
const COLLECTIONS = [
  ['connectors', 'connector'],
  ['cables', 'cable'],
  ['components', 'component'],
  ['connections', 'connection'],
  ['subHarnesses', 'subharness'],
];

// Row-derived fields the editor echoes into harnessData — they describe the
// working copy, not the design, so they are never versioned.
const VOLATILE = ['partNumber', 'revision', 'releaseState'];

/** Serialize a harness document into the object store; returns the tree hash. */
async function harnessSerialize(repo, doc, db) {
  const data = (doc && doc.harnessData) || {};
  const entries = [];
  const order = {};
  for (const [key, prefix] of COLLECTIONS) {
    if (!Array.isArray(data[key])) continue;
    const items = data[key];
    order[key] = items.map((item) => item.id);
    for (const item of items) {
      entries.push({ name: `${prefix}:${item.id}`, kind: 'blob', hash: await vcs.writeBlob(repo, item, db) });
    }
  }
  const rest = {};
  for (const k of Object.keys(data)) {
    if (COLLECTIONS.some(([key]) => key === k) || VOLATILE.includes(k)) continue;
    rest[k] = data[k];
  }
  const meta = { name: (doc && doc.name) || null, description: (doc && doc.description) || null, order, rest };
  entries.push({ name: 'meta', kind: 'blob', hash: await vcs.writeBlob(repo, meta, db) });
  return vcs.writeTree(repo, entries, db);
}

/** Reconstruct a harness document from a tree hash. */
async function harnessDeserialize(repo, treeHash, db) {
  const tree = await vcs.readTree(repo, treeHash, db);
  if (!tree) throw new Error(`VCS tree ${treeHash} not found in repo ${repo.repoType}/${repo.repoId}`);
  const byName = new Map(tree.map((e) => [e.name, e.hash]));
  const getContent = async (name) => {
    const hash = byName.get(name);
    if (!hash) return null;
    const obj = await vcs.getObject(repo, hash, db);
    return obj ? obj.content : null;
  };

  const meta = (await getContent('meta')) || { order: {}, rest: {} };
  const harnessData = { ...(meta.rest || {}) };
  for (const [key, prefix] of COLLECTIONS) {
    if (!(meta.order && key in meta.order)) continue;
    const items = [];
    for (const id of meta.order[key]) {
      const item = await getContent(`${prefix}:${id}`);
      if (item) items.push(item);
    }
    harnessData[key] = items;
  }
  return { name: meta.name || null, description: meta.description || null, harnessData };
}

module.exports = { harnessSerialize, harnessDeserialize };
