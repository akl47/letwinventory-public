'use strict';

// VCS binding for assemblies — serializes an `assemblyDoc`
// `{ nextInstanceSeq, nextMateSeq, instances, mates }` into a content-addressed
// tree and reconstructs an identical document:
//   - one blob per component instance (name `instance:<instanceId>`)
//   - one blob per mate              (name `mate:<mateId>`)
//   - one meta blob                  (name `meta`) carrying instance/mate order
//     + the doc-level counters
// Per-instance / per-mate granularity gives structural sharing (editing one
// component re-hashes only that blob + the tree) and clean per-component diff
// later — the assembly analogue of cadSerializer.

const vcs = require('./vcsService');

const mateKey = (m) => m.mateId || m.id;

/** Serialize an assembly document into the object store; returns the tree hash. */
async function assemblySerialize(repo, assemblyDoc, db) {
  const doc = assemblyDoc || {};
  const instances = doc.instances || [];
  const mates = doc.mates || [];

  const entries = [];
  // Instances in declaration order (order is not strictly semantic, but kept
  // stable for deterministic trees).
  for (const inst of instances) {
    entries.push({ name: `instance:${inst.instanceId}`, kind: 'blob', hash: await vcs.writeBlob(repo, inst, db) });
  }
  for (const m of mates) {
    entries.push({ name: `mate:${mateKey(m)}`, kind: 'blob', hash: await vcs.writeBlob(repo, m, db) });
  }
  const meta = {
    instanceOrder: instances.map((i) => i.instanceId),
    mateOrder: mates.map(mateKey),
    docMeta: { nextInstanceSeq: doc.nextInstanceSeq, nextMateSeq: doc.nextMateSeq },
  };
  entries.push({ name: 'meta', kind: 'blob', hash: await vcs.writeBlob(repo, meta, db) });

  return vcs.writeTree(repo, entries, db);
}

/** Reconstruct an assembly document from a tree hash. */
async function assemblyDeserialize(repo, treeHash, db) {
  const tree = await vcs.readTree(repo, treeHash, db);
  if (!tree) throw new Error(`VCS tree ${treeHash} not found in repo ${repo.repoType}/${repo.repoId}`);
  const byName = new Map(tree.map((e) => [e.name, e.hash]));

  const getContent = async (name) => {
    const hash = byName.get(name);
    if (!hash) return null;
    const obj = await vcs.getObject(repo, hash, db);
    return obj ? obj.content : null;
  };

  const meta = (await getContent('meta')) || { instanceOrder: [], mateOrder: [], docMeta: {} };

  const instances = [];
  for (const id of meta.instanceOrder || []) {
    const inst = await getContent(`instance:${id}`);
    if (inst) instances.push(inst);
  }
  const mates = [];
  for (const id of meta.mateOrder || []) {
    const m = await getContent(`mate:${id}`);
    if (m) mates.push(m);
  }

  const docMeta = meta.docMeta || {};
  return {
    nextInstanceSeq: docMeta.nextInstanceSeq != null ? docMeta.nextInstanceSeq : instances.length + 1,
    nextMateSeq: docMeta.nextMateSeq != null ? docMeta.nextMateSeq : mates.length + 1,
    instances,
    mates,
  };
}

module.exports = { assemblySerialize, assemblyDeserialize };
