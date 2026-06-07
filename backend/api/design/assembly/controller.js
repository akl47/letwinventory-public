'use strict';

// Assembly module controller (REQ 750-754). CRUD + component-instance management
// + composite regenerate + BOM + whole-assembly export. Reuses the `cad`
// permission resource. The VCS checkout/branch/release workflow is Phase 2; for
// the MVP, edits write the assembly document directly and record history.

const db = require('../../../models');
const assemblyRegenService = require('../../../services/assemblyRegenService');
const assemblyAnalysisService = require('../../../services/assemblyAnalysisService');
const assemblyVcsService = require('../../../services/vcs/assemblyVcsService');
const assemblyBranchService = require('../../../services/vcs/assemblyBranchService');
const cadVcsService = require('../../../services/vcs/cadVcsService');
const vcsService = require('../../../services/vcs/vcsService');
const cadGraphService = require('../../../services/vcs/cadGraphService');
const cadDiffService = require('../../../services/vcs/cadDiffService');
const assemblyFreezeService = require('../../../services/vcs/assemblyFreezeService');
const workflowEngine = require('../../../services/vcs/workflowEngine');
const partRevisionService = require('../../../services/partRevisionService');
const cadRegenService = require('../../../services/cadRegenService');
const RestError = require('../../../util/RestError');
const { KernelDisconnected, KernelRpcError, getDefaultClient } = require('../../../services/cadKernelClient');

// Release a draft assembly branch onto main as the next numeric Part revision:
// mint the revision, freeze the composed geometry, release the branch doc onto
// main (preserving its history), lock it, and archive the branch. Mirrors the
// CAD releaseBranchToMain — assemblies are Parts, so the same revision service
// applies.
async function releaseAssemblyToMain(assembly, userId, opts = {}) {
  const branchName = assembly.branchName;
  if (!branchName || branchName === 'main') throw new RestError('Only a draft branch can be released to main', 409);
  if (assembly.dirty || !assembly.baseCommitHash) throw new RestError('Check in the branch before releasing it', 409);
  const repo = await assemblyVcsService.repoForAssembly(assembly);
  const mainRef = await vcsService.getRef(repo, 'main');
  const branchRef = await vcsService.getRef(repo, branchName);
  if (mainRef && branchRef) {
    const ancestry = (await vcsService.walk(repo, branchRef.targetHash)).map((c) => c.hash);
    if (!ancestry.includes(mainRef.targetHash)) throw new RestError('Branch is behind main — merge before releasing', 409);
  }
  const part = await db.Part.findByPk(assembly.partID);
  const newPart = await partRevisionService.createNewRevision(part, userId);
  await assembly.update({ partID: newPart.id });
  const branchHead = branchRef ? branchRef.targetHash : (assembly.baseCommitHash || null);
  assembly.branchName = 'main';
  const { commitHash, tag } = await assemblyVcsService.release(
    assembly, userId, newPart.revision,
    { ...opts, parents: branchHead ? [branchHead] : undefined },
  );
  await assembly.update({ releaseLocked: true, branchName: 'main' });
  if (!newPart.revisionLocked) await newPart.update({ revisionLocked: true });
  await vcsService.deleteRef(repo, branchName);
  return { commitHash, tag, newPartID: newPart.id, branch: branchName };
}

// Workflow state is keyed per branch (matches the CAD convention) so multiple
// draft branches can be in review at once.
async function assemblyWorkflowRepo(assembly) {
  const repo = await assemblyVcsService.repoForAssembly(assembly);
  return { repoType: repo.repoType, repoId: `${repo.repoId}:${assembly.branchName || 'main'}` };
}

// Augment an assembly with the VCS display fields the File ribbon reads:
// `released`, `displayRevision`, `draftRevision`, `behindMain`. Revision numbers
// come from the Parts table (shared helper), exactly like CAD models.
async function withReleaseFlag(assembly) {
  const repo = await assemblyVcsService.repoForAssembly(assembly);
  const highest = await cadVcsService.highestReleasedNumeric(assembly);
  const onMain = (assembly.branchName || 'main') === 'main';
  const displayRevision = onMain
    ? (highest > 0 ? cadVcsService.padNumeric(highest) : null)
    : cadVcsService.padNumeric(highest + 1);
  const tags = await vcsService.listRefs(repo, 'tag');
  const released = onMain && tags.some((t) => /^\d+$/.test(t.name));
  let behindMain = false;
  if (!onMain) {
    const mainRef = await vcsService.getRef(repo, 'main');
    const branchRef = await vcsService.getRef(repo, assembly.branchName);
    if (mainRef && branchRef) {
      const ancestry = (await vcsService.walk(repo, branchRef.targetHash)).map((c) => c.hash);
      behindMain = !ancestry.includes(mainRef.targetHash);
    }
  }
  return { ...assembly.toJSON(), released, displayRevision, draftRevision: onMain ? null : displayRevision, behindMain };
}

const INITIAL_ASSEMBLY_DOC = {
  nextInstanceSeq: 1, nextMateSeq: 1, nextPatternSeq: 1, nextDisplayStateSeq: 1,
  instances: [], mates: [], patterns: [],
  explode: { offsets: {}, factor: 1 }, displayStates: [],
};
const IDENTITY_PLACEMENT = { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] };

