'use strict';

// REQ 1077/1079 — copy an assembly as a self-contained bundle. An assembly only
// points at its components by part id, so the bundle carries the design of
// every component (sub-assembly components included) and importing it creates
// a fresh Part + design for each one. No history, branches or tags travel.

const RestError = require('../util/RestError');
const vcs = require('./vcs/vcsService');
const cadVcsService = require('./vcs/cadVcsService');
const cadBranchService = require('./vcs/cadBranchService');
const assemblyVcsService = require('./vcs/assemblyVcsService');
const assemblyBranchService = require('./vcs/assemblyBranchService');
const assemblyRegenService = require('./assemblyRegenService');
const { NAMING_VERSION } = require('./cadRegenService');
const { validateSketchDocExpressions } = require('./cadSafeExpr');

const KIND = 'letwinventory-cad';
const SCHEMA = 1;
const DRAFT = 'draft/01';
const REVISION = '01';

const clone = (v) => JSON.parse(JSON.stringify(v));
const dbOf = (db) => db || global.db;

function partDoc(src) {
  const from = src.source === 'commit' ? src.doc : src.row;
  return clone({ featureTree: from.featureTree, sketchDoc: from.sketchDoc, equations: from.equations || null });
}

// ── export ──────────────────────────────────────────────────────────────────

async function exportBundle(assembly, db) {
  const D = dbOf(db);
  const rootPart = await D.Part.findByPk(assembly.partID);
  const components = [];
  const seen = new Set([assembly.partID]);

  const walk = async (doc) => {
    for (const inst of (doc && doc.instances) || []) {
      if (seen.has(inst.partID)) continue;
      seen.add(inst.partID);
      let src;
      try {
        src = await assemblyRegenService.resolveChildSource(inst, D);
      } catch (err) {
        if (err.statusCode !== 422) throw err;
        const p = await D.Part.findByPk(inst.partID);
        throw new RestError(`Component ${p ? p.name : `part ${inst.partID}`} has no design, so this assembly cannot be copied`, 422);
      }
      const part = await D.Part.findByPk(src.row.partID);
      const entry = {
        partID: inst.partID,
        designPartID: src.row.partID,
        modelId: src.row.id,
        partName: part ? part.name : '',
        partRev: part ? part.revision || '' : '',
        description: part ? part.description || null : null,
        isAssembly: !!src.row.isAssembly,
      };
      if (src.row.isAssembly) {
        entry.assembly = clone(assemblyVcsService.docOf(src.row));
        components.push(entry);
        await walk(entry.assembly.assemblyDoc);
      } else {
        entry.model = partDoc(src);
        components.push(entry);
      }
    }
  };

  const root = clone(assemblyVcsService.docOf(assembly));
  await walk(root.assemblyDoc);
  return {
    kind: KIND, schema: SCHEMA, scope: 'assembly', namingVersion: NAMING_VERSION,
    source: {
      origin: '', modelId: assembly.id, partID: assembly.partID,
      partName: rootPart ? rootPart.name : '',
      partRev: rootPart ? rootPart.revision || '' : '',
      description: rootPart ? rootPart.description || null : null,
    },
    assembly: root,
    components,
  };
}

// ── import ──────────────────────────────────────────────────────────────────

function validate(bundle) {
  const bad = (msg) => new RestError(msg, 400);
  if (!bundle || typeof bundle !== 'object' || bundle.kind !== KIND) throw bad('This is not a copied CAD assembly');
  if (bundle.schema !== SCHEMA) throw bad('This copy was made by a newer version of the CAD editor — update this environment first');
  if (bundle.scope !== 'assembly' || !bundle.source || !bundle.assembly || !bundle.assembly.assemblyDoc || !Array.isArray(bundle.components)) {
    throw bad('The copied assembly is incomplete');
  }
  const known = new Set();
  for (const c of bundle.components) {
    const content = c && (c.isAssembly ? c.assembly && c.assembly.assemblyDoc : c.model && c.model.featureTree && c.model.sketchDoc);
    if (!c || !Number.isInteger(c.partID) || !content) throw bad('The copied assembly is incomplete');
    known.add(c.partID);
  }
  const docs = [bundle.assembly, ...bundle.components.map((c) => (c.isAssembly ? c.assembly : c.model))];
  for (const d of docs) {
    for (const inst of (d.assemblyDoc && d.assemblyDoc.instances) || []) {
      if (!known.has(inst.partID)) throw bad(`The copied assembly is missing component part ${inst.partID}`);
    }
    const exprErr = d.sketchDoc ? validateSketchDocExpressions(d.sketchDoc) : null;
    if (exprErr) throw bad(exprErr);
  }
}

