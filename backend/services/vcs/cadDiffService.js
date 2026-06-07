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
const { cadSerialize, cadDeserialize } = require('./cadSerializer');
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

/** Specific change list for a modified sketch blob: which entities and
 * constraints were added / removed / changed (with dimension value deltas), so
 * the diff names the actual edits instead of just "the sketch changed". */
function sketchDiff(a, b) {
  a = a || {}; b = b || {};
  const byId = (arr) => new Map((arr || []).filter((x) => x && x.id != null).map((x) => [x.id, x]));
  const ea = byId(a.state && a.state.entities), eb = byId(b.state && b.state.entities);
  const ca = byId(a.state && a.state.constraints), cb = byId(b.state && b.state.constraints);

  const entities = [];
  for (const id of new Set([...ea.keys(), ...eb.keys()])) {
    const x = ea.get(id), y = eb.get(id);
    if (x && !y) entities.push({ id, kind: x.kind, status: 'removed' });
    else if (!x && y) entities.push({ id, kind: y.kind, status: 'added' });
    else if (JSON.stringify(x) !== JSON.stringify(y)) entities.push({ id, kind: y.kind || x.kind, status: 'modified' });
  }
  const constraints = [];
  for (const id of new Set([...ca.keys(), ...cb.keys()])) {
    const x = ca.get(id), y = cb.get(id);
    if (x && !y) constraints.push({ id, type: x.type, status: 'removed', a: x.value });
    else if (!x && y) constraints.push({ id, type: y.type, status: 'added', b: y.value });
    else if (JSON.stringify(x) !== JSON.stringify(y)) constraints.push({ id, type: y.type || x.type, status: 'modified', a: x.value, b: y.value });
  }
  const meta = [];
  if ((a.name || '') !== (b.name || '')) meta.push({ key: 'name', a: a.name || '', b: b.name || '' });
  if ((a.visible !== false) !== (b.visible !== false)) meta.push({ key: 'visible', a: a.visible !== false, b: b.visible !== false });
  return { entities, constraints, meta };
}

/** Structural diff between two commits, with field-level detail on modified
 * blobs (sketches get an entity/constraint sub-diff; features/equations get a
 * one-level paramDiff). */
// Friendly type name for an unnamed feature (mirrors the feature-tree default).
const FEATURE_TYPE_LABEL = {
  origin: 'Origin', extrude: 'Extrude', cutExtrude: 'Cut-Extrude', revolve: 'Revolve',
  cutRevolve: 'Cut-Revolve', sweep: 'Sweep', cutSweep: 'Cut-Sweep', loft: 'Loft',
  datumPlane: 'Plane', datumAxis: 'Axis', datumPoint: 'Point', fillet: 'Fillet',
  chamfer: 'Chamfer', shell: 'Shell', hole: 'Hole', mirror: 'Mirror',
  linearPattern: 'Linear Pattern', circularPattern: 'Circular Pattern', combine: 'Combine',
  moveCopyBody: 'Move/Copy Body', mirrorBody: 'Mirror Body',
};
function friendlyFeatureType(type) {
  return FEATURE_TYPE_LABEL[type] || (type ? type[0].toUpperCase() + type.slice(1) : 'Feature');
}

/** Attach a feature-tree-style display name + field-level detail (sketch
 * sub-diff / feature+equations paramDiff) to each entry, in place. The display
 * name is read from the present side's blob (B for added/modified, A for
 * removed): the feature/sketch's own `name` if set, else the type label. */