async function recordHistory(assemblyID, changedByUserID, changeType, previousState, newState) {
  await db.DesignAssemblyHistory.create({
    assemblyID, changedByUserID, changeType,
    previousState: previousState || null,
    newState: newState || null,
    createdAt: new Date(),
  });
}

async function fetchActive(id) {
  return db.DesignAssembly.findOne({
    where: { id, activeFlag: true },
    include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'sku', 'manufacturerPN', 'revision'] }],
  });
}

// Normalize a client-supplied placement to { translate:[3], quaternion:[4] }.
function sanitizePlacement(p) {
  if (!p || typeof p !== 'object') return { ...IDENTITY_PLACEMENT };
  const t = Array.isArray(p.translate) && p.translate.length === 3 ? p.translate.map(Number) : [0, 0, 0];
  const q = Array.isArray(p.quaternion) && p.quaternion.length === 4 ? p.quaternion.map(Number) : [0, 0, 0, 1];
  return { translate: t, quaternion: q };
}

module.exports = {
  // GET /parts-with-assembly — landing list.
  async listPartsWithAssembly(req, res) {
    try {
      const rows = await db.DesignAssembly.findAll({
        where: { activeFlag: true },
        include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'sku', 'revision'] }],
        order: [['updatedAt', 'DESC']],
      });
      return res.json(rows.map((a) => ({
        id: a.id, name: a.name, partID: a.partID, part: a.part,
        instanceCount: ((a.assemblyDoc || {}).instances || []).length,
        updatedAt: a.updatedAt,
      })));
    } catch (err) {
      return res.status(500).json({ error: `Failed to list assemblies: ${err.message}` });
    }
  },

  // GET /eligible-parts — parts in the "Assembly" category (candidates for an
  // assembly CAD model), flagged with whether they already have one.
  async listEligibleParts(req, res) {
    try {
      const category = await db.PartCategory.findOne({ where: { name: 'Assembly', activeFlag: true } });
      if (!category) return res.json([]);
      const parts = await db.Part.findAll({
        where: { partCategoryID: category.id, activeFlag: true },
        attributes: ['id', 'name', 'sku', 'revision'],
        order: [['name', 'ASC']],
      });
      const existing = await db.DesignAssembly.findAll({ where: { activeFlag: true }, attributes: ['partID'] });
      const hasAssembly = new Set(existing.map((a) => a.partID));
      return res.json(parts.map((p) => ({
        partID: p.id,
        part: { id: p.id, name: p.name, sku: p.sku, revision: p.revision },
        hasAssembly: hasAssembly.has(p.id),
      })));
    } catch (err) {
      return res.status(500).json({ error: `Failed to list eligible parts: ${err.message}` });
    }
  },

  // GET /by-part/:partID/active
  async getActiveByPart(req, res) {
    try {
      const partID = Number(req.params.partID);
      const assembly = await db.DesignAssembly.findOne({
        where: { partID, activeFlag: true },
        include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'sku', 'manufacturerPN', 'revision'] }],
        order: [['updatedAt', 'DESC']],
      });
      if (!assembly) return res.status(404).json({ error: `No assembly found for part ${partID}` });
      return res.json(await withReleaseFlag(assembly));
    } catch (err) {
      return res.status(500).json({ error: `Failed to fetch assembly: ${err.message}` });
    }
  },

  // POST /by-part/:partID — create the (single) assembly for a part.
  async createForPart(req, res) {
    const partID = Number(req.params.partID);
    try {
      const part = await db.Part.findByPk(partID);
      if (!part) return res.status(404).json({ error: `Part ${partID} does not exist` });
      // Eligibility: only parts in the "Assembly" category can carry an assembly.
      const category = await db.PartCategory.findByPk(part.partCategoryID);
      if (!category || category.name !== 'Assembly') {
        return res.status(422).json({ error: 'Only parts in the Assembly category can have an assembly. Set the part category to Assembly first.' });
      }
      const existing = await db.DesignAssembly.findOne({ where: { partID, activeFlag: true } });
      if (existing) return res.status(409).json({ error: `Part ${partID} already has an assembly` });

      const assembly = await db.DesignAssembly.create({
        name: (req.body && req.body.name) || part.name || null,
        partID,
        assemblyDoc: INITIAL_ASSEMBLY_DOC,
        createdByUserID: req.user.id,
        activeFlag: true,
      });
      await recordHistory(assembly.id, req.user.id, 'created', null, { partID });
      // Seed the VCS repo (initial commit on main) so the assembly has version
      // history from creation. Best-effort: a failure here shouldn't block create.
      try { await assemblyVcsService.seedMain(assembly, req.user.id); } catch (_) { /* seeded lazily on first checkin */ }
      return res.status(201).json(await fetchActive(assembly.id));
    } catch (err) {
      return res.status(500).json({ error: `Failed to create assembly: ${err.message}` });
    }
  },

  // GET /:id
  async getById(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      return res.json(await withReleaseFlag(assembly));
    } catch (err) {
      return res.status(500).json({ error: `Failed to fetch assembly: ${err.message}` });
    }
  },

  // PUT /:id — replace the assembly document (name and/or assemblyDoc).
  async update(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const previous = { name: assembly.name, assemblyDoc: assembly.assemblyDoc };
      const patch = {};
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.assemblyDoc !== undefined) {
        // Guard the new doc against self-reference before persisting.
        await assemblyRegenService.assertAcyclic({ partID: assembly.partID, assemblyDoc: req.body.assemblyDoc }, db);
        patch.assemblyDoc = req.body.assemblyDoc;
        patch.dirty = true;
      }
      await assembly.update(patch);
      await recordHistory(assembly.id, req.user.id, 'updated', previous, patch);
      return res.json(await fetchActive(assembly.id));
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // DELETE /:id — soft delete.
  async delete(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      await assembly.update({ activeFlag: false });
      await recordHistory(assembly.id, req.user.id, 'deleted', { activeFlag: true }, { activeFlag: false });
      return res.status(204).end();
    } catch (err) {
      return res.status(500).json({ error: `Failed to delete assembly: ${err.message}` });
    }
  },

  // POST /:id/instances — insert a component instance referencing a part.
  async insertInstance(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const partID = Number(req.body.partID);
      if (!partID) return res.status(400).json({ error: 'partID is required' });

      const part = await db.Part.findByPk(partID);
      if (!part) return res.status(404).json({ error: `Part ${partID} does not exist` });
      const childModel = await db.DesignCADModel.findOne({ where: { partID, activeFlag: true } });
      const childAssembly = await db.DesignAssembly.findOne({ where: { partID, activeFlag: true } });
      if (!childModel && !childAssembly) {
        return res.status(422).json({ error: `Part ${partID} has no CAD model or assembly to insert` });
      }

      const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || INITIAL_ASSEMBLY_DOC));
      doc.instances = doc.instances || [];
      const instanceId = `i${doc.nextInstanceSeq || (doc.instances.length + 1)}`;
      const instance = {
        instanceId,
        partID,
        ref: { kind: childAssembly ? 'assembly' : 'cad' },
        pinnedCommitHash: null,
        // First component is auto-grounded (SolidWorks "fixed first part").
        grounded: req.body.grounded !== undefined ? !!req.body.grounded : doc.instances.length === 0,
        placement: sanitizePlacement(req.body.placement),
        suppressed: false,
        visible: true,
      };
      doc.instances.push(instance);
      doc.nextInstanceSeq = (doc.nextInstanceSeq || doc.instances.length) + 1;

      // Reject a self/cyclic reference before persisting.
      await assemblyRegenService.assertAcyclic({ partID: assembly.partID, assemblyDoc: doc }, db);

      await assembly.update({ assemblyDoc: doc, dirty: true });
      await recordHistory(assembly.id, req.user.id, 'instance_added', null, { instanceId, partID });
      return res.status(201).json({ instance, assembly: await fetchActive(assembly.id) });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // PATCH /:id/instances/:instanceId — update placement / grounded / suppressed / visible.
  async updateInstance(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || INITIAL_ASSEMBLY_DOC));
      const inst = (doc.instances || []).find((i) => i.instanceId === req.params.instanceId);
      if (!inst) return res.status(404).json({ error: `Instance ${req.params.instanceId} not found` });

      if (req.body.placement !== undefined) inst.placement = sanitizePlacement(req.body.placement);
      if (req.body.grounded !== undefined) inst.grounded = !!req.body.grounded;
      if (req.body.suppressed !== undefined) inst.suppressed = !!req.body.suppressed;
      if (req.body.visible !== undefined) inst.visible = !!req.body.visible;

      await assembly.update({ assemblyDoc: doc, dirty: true });
      await recordHistory(assembly.id, req.user.id, 'instance_updated', null, { instanceId: inst.instanceId });
      return res.json({ instance: inst, assembly: await fetchActive(assembly.id) });
    } catch (err) {
      return res.status(500).json({ error: `Failed to update instance: ${err.message}` });
    }
  },

  // DELETE /:id/instances/:instanceId
  async removeInstance(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || INITIAL_ASSEMBLY_DOC));
      const before = (doc.instances || []).length;
      doc.instances = (doc.instances || []).filter((i) => i.instanceId !== req.params.instanceId);
      if (doc.instances.length === before) return res.status(404).json({ error: `Instance ${req.params.instanceId} not found` });
      await assembly.update({ assemblyDoc: doc, dirty: true });
      await recordHistory(assembly.id, req.user.id, 'instance_removed', null, { instanceId: req.params.instanceId });
      return res.json(await fetchActive(assembly.id));
    } catch (err) {
      return res.status(500).json({ error: `Failed to remove instance: ${err.message}` });
    }
  },

  // PUT /:id/instances/:instanceId/replace — swap the referenced part (REQ 762).
  async replaceInstance(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const partID = Number(req.body.partID);
      if (!partID) return res.status(400).json({ error: 'partID is required' });
      const part = await db.Part.findByPk(partID);
      if (!part) return res.status(404).json({ error: `Part ${partID} does not exist` });
      const childModel = await db.DesignCADModel.findOne({ where: { partID, activeFlag: true } });
      const childAssembly = await db.DesignAssembly.findOne({ where: { partID, activeFlag: true } });
      if (!childModel && !childAssembly) return res.status(422).json({ error: `Part ${partID} has no CAD model or assembly` });

      const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || INITIAL_ASSEMBLY_DOC));
      const inst = (doc.instances || []).find((i) => i.instanceId === req.params.instanceId);
      if (!inst) return res.status(404).json({ error: `Instance ${req.params.instanceId} not found` });
      inst.partID = partID;
      inst.ref = { kind: childAssembly ? 'assembly' : 'cad' };
      // Reject if the swap introduces a cycle (e.g. replacing with this assembly's part).
      await assemblyRegenService.assertAcyclic({ partID: assembly.partID, assemblyDoc: doc }, db);
      await assembly.update({ assemblyDoc: doc, dirty: true });
      await recordHistory(assembly.id, req.user.id, 'instance_replaced', null, { instanceId: inst.instanceId, partID });
      // Mates keep their face references; incompatible faces surface as regen errors.
      return res.json({ instance: inst, assembly: await fetchActive(assembly.id) });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // POST /:id/patterns — add a linear/circular/mirror component pattern (REQ 760/761).
  async addPattern(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const { kind, seedInstanceId } = req.body || {};
      if (!['linear', 'circular', 'mirror'].includes(kind)) return res.status(400).json({ error: `Unknown pattern kind "${kind}"` });

      const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || INITIAL_ASSEMBLY_DOC));
      doc.instances = doc.instances || [];
      if (!doc.instances.some((i) => i.instanceId === seedInstanceId)) {
        return res.status(404).json({ error: `Seed instance ${seedInstanceId} not found` });
      }
      doc.patterns = doc.patterns || [];
      const patternId = `p${doc.nextPatternSeq || (doc.patterns.length + 1)}`;
      const b = req.body;
      const pattern = { patternId, kind, seedInstanceId, suppressed: false };
      if (kind === 'linear') { pattern.count = Number(b.count) || 2; pattern.spacing = b.spacing || [10, 0, 0]; }
      else if (kind === 'circular') { pattern.count = Number(b.count) || 2; pattern.axisOrigin = b.axisOrigin || [0, 0, 0]; pattern.axisDir = b.axisDir || [0, 0, 1]; pattern.angleStep = Number(b.angleStep) || (Math.PI / 4); }
      else { pattern.planeOrigin = b.planeOrigin || [0, 0, 0]; pattern.planeNormal = b.planeNormal || [1, 0, 0]; }
      doc.patterns.push(pattern);
      doc.nextPatternSeq = (doc.nextPatternSeq || doc.patterns.length) + 1;

      await assembly.update({ assemblyDoc: doc, dirty: true });
      await recordHistory(assembly.id, req.user.id, 'pattern_added', null, { patternId, kind });
      return res.status(201).json({ pattern, assembly: await fetchActive(assembly.id) });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // DELETE /:id/patterns/:patternId
  async removePattern(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || INITIAL_ASSEMBLY_DOC));
      const before = (doc.patterns || []).length;
      doc.patterns = (doc.patterns || []).filter((p) => p.patternId !== req.params.patternId);
      if (doc.patterns.length === before) return res.status(404).json({ error: `Pattern ${req.params.patternId} not found` });
      await assembly.update({ assemblyDoc: doc, dirty: true });
      await recordHistory(assembly.id, req.user.id, 'pattern_removed', null, { patternId: req.params.patternId });
      return res.json(await fetchActive(assembly.id));
    } catch (err) {
      return res.status(500).json({ error: `Failed to remove pattern: ${err.message}` });
    }
  },

  // POST /:id/mates — add a mate between faces on two distinct instances.
  async addMate(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const { type, a, b, value, flip } = req.body || {};
      const MATE_TYPES = ['coincident', 'concentric', 'parallel', 'perpendicular', 'distance', 'angle', 'tangent', 'lock'];
      if (!MATE_TYPES.includes(type)) return res.status(400).json({ error: `Unknown mate type "${type}"` });
      if (!a || !b || !a.instanceId || !b.instanceId || !a.faceId || !b.faceId) {
        return res.status(400).json({ error: 'Mate requires a and b, each with instanceId and faceId' });
      }
      if (a.instanceId === b.instanceId) return res.status(400).json({ error: 'A mate must reference two distinct instances' });

      const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || INITIAL_ASSEMBLY_DOC));
      doc.instances = doc.instances || [];
      const has = (id) => doc.instances.some((i) => i.instanceId === id);
      if (!has(a.instanceId)) return res.status(404).json({ error: `Instance ${a.instanceId} not found` });
      if (!has(b.instanceId)) return res.status(404).json({ error: `Instance ${b.instanceId} not found` });

      doc.mates = doc.mates || [];
      const mateId = `m${doc.nextMateSeq || (doc.mates.length + 1)}`;
      const mate = {
        mateId, type,
        a: { instanceId: a.instanceId, faceId: a.faceId },
        b: { instanceId: b.instanceId, faceId: b.faceId },
        ...(value !== undefined ? { value: Number(value) } : {}),
        ...(flip !== undefined ? { flip: !!flip } : {}),
        suppressed: false,
      };
      // The solver keys mates by `id`; carry it alongside `mateId`.
      mate.id = mateId;
      doc.mates.push(mate);
      doc.nextMateSeq = (doc.nextMateSeq || doc.mates.length) + 1;

      await assembly.update({ assemblyDoc: doc, dirty: true });
      await recordHistory(assembly.id, req.user.id, 'mate_added', null, { mateId, type });
      return res.status(201).json({ mate, assembly: await fetchActive(assembly.id) });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // DELETE /:id/mates/:mateId
  async removeMate(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || INITIAL_ASSEMBLY_DOC));
      const before = (doc.mates || []).length;
      doc.mates = (doc.mates || []).filter((m) => (m.mateId || m.id) !== req.params.mateId);
      if (doc.mates.length === before) return res.status(404).json({ error: `Mate ${req.params.mateId} not found` });
      await assembly.update({ assemblyDoc: doc, dirty: true });
      await recordHistory(assembly.id, req.user.id, 'mate_removed', null, { mateId: req.params.mateId });
      return res.json(await fetchActive(assembly.id));
    } catch (err) {
      return res.status(500).json({ error: `Failed to remove mate: ${err.message}` });
    }
  },

  // POST /:id/explode/auto — derive radial explode offsets from placements (REQ 764).
  async autoExplode(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || INITIAL_ASSEMBLY_DOC));
      const insts = (doc.instances || []).filter((i) => !i.suppressed);
      const spread = Number(req.body && req.body.spread) || 1.5;

      // Centroid of instance positions.
      const c = [0, 0, 0];
      for (const i of insts) { const t = (i.placement && i.placement.translate) || [0, 0, 0]; c[0] += t[0]; c[1] += t[1]; c[2] += t[2]; }
      if (insts.length) { c[0] /= insts.length; c[1] /= insts.length; c[2] /= insts.length; }

      const offsets = {};
      insts.forEach((inst, idx) => {
        const t = (inst.placement && inst.placement.translate) || [0, 0, 0];
        let d = [t[0] - c[0], t[1] - c[1], t[2] - c[2]];
        const mag = Math.hypot(d[0], d[1], d[2]);
        // Degenerate (coincident with centroid): fall back to a fan along +X by index.
        if (mag < 1e-6) d = [50 * (idx + 1), 0, 0];
        else d = [d[0] * spread, d[1] * spread, d[2] * spread];
        offsets[inst.instanceId] = d;
      });

      doc.explode = { offsets, factor: (doc.explode && doc.explode.factor) || 1 };
      await assembly.update({ assemblyDoc: doc, dirty: true });
      await recordHistory(assembly.id, req.user.id, 'auto_exploded', null, { count: insts.length });
      return res.json({ explode: doc.explode, assembly: await fetchActive(assembly.id) });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // PUT /:id/explode — set the explode factor and/or manual offsets.
  async setExplode(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || INITIAL_ASSEMBLY_DOC));
      doc.explode = doc.explode || { offsets: {}, factor: 1 };
      if (req.body.factor !== undefined) doc.explode.factor = Math.max(0, Math.min(1, Number(req.body.factor)));
      if (req.body.offsets !== undefined) doc.explode.offsets = req.body.offsets;
      await assembly.update({ assemblyDoc: doc });
      return res.json({ explode: doc.explode, assembly: await fetchActive(assembly.id) });
    } catch (err) {
      return res.status(500).json({ error: `Failed to set explode: ${err.message}` });
    }
  },

  // POST /:id/display-states — save current visibility as a named state (REQ 765).
  async saveDisplayState(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const name = (req.body && req.body.name && String(req.body.name).trim()) || '';
      if (!name) return res.status(400).json({ error: 'A display state name is required' });
      const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || INITIAL_ASSEMBLY_DOC));
      doc.displayStates = doc.displayStates || [];
      const hidden = (doc.instances || []).filter((i) => i.visible === false).map((i) => i.instanceId);
      const id = `ds${doc.nextDisplayStateSeq || (doc.displayStates.length + 1)}`;
      const state = { id, name, hidden };
      doc.displayStates.push(state);
      doc.nextDisplayStateSeq = (doc.nextDisplayStateSeq || doc.displayStates.length) + 1;
      await assembly.update({ assemblyDoc: doc, dirty: true });
      await recordHistory(assembly.id, req.user.id, 'display_state_saved', null, { id, name });
      return res.status(201).json({ state, assembly: await fetchActive(assembly.id) });
    } catch (err) {
      return res.status(500).json({ error: `Failed to save display state: ${err.message}` });
    }
  },

  // POST /:id/display-states/:stateId/apply — apply a saved visibility state.
  async applyDisplayState(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || INITIAL_ASSEMBLY_DOC));
      const state = (doc.displayStates || []).find((s) => s.id === req.params.stateId);
      if (!state) return res.status(404).json({ error: `Display state ${req.params.stateId} not found` });
      const hidden = new Set(state.hidden || []);
      for (const inst of doc.instances || []) inst.visible = !hidden.has(inst.instanceId);
      await assembly.update({ assemblyDoc: doc, dirty: true });
      return res.json(await fetchActive(assembly.id));
    } catch (err) {
      return res.status(500).json({ error: `Failed to apply display state: ${err.message}` });
    }
  },

  // DELETE /:id/display-states/:stateId
  async deleteDisplayState(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || INITIAL_ASSEMBLY_DOC));
      const before = (doc.displayStates || []).length;
      doc.displayStates = (doc.displayStates || []).filter((s) => s.id !== req.params.stateId);
      if (doc.displayStates.length === before) return res.status(404).json({ error: `Display state ${req.params.stateId} not found` });
      await assembly.update({ assemblyDoc: doc, dirty: true });
      return res.json(await fetchActive(assembly.id));
    } catch (err) {
      return res.status(500).json({ error: `Failed to delete display state: ${err.message}` });
    }
  },

  // POST /:id/regenerate — compose the assembly geometry for the viewer.
  async regenerate(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const composed = await assemblyRegenService.regenerateAssembly(assembly, { db, kernelClient: getDefaultClient() });
      // Persist the solved placements back into the doc when the requester holds
      // the edit lock — keeps the stored assembly truthful to its mated state and
      // warm-starts the next solve. (Read-only viewers just get the result.)
      if (composed.constraintState && assembly.lockedByUserID === req.user.id) {
        const doc = JSON.parse(JSON.stringify(assembly.assemblyDoc || {}));
        let changed = false;
        for (const ci of composed.instances) {
          const inst = (doc.instances || []).find((i) => i.instanceId === ci.instanceId);
          if (inst && JSON.stringify(inst.placement) !== JSON.stringify(ci.placement)) { inst.placement = ci.placement; changed = true; }
        }
        if (changed) await assembly.update({ assemblyDoc: doc });
      }
      // Strip BReps from the wire payload — the viewer only needs meshes.
      const bodies = composed.bodies.map(({ brep, ...b }) => b);
      return res.json({
        faces: composed.faces, vertices: composed.vertices, edges: composed.edges,
        bodies, instances: composed.instances, errors: composed.errors,
        constraintState: composed.constraintState,
      });
    } catch (err) {
      if (err instanceof KernelDisconnected || err instanceof KernelRpcError) {
        return res.status(503).json({ error: err.message });
      }
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // GET /:id/mass-properties — assembly volume + center of mass (REQ 768).
  async massProperties(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const composed = await assemblyRegenService.regenerateAssembly(assembly, { db, kernelClient: getDefaultClient() });
      return res.json({ ...assemblyAnalysisService.massProperties(composed), errors: composed.errors });
    } catch (err) {
      if (err instanceof KernelDisconnected || err instanceof KernelRpcError) return res.status(503).json({ error: err.message });
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // POST /:id/interference — detect interfering component pairs (REQ 767).
  async interference(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const client = getDefaultClient();
      const composed = await assemblyRegenService.regenerateAssembly(assembly, { db, kernelClient: client });
      const pairs = await assemblyAnalysisService.interference(composed, { kernelClient: client });
      return res.json({ pairs, errors: composed.errors });
    } catch (err) {
      if (err instanceof KernelDisconnected || err instanceof KernelRpcError) return res.status(503).json({ error: err.message });
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // POST /:id/bom/sync — write the assembly BOM into inventory BillOfMaterialItem (REQ 769).
  async syncBom(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const lines = assemblyRegenService.assemblyBom(assembly); // [{ partID(component), quantity }]
      // Replace prior BOM items for this assembly part.
      await db.BillOfMaterialItem.destroy({ where: { partID: assembly.partID }, force: true });
      const rows = await db.BillOfMaterialItem.bulkCreate(lines.map((l) => ({
        partID: assembly.partID, componentPartID: l.partID, quantity: l.quantity, activeFlag: true,
      })));
      await recordHistory(assembly.id, req.user.id, 'bom_synced', null, { count: rows.length });
      return res.json({ count: rows.length, items: rows.map((r) => ({ componentPartID: r.componentPartID, quantity: r.quantity })) });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // GET /:id/bom — aggregated bill of materials.
  async getBom(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const lines = assemblyRegenService.assemblyBom(assembly);
      const partIds = lines.map((l) => l.partID);
      const parts = partIds.length
        ? await db.Part.findAll({ where: { id: partIds }, attributes: ['id', 'name', 'sku', 'revision'] })
        : [];
      const byId = new Map(parts.map((p) => [p.id, p]));
      return res.json(lines.map((l, i) => ({
        item: i + 1,
        partID: l.partID,
        quantity: l.quantity,
        part: byId.get(l.partID) || null,
      })));
    } catch (err) {
      return res.status(500).json({ error: `Failed to build BOM: ${err.message}` });
    }
  },

  // GET /:id/export/step  |  /:id/export/stl
  async exportStep(req, res) { return exportAssembly(req, res, 'step'); },
  async exportStl(req, res) { return exportAssembly(req, res, 'stl'); },

  // GET /:id/history
  async getHistory(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const history = await db.DesignAssemblyHistory.findAll({
        where: { assemblyID: assembly.id },
        order: [['createdAt', 'DESC']],
        limit: 100,
      });
      return res.json(history);
    } catch (err) {
      return res.status(500).json({ error: `Failed to fetch history: ${err.message}` });
    }
  },

  // ── version control (Phase 2) ───────────────────────────────────────────────

  // POST /:id/checkout — acquire the edit lock, point the copy at the branch head.
  async checkout(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      await assemblyVcsService.checkout(assembly, req.user.id);
      return res.json(await withReleaseFlag(await fetchActive(assembly.id)));
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // POST /:id/checkin — commit the working copy.
  async checkin(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const { commitHash } = await assemblyVcsService.checkin(assembly, req.user.id, (req.body && req.body.message) || '');
      await recordHistory(assembly.id, req.user.id, 'checked_in', null, { commitHash });
      return res.json({ commitHash, model: await withReleaseFlag(await fetchActive(assembly.id)) });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // POST /:id/undo-checkout — discard working changes, roll back to base, unlock.
  async undoCheckout(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      await assemblyVcsService.undoCheckout(assembly, req.user.id);
      return res.json(await withReleaseFlag(await fetchActive(assembly.id)));
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // POST /:id/force-unlock — admin-release another user's lock (cad.approve).
  async forceUnlock(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      await assemblyVcsService.releaseLock(assembly, req.user.id, { force: true });
      return res.json(await withReleaseFlag(await fetchActive(assembly.id)));
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // GET /:id/commits — ordered commit history for the current branch.
  async getCommits(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      return res.json(await assemblyVcsService.history(assembly));
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // ── branches (shared vcsBranchOps) ──────────────────────────────────────────
  async listBranches(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      return res.json(await assemblyBranchService.listBranches(assembly));
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },
  async createBranch(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const branch = await assemblyBranchService.createBranch(assembly, (req.body && req.body.name) || '', { fromCommit: req.body && req.body.fromCommit }, req.user.id);
      return res.status(201).json(branch);
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },
  async switchBranch(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      await assemblyBranchService.switchBranch(assembly, (req.body && req.body.name) || '', req.user.id);
      return res.json(await withReleaseFlag(await fetchActive(assembly.id)));
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },
  async archiveBranch(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      return res.json(await assemblyBranchService.archiveBranch(assembly, req.params.name));
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // ── review workflow (shared workflowEngine, per-branch key) ──────────────────
  async getWorkflow(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const repo = await assemblyWorkflowRepo(assembly);
      return res.json({ state: await workflowEngine.getState(repo), actions: await workflowEngine.availableActions(repo, req.user.id) });
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },
  async transitionWorkflow(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const { action } = req.body || {};
      if (!action) return res.status(400).json({ error: 'action is required' });
      const repo = await assemblyWorkflowRepo(assembly);
      const r = await workflowEngine.transition(repo, action, req.user.id, { authorUserID: assembly.createdByUserID });
      const state = (r && typeof r === 'object') ? r.state : r;
      return res.json({ state, actions: await workflowEngine.availableActions(repo, req.user.id), model: await withReleaseFlag(await fetchActive(assembly.id)) });
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // GET /:id/graph — commit/branch graph for the version-history view.
  async getGraph(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const repo = await assemblyVcsService.repoForAssembly(assembly);
      return res.json(await cadGraphService.buildGraphForRepo(repo, assembly.baseCommitHash, db));
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // POST /:id/release — release a draft branch onto main as the next revision.
  async release(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const wf = await assemblyWorkflowRepo(assembly); // draft branch key (before release)
      const released = await releaseAssemblyToMain(assembly, req.user.id, { kernelClient: getDefaultClient() });
      await workflowEngine.setState(wf, 'draft', req.user.id);
      await recordHistory(assembly.id, req.user.id, 'released_to_main', null, released);
      return res.json({ commitHash: released.commitHash, revision: released.tag, model: await withReleaseFlag(await fetchActive(assembly.id)) });
    } catch (err) {
      if (err instanceof KernelDisconnected || err instanceof KernelRpcError) return res.status(503).json({ error: err.message });
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // GET /:id/release/step | /:id/release/stl — frozen released geometry export.
  async exportReleaseStep(req, res) { return exportFrozen(req, res, 'step'); },
  async exportReleaseStl(req, res) { return exportFrozen(req, res, 'stl'); },

  // GET /:id/commits/:a/diff/:b — structural diff (shared cadDiffService).
  async getCommitDiff(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const repo = await assemblyVcsService.repoForAssembly(assembly);
      return res.json(await cadDiffService.commitDiff(repo, req.params.a, req.params.b, db));
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // GET /:id/reconcile/preview — instances/mates that differ from main (merge picker).
  async reconcilePreview(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      return res.json({ changes: await assemblyBranchService.reconcileChanges(assembly, db) });
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // POST /:id/reconcile — merge main's latest + selected branch instances/mates.
  async reconcile(req, res) {
    try {
      const assembly = await fetchActive(Number(req.params.id));
      if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
      const sel = req.body || {};
      await assemblyBranchService.reconcileBranch(assembly, sel, req.user.id, {}, db);
      await recordHistory(assembly.id, req.user.id, 'merged', null, { branch: assembly.branchName });
      return res.json(await withReleaseFlag(await fetchActive(assembly.id)));
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // POST /:id/production-release — promote the released revision to a letter rev,
  // tagging the same frozen commit (cad.approve-gated, requires workflow approval).
  async productionRelease(req, res) {
    const assembly = await fetchActive(Number(req.params.id));
    if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
    const part = await db.Part.findByPk(assembly.partID);
    if (!part) return res.status(400).json({ error: 'Part not found for this assembly' });
    try {
      const repo = await assemblyVcsService.repoForAssembly(assembly);
      if (!assembly.releaseLocked) return res.status(409).json({ error: 'Release the assembly before promoting to production' });
      if (!(await workflowEngine.canRelease(await assemblyWorkflowRepo(assembly)))) {
        return res.status(409).json({ error: 'Production release requires workflow approval' });
      }
      const devRef = await vcsService.getRef(repo, String(part.revision));
      if (!devRef) return res.status(409).json({ error: 'Release tag not found' });
      const releaseCommit = devRef.targetHash;
      const result = await db.sequelize.transaction(async (transaction) => {
        const prodPart = await partRevisionService.releaseToProduction(part, req.user.id, { transaction });
        const prodAssembly = await db.DesignAssembly.create({
          name: assembly.name, partID: prodPart.id, assemblyDoc: assembly.assemblyDoc,
          branchName: assembly.branchName || 'main', baseCommitHash: releaseCommit,
          dirty: false, releaseLocked: true, lockedByUserID: null,
          createdByUserID: req.user.id, activeFlag: true,
        }, { transaction });
        await vcsService.createTag(repo, String(prodPart.revision), releaseCommit, req.user.id);
        return { prodPart, prodAssembly };
      });
      await workflowEngine.setState(await assemblyWorkflowRepo(assembly), 'draft', req.user.id);
      await recordHistory(result.prodAssembly.id, req.user.id, 'production_release', null, { revision: result.prodPart.revision, commitHash: releaseCommit });
      return res.json({ revision: result.prodPart.revision, prodModelID: result.prodAssembly.id, model: await withReleaseFlag(await fetchActive(result.prodAssembly.id)) });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },
};

// Export a RELEASED assembly's frozen geometry (no kernel regen): resolve the
// revision tag → its frozen commit → per-body BReps → serialize via the kernel.
async function exportFrozen(req, res, format) {
  try {
    const assembly = await fetchActive(Number(req.params.id));
    if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
    const part = assembly.part || await db.Part.findByPk(assembly.partID);
    const revision = part && part.revision;
    const repo = await assemblyVcsService.repoForAssembly(assembly);
    const ref = revision ? await vcsService.getRef(repo, String(revision)) : null;
    if (!ref) return res.status(409).json({ error: 'This revision has not been released yet' });
    const geo = await assemblyFreezeService.geometryForCommit(repo, assembly, ref.targetHash, {}, db);
    const breps = (geo.bodies || []).filter((b) => b.brep).map((b) => b.brep);
    if (!breps.length) return res.status(409).json({ error: 'Released revision has no body geometry' });
    const base = String(part?.sku || part?.name || `assembly-${assembly.id}`).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'assembly';
    const out = await cadRegenService.exportBodyBreps(breps, format, {});
    if (format === 'stl') {
      res.setHeader('Content-Type', 'model/stl');
      res.setHeader('Content-Disposition', `attachment; filename="${base}-${revision}.stl"`);
      return res.send(Buffer.from(out.stlBase64 || '', 'base64'));
    }
    res.setHeader('Content-Type', 'application/step');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-${revision}.step"`);
    return res.send(out.step);
  } catch (err) {
    if (err instanceof KernelDisconnected || err instanceof KernelRpcError) return res.status(503).json({ error: err.message });
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}

// Bake an instance placement (rotate-about-origin then translate) into a child
// BRep via the kernel pattern op, mirroring the MoveCopyBody dispatch.
async function placeBrep(brep, placement, client) {
  let out = brep;
  const q = (placement && placement.quaternion) || [0, 0, 0, 1];
  const t = (placement && placement.translate) || [0, 0, 0];
  const vlen = Math.hypot(q[0], q[1], q[2]);
  if (vlen > 1e-9) {
    const angle = 2 * Math.atan2(vlen, q[3]);
    if (Math.abs(angle) > 1e-9) {
      const axis = [q[0] / vlen, q[1] / vlen, q[2] / vlen];
      const rpc = await client.call('buildPattern', {
        brepBytes: out,
        transforms: [{ kind: 'rotate', origin: [0, 0, 0], direction: axis, angleRad: angle }],
      });
      out = rpc.brepBytes;
    }
  }
  if (t[0] || t[1] || t[2]) {
    const rpc = await client.call('buildPattern', {
      brepBytes: out,
      transforms: [{ kind: 'translate', dx: t[0], dy: t[1], dz: t[2] }],
    });
    out = rpc.brepBytes;
  }
  return out;
}

async function exportAssembly(req, res, format) {
  try {
    const assembly = await fetchActive(Number(req.params.id));
    if (!assembly) return res.status(404).json({ error: `Assembly ${req.params.id} not found` });
    const client = getDefaultClient();
    const composed = await assemblyRegenService.regenerateAssembly(assembly, { db, kernelClient: client });
    const breps = [];
    for (const body of composed.bodies) {
      if (!body.brep) continue;
      breps.push(await placeBrep(body.brep, body.placement, client));
    }
    if (!breps.length) return res.status(422).json({ error: 'Assembly has no body geometry to export' });
    const out = await cadRegenService.exportBodyBreps(breps, format, { kernelClient: client });

    const part = assembly.part || {};
    const base = String(part.sku || part.name || `assembly-${assembly.id}`).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'assembly';
    if (format === 'stl') {
      res.setHeader('Content-Type', 'model/stl');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.stl"`);
      return res.send(Buffer.from(out.stlBase64 || '', 'base64'));
    }
    res.setHeader('Content-Type', 'application/step');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.step"`);
    return res.send(out.step);
  } catch (err) {
    if (err instanceof KernelDisconnected || err instanceof KernelRpcError) {
      return res.status(503).json({ error: err.message });
    }
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}