// Re-point in-context references (REQ 913-918) and pushed-variable tags from
// the source assemblies/parts to their copies. Mutates `node`.
function remapRefs(node, maps) {
  if (Array.isArray(node)) { for (const n of node) remapRefs(n, maps); return; }
  if (!node || typeof node !== 'object') return;
  if (node.scope === 'cross-part' && maps.models.has(node.definingAssemblyId)) {
    const asm = maps.models.get(node.definingAssemblyId);
    node.definingAssemblyId = asm.modelId;
    node.definingAssemblyRepoId = String(asm.partID);
    if (maps.parts.has(node.sourcePartId)) node.sourcePartId = maps.parts.get(node.sourcePartId).partID;
    delete node.pinnedSourceCommit; // a commit of the SOURCE repo
  }
  if (typeof node.fromAssembly === 'number' && maps.models.has(node.fromAssembly)) {
    node.fromAssembly = maps.models.get(node.fromAssembly).modelId;
  }
  for (const v of Object.values(node)) remapRefs(v, maps);
}

function remapInstances(assemblyDoc, maps) {
  for (const inst of assemblyDoc.instances || []) {
    const target = maps.parts.get(inst.partID);
    inst.partID = target.partID;
    inst.ref = { kind: target.isAssembly ? 'assembly' : 'cad', branch: DRAFT };
    inst.pinnedCommitHash = null;
  }
}

async function createPart(D, { name, description, categoryID }, userId) {
  const part = await D.Part.create({
    name, description: description || null, internalPart: true, vendor: '', minimumOrderQuantity: 1,
    partCategoryID: categoryID, serialNumberRequired: false, lotNumberRequired: false,
    activeFlag: true, revision: REVISION,
  });
  await D.PartRevisionHistory.create({ partID: part.id, changedByUserID: userId, changeType: 'created', changes: null, createdAt: new Date() });
  return part;
}

// A new design on its first draft branch, exactly as the create endpoints leave it.
async function createDesign(D, part, isAssembly, userId) {
  const row = await D.DesignCADModel.create(isAssembly
    ? { name: part.name, partID: part.id, isAssembly: true, assemblyDoc: assemblyVcsService.docOf({}).assemblyDoc, createdByUserID: userId, activeFlag: true }
    : {
      name: null, partID: part.id, createdByUserID: userId, activeFlag: true,
      featureTree: { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 },
      sketchDoc: { sketches: {}, nextSketchSeq: 1 }, equations: { entries: {} },
    });
  const svc = isAssembly ? assemblyVcsService : cadVcsService;
  const branches = isAssembly ? assemblyBranchService : cadBranchService;
  const mainHead = await svc.seedMain(row, userId, {}, D);
  await branches.createBranch(row, DRAFT, { fromCommit: mainHead }, userId, D);
  await branches.switchBranch(row, DRAFT, userId, D);
  await D.DesignCADModelHistory.create({
    cadModelID: row.id, changedByUserID: userId, changeType: 'created',
    previousState: null, newState: { partID: part.id, branch: DRAFT }, createdAt: new Date(),
  });
  return row;
}

