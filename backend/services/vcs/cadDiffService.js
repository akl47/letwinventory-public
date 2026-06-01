'use strict';

// Phase 3 (REQ 699-701 / VC-31..33) — diff between two commits.
//   - Structural: compare trees by entry hash → added/removed/modified/unchanged
//     per feature/sketch/equations, in O(changes) (identical subtrees compare
//     equal by hash). Modified blobs get a field-level paramDiff.
//   - 3D: regenerate each commit's geometry (frozen commits skip the kernel) and
//     classify each body added/removed/modified/unchanged.

const crypto = require('crypto');
const vcs = require('./vcsService');
const { repoForModel } = require('./cadVcsService');
const { cadDeserialize } = require('./cadSerializer');
const { loadFrozenGeometry } = require('./cadFreezeService');
const cadRegen = require('../cadRegenService');

// ── Structural diff ──────────────────────────────────────────────────────────

/** Compare two trees by entry hash. The `meta` bookkeeping blob is ignored. */
async function treeDiff(repo, treeHashA, treeHashB, db) {
  const a = treeHashA ? (await vcs.readTree(repo, treeHashA, db)) || [] : [];
  const b = treeHashB ? (await vcs.readTree(repo, treeHashB, db)) || [] : [];
  const mapA = new Map(a.map(e => [e.name, e]));
  const mapB = new Map(b.map(e => [e.name, e]));
  const entries = [];
  for (const name of new Set([...mapA.keys(), ...mapB.keys()])) {
    if (name === 'meta') continue; // order/seq bookkeeping — not user-facing
    const ea = mapA.get(name);
    const eb = mapB.get(name);
    let status;
    if (ea && !eb) status = 'removed';
    else if (!ea && eb) status = 'added';
    else if (ea.hash !== eb.hash) status = 'modified';
    else status = 'unchanged';
    entries.push({ name, kind: (ea || eb).kind, status, aHash: ea ? ea.hash : null, bHash: eb ? eb.hash : null });
  }
  entries.sort((x, y) => x.name.localeCompare(y.name));
  return entries;
}

/** Field-level diff between two JSON objects (one level deep). */
function paramDiff(objA, objB) {
  const out = { changed: [], added: [], removed: [] };
  for (const k of new Set([...Object.keys(objA || {}), ...Object.keys(objB || {})])) {
    const inA = objA && Object.prototype.hasOwnProperty.call(objA, k);
    const inB = objB && Object.prototype.hasOwnProperty.call(objB, k);
    if (inA && !inB) out.removed.push(k);
    else if (!inA && inB) out.added.push(k);
    else if (JSON.stringify(objA[k]) !== JSON.stringify(objB[k])) out.changed.push({ key: k, a: objA[k], b: objB[k] });
  }
  return out;
}

/** Structural diff between two commits, with paramDiff on modified blobs. */
async function commitDiff(repo, commitHashA, commitHashB, db) {
  const ca = commitHashA ? await vcs.getCommit(repo, commitHashA, db) : null;
  const cb = commitHashB ? await vcs.getCommit(repo, commitHashB, db) : null;
  const entries = await treeDiff(repo, ca && ca.treeHash, cb && cb.treeHash, db);
  for (const e of entries) {
    if (e.status !== 'modified') continue;
    if (!(e.name.startsWith('feature:') || e.name.startsWith('sketch:') || e.name === 'equations')) continue;
    const oa = e.aHash ? await vcs.getObject(repo, e.aHash, db) : null;
    const ob = e.bHash ? await vcs.getObject(repo, e.bHash, db) : null;
    e.paramDiff = paramDiff(oa && oa.content, ob && ob.content);
  }
  return { commitA: commitHashA, commitB: commitHashB, entries };
}

// ── 3D body diff ─────────────────────────────────────────────────────────────

/** A content signature for a body, from the faces the regen attributes to it. */
function bodySignature(geo, bodyId) {
  const faces = [];
  for (const f of geo.features || []) {
    if (f.bodyId !== bodyId) continue;
    for (const face of f.faces || []) {
      faces.push([face.faceId, (face.positions || []).join(','), (face.indices || []).join(',')]);
    }
  }
  faces.sort();
  return crypto.createHash('sha256').update(JSON.stringify(faces)).digest('hex').slice(0, 16);
}

/** Geometry for a commit: frozen objects if released (no kernel), else a live
 * regeneration of that commit's recipe. */
async function regenCommitGeometry(repo, model, commitHash, { kernelClient } = {}, db) {
  const commit = await vcs.getCommit(repo, commitHash, db);
  if (!commit) throw new Error(`Commit ${commitHash} not found`);
  if (commit.meta && commit.meta.frozen) return loadFrozenGeometry(repo, commit.meta.frozen, db);
  const doc = await cadDeserialize(repo, commit.treeHash, db);
  const pseudo = { id: model.id, partID: model.partID, featureTree: doc.featureTree, sketchDoc: doc.sketchDoc, equations: doc.equations };
  return cadRegen.regenerateModel(pseudo, { kernelClient, db });
}

/** Body-level 3D diff between two commits. */
async function bodyDiff3D(model, commitHashA, commitHashB, opts = {}, db) {
  const repo = await repoForModel(model, db);
  const ga = await regenCommitGeometry(repo, model, commitHashA, opts, db);
  const gb = await regenCommitGeometry(repo, model, commitHashB, opts, db);
  const idsA = new Set((ga.bodies || []).map(b => b.id));
  const idsB = new Set((gb.bodies || []).map(b => b.id));
  const bodies = [];
  for (const id of new Set([...idsA, ...idsB])) {
    let status;
    if (idsA.has(id) && !idsB.has(id)) status = 'removed';
    else if (!idsA.has(id) && idsB.has(id)) status = 'added';
    else status = bodySignature(ga, id) === bodySignature(gb, id) ? 'unchanged' : 'modified';
    bodies.push({ id, status });
  }
  bodies.sort((x, y) => x.id.localeCompare(y.id));
  return { commitA: commitHashA, commitB: commitHashB, bodies };
}

module.exports = { treeDiff, paramDiff, commitDiff, regenCommitGeometry, bodyDiff3D, bodySignature };
