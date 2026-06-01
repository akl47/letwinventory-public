'use strict';

// REQ 682 (VC-14) — CAD binding for the VCS kernel. Serializes a CAD model
// document `{ featureTree, sketchDoc, equations }` into a content-addressed
// tree and reconstructs an identical document:
//   - one blob per feature   (name `feature:<id>`)
//   - one blob per sketch     (name `sketch:<id>`)
//   - one equations blob      (name `equations`)
//   - one meta blob           (name `meta`) carrying feature order + the
//     non-feature/non-sketch metadata on featureTree/sketchDoc
// Per-feature / per-sketch granularity is what gives structural sharing
// (editing one feature re-hashes only that blob + the tree) and clean
// feature-level diff / cherry-pick later. This is the only CAD-specific code
// in the VCS layer.

const vcs = require('./vcsService');

function omitKey(obj, key) {
  const out = {};
  for (const k of Object.keys(obj || {})) if (k !== key) out[k] = obj[k];
  return out;
}

/** Serialize a CAD document into the object store; returns the tree hash. */
async function cadSerialize(repo, doc, db) {
  const featureTree = (doc && doc.featureTree) || { features: [] };
  const sketchDoc = (doc && doc.sketchDoc) || { sketches: {} };
  const equations = (doc && doc.equations) || { entries: {} };
  const features = featureTree.features || [];
  const sketches = sketchDoc.sketches || {};

  const entries = [];

  // Features in declaration order (order is semantic — the feature tree).
  for (const f of features) {
    entries.push({ name: `feature:${f.id}`, kind: 'blob', hash: await vcs.writeBlob(repo, f, db) });
  }
  // Sketches sorted by id for a deterministic tree (sketch order is not semantic).
  for (const id of Object.keys(sketches).sort()) {
    entries.push({ name: `sketch:${id}`, kind: 'blob', hash: await vcs.writeBlob(repo, sketches[id], db) });
  }
  entries.push({ name: 'equations', kind: 'blob', hash: await vcs.writeBlob(repo, equations, db) });

  // Meta carries feature order + any other featureTree/sketchDoc keys
  // (nextFeatureSeq, nextSketchSeq, …) so reconstruction is lossless.
  const meta = {
    featureOrder: features.map(f => f.id),
    featureTreeMeta: omitKey(featureTree, 'features'),
    sketchDocMeta: omitKey(sketchDoc, 'sketches'),
  };
  entries.push({ name: 'meta', kind: 'blob', hash: await vcs.writeBlob(repo, meta, db) });

  return vcs.writeTree(repo, entries, db);
}

/** Reconstruct a CAD document from a tree hash. */
async function cadDeserialize(repo, treeHash, db) {
  const tree = await vcs.readTree(repo, treeHash, db);
  if (!tree) throw new Error(`VCS tree ${treeHash} not found in repo ${repo.repoType}/${repo.repoId}`);
  const byName = new Map(tree.map(e => [e.name, e.hash]));

  const getContent = async (name) => {
    const hash = byName.get(name);
    if (!hash) return null;
    const obj = await vcs.getObject(repo, hash, db);
    return obj ? obj.content : null;
  };

  const meta = (await getContent('meta')) || { featureOrder: [], featureTreeMeta: {}, sketchDocMeta: {} };

  const features = [];
  for (const id of meta.featureOrder || []) {
    const f = await getContent(`feature:${id}`);
    if (f) features.push(f);
  }

  const sketches = {};
  for (const [name, hash] of byName) {
    if (!name.startsWith('sketch:')) continue;
    const obj = await vcs.getObject(repo, hash, db);
    if (obj && obj.content) {
      const id = obj.content.id || name.slice('sketch:'.length);
      sketches[id] = obj.content;
    }
  }

  const equations = (await getContent('equations')) || { entries: {} };

  return {
    featureTree: { ...(meta.featureTreeMeta || {}), features },
    sketchDoc: { ...(meta.sketchDocMeta || {}), sketches },
    equations,
  };
}

module.exports = { cadSerialize, cadDeserialize };