async function importBundle(bundle, { name, description } = {}, userId, db) {
  const D = dbOf(db);
  validate(bundle);
  const asmName = String(name || '').trim();
  if (!asmName) throw new RestError('A part number is required for the new assembly', 400);

  const categories = await D.PartCategory.findAll({ where: { activeFlag: true }, order: [['id', 'ASC']] });
  const asmCategory = categories.find((c) => c.name === 'Assembly');
  const partCategory = categories.find((c) => c.name === 'Part') || categories.find((c) => c.name !== 'Assembly');
  if (!asmCategory || !partCategory) throw new RestError('An Assembly part category and a part category must exist to paste an assembly', 422);
  const categoryOf = (isAssembly) => (isAssembly ? asmCategory : partCategory);

  if (await D.Part.findOne({ where: { name: asmName, revision: REVISION } })) {
    throw new RestError(`Part number ${asmName} revision ${REVISION} is already in use`, 409);
  }

  const src = clone(bundle);
  return vcs.inTransaction(D, async () => {
    // Component part numbers: the next free numbers after the newest part.
    const used = new Set((await D.Part.findAll({ attributes: ['name'] })).map((p) => p.name));
    used.add(asmName);
    let next = ((await D.Part.max('id')) || 0) + 1;
    const nextName = () => {
      let n = String(next++).padStart(6, '0');
      while (used.has(n)) n = String(next++).padStart(6, '0');
      used.add(n);
      return n;
    };

    const maps = { parts: new Map(), models: new Map() };
    const asmPart = await createPart(D, { name: asmName, description: description !== undefined ? description : src.source.description, categoryID: categoryOf(true).id }, userId);
    const asmRow = await createDesign(D, asmPart, true, userId);
    const rootTarget = { partID: asmPart.id, modelId: asmRow.id, isAssembly: true, row: asmRow };
    if (Number.isInteger(src.source.partID)) maps.parts.set(src.source.partID, rootTarget);
    if (Number.isInteger(src.source.modelId)) maps.models.set(src.source.modelId, rootTarget);

    const created = [];
    for (const c of src.components) {
      const part = await createPart(D, { name: nextName(), description: c.description, categoryID: categoryOf(c.isAssembly).id }, userId);
      const row = await createDesign(D, part, !!c.isAssembly, userId);
      const target = { partID: part.id, modelId: row.id, isAssembly: !!c.isAssembly, row };
      maps.parts.set(c.partID, target);
      if (Number.isInteger(c.designPartID)) maps.parts.set(c.designPartID, target);
      if (Number.isInteger(c.modelId)) maps.models.set(c.modelId, target);
      created.push({ sourcePartID: c.partID, partID: part.id, name: part.name, isAssembly: !!c.isAssembly });
    }

    // Write each component, checked in so it is usable by everyone. Parts go
    // first: a sub-assembly's check-in pins its components' branch heads.
    const message = `Pasted from ${src.source.partName || 'a copied assembly'}`;
    const write = async (c) => {
      const { row } = maps.parts.get(c.partID);
      const svc = c.isAssembly ? assemblyVcsService : cadVcsService;
      const content = c.isAssembly ? c.assembly : c.model;
      remapRefs(content, maps);
      if (c.isAssembly) remapInstances(content.assemblyDoc, maps);
      await svc.checkout(row, userId, {}, D);
      await row.update(c.isAssembly
        ? { ...assemblyVcsService.applyBundle(row, content), dirty: true, lastContentSavedAt: new Date() }
        : { featureTree: content.featureTree, sketchDoc: content.sketchDoc, equations: content.equations || { entries: {} }, dirty: true, lastContentSavedAt: new Date() });
      await svc.checkin(row, userId, message, {}, D);
      await svc.releaseLock(row, userId, {}, D);
    };
    for (const c of src.components.filter((x) => !x.isAssembly)) await write(c);
    // Sub-assemblies, innermost first.
    const done = new Set();
    const writeAssembly = async (c) => {
      if (done.has(c.partID)) return;
      done.add(c.partID);
      for (const inst of c.assembly.assemblyDoc.instances || []) {
        const child = src.components.find((x) => x.isAssembly && x.partID === inst.partID);
        if (child) await writeAssembly(child);
      }
      await write(c);
    };
    for (const c of src.components.filter((x) => x.isAssembly)) await writeAssembly(c);

    // The new assembly itself stays checked out by the caller, ready to edit.
    remapRefs(src.assembly, maps);
    remapInstances(src.assembly.assemblyDoc, maps);
    await assemblyVcsService.checkout(asmRow, userId, {}, D);
    await asmRow.update({ ...assemblyVcsService.applyBundle(asmRow, src.assembly), dirty: true, lastContentSavedAt: new Date() });

    return { assembly: { id: asmRow.id, partID: asmPart.id, name: asmPart.name }, components: created };
  });
}

module.exports = { exportBundle, importBundle };
