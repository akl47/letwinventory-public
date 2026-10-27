'use strict';

// VCS binding for assemblies — serializes the assembly document bundle
// `{ assemblyDoc, sketchDoc, featureTree, equations }` into a content-addressed
// tree and reconstructs an identical bundle:
//   - one blob per component instance (name `instance:<instanceId>`)
//   - one blob per mate              (name `mate:<mateId>`)
//   - one blob per skeleton sketch   (name `sketch:<id>`)     — REQ 913
//   - one blob per skeleton feature  (name `feature:<id>`)    — REQ 913
//   - one equations blob             (name `equations`)       — REQ 913
//   - one meta blob                  (name `meta`) carrying instance/mate order
//     + the doc-level counters + skeleton tree metadata
// Per-instance / per-mate granularity gives structural sharing (editing one
// component re-hashes only that blob + the tree) and clean per-component diff
// later — the assembly analogue of cadSerializer. Skeleton blobs reuse
// cadSerializer's naming so diff labeling stays consistent.
//
// Back-compat: `assemblySerialize` also accepts a bare legacy assemblyDoc
// (shape `{ instances, mates, ... }`) and treats missing skeleton parts as
// empty; commits from before the skeleton feature deserialize to a bundle
// with default-empty sketchDoc/featureTree/equations.

const vcs = require('./vcsService');
const { stripVolatileSketch } = require('./cadSerializer');

const mateKey = (m) => m.mateId || m.id;

const EMPTY_SKETCH_DOC = () => ({ sketches: {}, nextSketchSeq: 1 });
const EMPTY_FEATURE_TREE = () => ({ features: [], nextFeatureSeq: 1 });
const EMPTY_EQUATIONS = () => ({ entries: {} });

function omitKey(obj, key) {
  const out = {};
  for (const k of Object.keys(obj || {})) if (k !== key) out[k] = obj[k];
  return out;
}

/** Normalize serialize input: bundle or bare legacy assemblyDoc. */
function toBundle(docOrBundle) {
  const d = docOrBundle || {};
  if (d.assemblyDoc !== undefined || d.sketchDoc !== undefined || d.featureTree !== undefined) {
    return {
      assemblyDoc: d.assemblyDoc || {},
      sketchDoc: d.sketchDoc || EMPTY_SKETCH_DOC(),
      featureTree: d.featureTree || EMPTY_FEATURE_TREE(),
      equations: d.equations || EMPTY_EQUATIONS(),
    };
  }
  // Legacy: a bare assemblyDoc.
  return {
    assemblyDoc: d,
    sketchDoc: EMPTY_SKETCH_DOC(),
    featureTree: EMPTY_FEATURE_TREE(),
    equations: EMPTY_EQUATIONS(),
  };
}

/** Serialize an assembly document bundle into the object store; returns the tree hash. */
async function assemblySerialize(repo, docOrBundle, db) {
  const bundle = toBundle(docOrBundle);
  const doc = bundle.assemblyDoc || {};
  const instances = doc.instances || [];
  const mates = doc.mates || [];
  const features = (bundle.featureTree && bundle.featureTree.features) || [];
  const sketches = (bundle.sketchDoc && bundle.sketchDoc.sketches) || {};

  const entries = [];
  // Instances in declaration order (order is not strictly semantic, but kept
  // stable for deterministic trees).
  for (const inst of instances) {
    entries.push({ name: `instance:${inst.instanceId}`, kind: 'blob', hash: await vcs.writeBlob(repo, inst, db) });
  }
  for (const m of mates) {
    entries.push({ name: `mate:${mateKey(m)}`, kind: 'blob', hash: await vcs.writeBlob(repo, m, db) });
  }
  // Skeleton content (REQ 913) — same blob naming as cadSerializer.
  for (const f of features) {
    entries.push({ name: `feature:${f.id}`, kind: 'blob', hash: await vcs.writeBlob(repo, f, db) });
  }
  for (const id of Object.keys(sketches).sort()) {
    entries.push({ name: `sketch:${id}`, kind: 'blob', hash: await vcs.writeBlob(repo, stripVolatileSketch(sketches[id]), db) });
  }
  entries.push({ name: 'equations', kind: 'blob', hash: await vcs.writeBlob(repo, bundle.equations, db) });

  const meta = {
    instanceOrder: instances.map((i) => i.instanceId),
    mateOrder: mates.map(mateKey),
    featureOrder: features.map((f) => f.id),
    // docMeta carries every doc-level field that isn't an instance/mate blob so
    // patterns / explode state / display states survive the VCS round-trip
    // (checkin → branch switch → checkout). Without this passthrough they'd be
    // silently dropped on every version op. Mirrors cadSerializer's meta.
    docMeta: {
      nextInstanceSeq: doc.nextInstanceSeq,
      nextMateSeq: doc.nextMateSeq,
      nextPatternSeq: doc.nextPatternSeq,
      nextDisplayStateSeq: doc.nextDisplayStateSeq,
      patterns: doc.patterns,
      explode: doc.explode,
      displayStates: doc.displayStates,
    },
    featureTreeMeta: omitKey(bundle.featureTree, 'features'),
    sketchDocMeta: omitKey(bundle.sketchDoc, 'sketches'),
  };
  entries.push({ name: 'meta', kind: 'blob', hash: await vcs.writeBlob(repo, meta, db) });

  return vcs.writeTree(repo, entries, db);
}

/** Reconstruct an assembly document bundle from a tree hash. */
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

  // Skeleton content (REQ 913). Legacy commits have none of these entries —
  // the bundle falls back to empty defaults.
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
  const equations = (await getContent('equations')) || EMPTY_EQUATIONS();

  const docMeta = meta.docMeta || {};
  const assemblyDoc = {
    nextInstanceSeq: docMeta.nextInstanceSeq != null ? docMeta.nextInstanceSeq : instances.length + 1,
    nextMateSeq: docMeta.nextMateSeq != null ? docMeta.nextMateSeq : mates.length + 1,
    nextPatternSeq: docMeta.nextPatternSeq != null ? docMeta.nextPatternSeq : 1,
    nextDisplayStateSeq: docMeta.nextDisplayStateSeq != null ? docMeta.nextDisplayStateSeq : 1,
    instances,
    mates,
    patterns: docMeta.patterns || [],
    explode: docMeta.explode || { offsets: {}, factor: 1 },
    displayStates: docMeta.displayStates || [],
  };
  return {
    assemblyDoc,
    featureTree: { ...(EMPTY_FEATURE_TREE()), ...(meta.featureTreeMeta || {}), features },
    sketchDoc: { ...(EMPTY_SKETCH_DOC()), ...(meta.sketchDocMeta || {}), sketches },
    equations,
  };
}

module.exports = { assemblySerialize, assemblyDeserialize };