async function attachEntryDetail(repo, entries, db) {
  for (const e of entries) {
    const isFeature = e.name.startsWith('feature:');
    const isSketch = e.name.startsWith('sketch:');
    const isEqs = e.name === 'equations';
    const isInstance = e.name.startsWith('instance:'); // assembly component
    const isMate = e.name.startsWith('mate:');         // assembly mate
    if (!isFeature && !isSketch && !isEqs && !isInstance && !isMate) continue;
    const oa = e.aHash ? await vcs.getObject(repo, e.aHash, db) : null;
    const ob = e.bHash ? await vcs.getObject(repo, e.bHash, db) : null;
    const c = (ob && ob.content) || (oa && oa.content) || null;
    const named = c && c.name && String(c.name).trim();
    if (isEqs) e.displayName = 'Equations';
    else if (isSketch) e.displayName = named ? c.name : `Sketch ${e.name.slice('sketch:'.length)}`;
    else if (isInstance) e.displayName = `Component ${(c && c.partID) || e.name.slice('instance:'.length)}`;
    else if (isMate) e.displayName = c && c.type ? `${c.type} mate` : `Mate ${e.name.slice('mate:'.length)}`;
    else e.displayName = named ? c.name : friendlyFeatureType(c && c.type);
    if (e.status === 'modified') {
      if (isSketch) e.sketchDiff = sketchDiff(oa && oa.content, ob && ob.content);
      else e.paramDiff = paramDiff(oa && oa.content, ob && ob.content);
    }
  }
  return entries;
}

async function commitDiff(repo, commitHashA, commitHashB, db) {
  const ca = commitHashA ? await vcs.getCommit(repo, commitHashA, db) : null;
  const cb = commitHashB ? await vcs.getCommit(repo, commitHashB, db) : null;
  const entries = await attachEntryDetail(repo, await treeDiff(repo, ca && ca.treeHash, cb && cb.treeHash, db), db);
  return { commitA: commitHashA, commitB: commitHashB, entries };
}

/** Diff the live working copy against its base commit (the last check-in) — the
 * uncommitted changes. Serializes the working doc to a tree (deduped objects,
 * same work as check-in minus the commit) and tree-diffs it against the base. */
async function workingDiff(model, db) {
  const repo = await repoForModel(model, db);
  const workTree = await cadSerialize(repo, {
    featureTree: model.featureTree,
    sketchDoc: model.sketchDoc,
    equations: model.equations || { entries: {} },
  }, db);
  const base = model.baseCommitHash ? await vcs.getCommit(repo, model.baseCommitHash, db) : null;
  const entries = await attachEntryDetail(repo, await treeDiff(repo, base && base.treeHash, workTree, db), db);
  return { baseCommitHash: model.baseCommitHash || null, entries };
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
  const dbc = db || global.db;
  const commit = await vcs.getCommit(repo, commitHash, dbc);
  if (!commit) throw new Error(`Commit ${commitHash} not found`);
  if (commit.meta && commit.meta.frozen) return loadFrozenGeometry(repo, commit.meta.frozen, db);
  const doc = await cadDeserialize(repo, commit.treeHash, db);
  // Include `part` so the text resolver can expand #{partName} / #{partRevision}
  // placeholders in sketch text. Without it the placeholders stay literal, which
  // produces a different glyph/region set than the frontend stored its
  // regionIndices against — so cuts/extrudes select the wrong regions (the live
  // working copy renders fine because its model already has `part` loaded).
  const part = model.part || (model.partID ? await dbc.Part.findByPk(model.partID) : null);
  const pseudo = { id: model.id, partID: model.partID, part, featureTree: doc.featureTree, sketchDoc: doc.sketchDoc, equations: doc.equations };
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

/** Face-level diff between two commits, by persistent topological name. Returns
 * each commit's set of face names so the viewer can colour faces present only
 * in B as added (new) and faces present only in A as removed (deleted). Faces
 * shared by name are unchanged. (A resized face keeps its name → unchanged; a
 * true geometry-modified diff would also hash the mesh — out of scope here.) */
async function faceNameDiff(model, commitHashA, commitHashB, opts = {}, db) {
  const repo = await repoForModel(model, db);
  const ga = await regenCommitGeometry(repo, model, commitHashA, opts, db);
  const gb = await regenCommitGeometry(repo, model, commitHashB, opts, db);
  const namesOf = (g) => {
    const out = new Set();
    for (const f of g.features || []) for (const face of f.faces || []) if (face.persistentName) out.add(face.persistentName);
    return [...out];
  };
  return { commitA: commitHashA, commitB: commitHashB, namesA: namesOf(ga), namesB: namesOf(gb) };
}

module.exports = { treeDiff, paramDiff, sketchDiff, commitDiff, workingDiff, regenCommitGeometry, bodyDiff3D, bodySignature, faceNameDiff };
