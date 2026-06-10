const db = require('../../../models');
const cadRegenService = require('../../../services/cadRegenService');
const cadStreamService = require('../../../services/cadStreamService');
const cadVcsService = require('../../../services/vcs/cadVcsService');
const cadBranchService = require('../../../services/vcs/cadBranchService');
const cadDiffService = require('../../../services/vcs/cadDiffService');
const cadGraphService = require('../../../services/vcs/cadGraphService');
const workflowEngine = require('../../../services/vcs/workflowEngine');
const vcsService = require('../../../services/vcs/vcsService');
const cadFreezeService = require('../../../services/vcs/cadFreezeService');
const { cadSerialize, cadDeserialize } = require('../../../services/vcs/cadSerializer');
const assemblyVcsService = require('../../../services/vcs/assemblyVcsService');
const assemblyBranchService = require('../../../services/vcs/assemblyBranchService');
const assemblyFreezeService = require('../../../services/vcs/assemblyFreezeService');
const { assemblySerialize } = require('../../../services/vcs/assemblySerializer');
const partRevisionService = require('../../../services/partRevisionService');
const RestError = require('../../../util/RestError');
const { KernelDisconnected, KernelRpcError, getDefaultClient } = require('../../../services/cadKernelClient');

const INITIAL_FEATURE_TREE = { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 };
const INITIAL_SKETCH_DOC = { sketches: {}, nextSketchSeq: 1 };
const INITIAL_EQUATIONS = { entries: {} };

// ── unified-table kind dispatch ───────────────────────────────────────────────
// Assemblies live in DesignCADModels (isAssembly=true). The VCS machinery is
// written once and bound per document kind; each handler stays one code path by
// pulling its services from the row's binding. repoType stays 'assembly' for
// assembly rows (the serializers differ), so existing repos/workflow keys hold.
const cadBinding = {
  vcs: cadVcsService,
  branch: cadBranchService,
  freeze: cadFreezeService,
  repoFor: (model, d) => cadVcsService.repoForModel(model, d),
  // Content columns cloned onto a new revision / production row.
  cloneContent: (m) => ({
    featureTree: m.featureTree, sketchDoc: m.sketchDoc,
    equations: m.equations || { entries: {} }, defaultView: m.defaultView || null,
  }),
  reconcileSel: (body) => ({ featureIds: (body && body.featureIds) || [], sketchIds: (body && body.sketchIds) || [] }),
  workingDiffBinding: null, // cadDiffService.workingDiff's default IS the CAD binding
  thumbnails: true,
};
const assemblyBinding = {
  vcs: assemblyVcsService,
  branch: assemblyBranchService,
  freeze: assemblyFreezeService,
  repoFor: (model, d) => assemblyVcsService.repoForAssembly(model, d),
  cloneContent: (m) => ({ isAssembly: true, assemblyDoc: m.assemblyDoc, defaultView: m.defaultView || null }),
  reconcileSel: (body) => ({ instanceIds: (body && body.instanceIds) || [], mateIds: (body && body.mateIds) || [] }),
  workingDiffBinding: {
    repoFor: (model, d) => assemblyVcsService.repoForAssembly(model, d),
    serialize: assemblySerialize,
    docOf: (m) => assemblyVcsService.docOf(m),
  },
  thumbnails: false,
};
const bindingFor = (model) => (model.isAssembly ? assemblyBinding : cadBinding);

// CAD-content-only endpoints (feature-tree regen, cherry-pick, 3D diff, …) make
// no sense for an assembly row; guard them with a uniform 422.
function rejectAssembly(model, res, what) {
  if (!model.isAssembly) return false;
  res.status(422).json({ error: `${what} is not supported for assemblies — use the assembly endpoints` });
  return true;
}

// Flatten a regen result to its FINAL renderable geometry. Each feature reports
// its target body's CUMULATIVE state, so keeping every feature would overlay the
// intermediate states (a boss/cut gets hidden by an earlier bare-body state).
// Keep only the LAST feature per body — matching the editor's per-body
// last-write-wins. Returns flat faces (for the lightweight preview) plus a
// per-body breakdown (for the editor's Bodies panel + show/hide).
function flattenFinalGeometry(geo) {
  const perBody = new Map();
  for (const f of geo.features || []) {
    if (f.error) continue;
    const bid = f.bodyId || f.featureId;
    if ((f.faces || []).length) perBody.set(bid, f);
  }
  const roster = (geo.bodies && geo.bodies.length)
    ? geo.bodies.filter(b => perBody.has(b.id))
    : [...perBody.keys()].map(id => ({ id, name: null }));
  const faces = [];
  const vertices = [];
  const edges = [];
  const bodies = [];
  for (const b of roster) {
    const f = perBody.get(b.id);
    if (!f) continue;
    const bFaces = (f.faces || []).map(face => ({ persistentName: face.persistentName, positions: face.positions, normals: face.normals, indices: face.indices }));
    const bVerts = [];
    const bEdges = [];
    const topo = f.topology || {};
    for (const v of topo.vertices || []) if (v.position) bVerts.push(v.position);
    for (const e of topo.edges || []) {
      const poly = (e.polyline && e.polyline.length) ? e.polyline : (e.endpoints || []);
      if (poly.length >= 2) bEdges.push({ polyline: poly });
    }
    faces.push(...bFaces);
    vertices.push(...bVerts);
    edges.push(...bEdges);
    bodies.push({ id: b.id, name: b.name || null, faces: bFaces, vertices: bVerts, edges: bEdges });
  }
  return { faces, vertices, edges, bodyCount: bodies.length, bodies };
}

async function recordHistory(cadModelID, changedByUserID, changeType, previousState, newState) {
  await db.DesignCADModelHistory.create({
    cadModelID, changedByUserID, changeType,
    previousState: previousState || null,
    newState: newState || null,
    createdAt: new Date(),
  });
}

// Every Part id in a part's revision lineage (root + all descendant revisions).
// A CAD model is keyed to the lineage but `model.partID` points at ONE revision
// (a release repoints it forward), so looking it up from any *other* revision
// needs a lineage-wide IN-match rather than an exact partID. Walk up via
// previousRevisionID to the root, then down to collect every descendant.
async function lineagePartIds(partID) {
  let part = await db.Part.findByPk(partID);
  if (!part) return [partID];
  const seen = new Set();
  while (part.previousRevisionID && !seen.has(part.id)) {
    seen.add(part.id);
    const prev = await db.Part.findByPk(part.previousRevisionID);
    if (!prev) break;
    part = prev;
  }
  const all = new Set([part.id]);
  let frontier = [part.id];
  while (frontier.length) {
    const kids = await db.Part.findAll({ where: { previousRevisionID: frontier }, attributes: ['id'] });
    frontier = kids.map(k => k.id).filter(id => !all.has(id));
    frontier.forEach(id => all.add(id));
  }
  return [...all];
}

function activeWhere(extra = {}) {
  return { activeFlag: true, ...extra };
}

// Augment a model with `released`: true when a write-once release tag named for
// the part's current revision exists (release tags are named by Parts.revision).
async function withReleaseFlag(model) {
  const repo = await bindingFor(model).repoFor(model);
  // Revision numbers come from the Parts table (single source of truth —
  // advanced only by a dev release or a manual new revision), via the same
  // helper the draft branch name uses, so the badge and the branch name agree
  // and the draft rev bumps as soon as a new Part revision exists.
  const highest = await cadVcsService.highestReleasedNumeric(model);
  const onMain = (model.branchName || 'main') === 'main';
  // On `main` the displayed revision is the highest released numeric; on a draft
  // branch it's the derived next number (highest + 1) — shared by all drafts.
  const displayRevision = onMain
    ? (highest > 0 ? cadVcsService.padNumeric(highest) : null)
    : cadVcsService.padNumeric(highest + 1);
  // `released` = on main with at least one released VCS tag on the lineage.
  const tags = await vcsService.listRefs(repo, 'tag');
  const released = onMain && tags.some((t) => /^\d+$/.test(t.name));
  // A draft branch is "behind main" when main has advanced (another branch
  // released) since it last incorporated main — it must rebase before releasing.
  let behindMain = false;
  if (!onMain) {
    const mainRef = await vcsService.getRef(repo, 'main');
    const branchRef = await vcsService.getRef(repo, model.branchName);
    if (mainRef && branchRef) {
      const ancestry = (await vcsService.walk(repo, branchRef.targetHash)).map((c) => c.hash);
      behindMain = !ancestry.includes(mainRef.targetHash);
    }
  }
  return { ...model.toJSON(), released, displayRevision, draftRevision: onMain ? null : displayRevision, behindMain };
}

// Export a RELEASED revision's frozen geometry (STEP or STL). Resolves the
// write-once tag named for the Part revision → its frozen commit → per-body
// BReps (no kernel regen), then serializes via the kernel.
async function exportRelease(req, res, format) {
  const id = Number(req.params.id);
  const model = await fetchActiveModel(id);
  if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
  const part = model.part || await db.Part.findByPk(model.partID);
  const revision = part && part.revision;
  try {
    const binding = bindingFor(model);
    const repo = await binding.repoFor(model);
    const ref = revision ? await vcsService.getRef(repo, String(revision)) : null;
    if (!ref) return res.status(409).json({ error: 'This revision has not been released yet' });
    const geo = await binding.freeze.geometryForCommit(repo, model, ref.targetHash, {});
    const breps = (geo.bodies || []).filter((b) => b.brep).map((b) => b.brep);
    if (!breps.length) return res.status(409).json({ error: 'Released revision has no body geometry' });
    const pn = String(part?.sku || part?.name || `part-${model.partID}`);
    const base = `${pn}-${revision}`.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'part';
    if (format === 'stl') {
      const { stlBase64 } = await cadRegenService.exportBodyBreps(breps, 'stl', {});
      res.setHeader('Content-Type', 'model/stl');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.stl"`);
      return res.send(Buffer.from(stlBase64 || '', 'base64'));
    }
    const { step } = await cadRegenService.exportBodyBreps(breps, 'step', {});
    res.setHeader('Content-Type', 'application/step');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.step"`);
    return res.send(step);
  } catch (err) {
    if (err instanceof KernelDisconnected) return res.status(503).json({ error: `CAD kernel unavailable: ${err.message}` });
    if (err instanceof KernelRpcError) return res.status(500).json({ error: `CAD kernel error (${err.code}): ${err.message}` });
    return res.status(err.statusCode || 500).json({ error: `Export failed: ${err.message}` });
  }
}

async function fetchActiveModel(id) {
  return db.DesignCADModel.findOne({
    where: activeWhere({ id }),
    // Part identity feeds `#{partNumber}` / `#{partRevision}` etc. in sketch
    // text — cadRegenService builds the text-variable resolver from it.
    include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'sku', 'manufacturerPN', 'revision'] }],
  });
}

// `main` is protected: it is the released history and may never be edited
// directly. It advances ONLY through the submit → approve → release path. Any
// draft branch is editable. (This is independent of `releaseLocked`, which is a
// belt-and-suspenders flag set once a model is released onto main.)
function isLockedForEdit(model) {
  return (model.branchName || 'main') === 'main';
}

// CAD review workflow state is tracked PER BRANCH, so multiple draft branches
// can each be in review at once, and `main` keeps its own production-approval
// cycle. The engine key is "<lineage-root>:<branchName>".
async function workflowRepo(model) {
  const repo = await bindingFor(model).repoFor(model);
  return { repoType: repo.repoType, repoId: `${repo.repoId}:${model.branchName || 'main'}` };
}

// Submit-to-main release (REQ — submit→approve→release). On workflow approval of
// a draft branch, its checked-in work becomes the next released numeric revision
// ON main: squash-style — main gains one release commit carrying the branch doc
// + frozen geometry, the numeric Part revision is minted, and the draft branch
// is archived. The branch must be up to date with main (rebase first if behind).
// NOTE: not transactional across the Part mint + VCS release (house style); the
// write-once tag guards against a double release.
async function releaseBranchToMain(model, userId, opts = {}) {
  const binding = bindingFor(model);
  const branchName = model.branchName;
  if (!branchName || branchName === 'main') {
    throw new RestError('Only a draft branch can be released to main', 409);
  }
  if (model.dirty || !model.baseCommitHash) {
    throw new RestError('Check in the branch before releasing it', 409);
  }
  const repo = await binding.repoFor(model);
  const mainRef = await vcsService.getRef(repo, 'main');
  const branchRef = await vcsService.getRef(repo, branchName);
  if (mainRef && branchRef) {
    const ancestry = (await vcsService.walk(repo, branchRef.targetHash)).map((c) => c.hash);
    if (!ancestry.includes(mainRef.targetHash)) {
      throw new RestError('Branch is behind main — rebase before releasing', 409);
    }
  }
  // Mint the next numeric Part revision; tag with its authoritative number.
  const part = await db.Part.findByPk(model.partID);
  const newPart = await partRevisionService.createNewRevision(part, userId);
  await model.update({ partID: newPart.id });
  // Release onto main: freeze + commit the branch doc onto main + write-once tag.
  // Parent the release commit off the BRANCH head (not main's) so the branch's
  // intermediate commits become part of main's history — git-style, rather than
  // squashing them away. (The branch is guaranteed up to date with main by the
  // ancestry check above, so main stays in the new commit's ancestry too.)
  const branchHead = branchRef ? branchRef.targetHash : (model.baseCommitHash || null);
  model.branchName = 'main';
  const { commitHash, tag } = await binding.vcs.release(
    model, userId, newPart.revision,
    { ...opts, parents: branchHead ? [branchHead] : undefined },
  );
  await model.update({ releaseLocked: true, branchName: 'main' });
  if (!newPart.revisionLocked) await newPart.update({ revisionLocked: true });
  await vcsService.deleteRef(repo, branchName);
  return { commitHash, tag, newPartID: newPart.id, branch: branchName };
}

module.exports = {
  async listPartsWithCad(req, res) {
    try {
      // One working copy per part now. Revision identity is the Part's revision;
      // released revisions are write-once VCS tags on the part's repo.
      const rows = await db.DesignCADModel.findAll({
        where: { activeFlag: true },
        order: [['updatedAt', 'DESC']],
        include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'revision', 'description', 'imageFileID'] }],
      });
      const out = [];
      for (const m of rows) {
        const repo = await bindingFor(m).repoFor(m);
        const tags = await vcsService.listRefs(repo, 'tag');
        const partRev = m.part ? m.part.revision : null;
        out.push({
          partID: m.partID,
          part: m.part ? { id: m.part.id, name: m.part.name, revision: m.part.revision, description: m.part.description, imageFileID: m.part.imageFileID } : null,
          // Unified landing: assemblies are design rows too (Type column + the
          // assembly editor as the open target).
          isAssembly: !!m.isAssembly,
          instanceCount: m.isAssembly ? ((m.assemblyDoc && m.assemblyDoc.instances) || []).length : undefined,
          revisionCount: tags.length,
          latestRevisionID: m.id,
          latestRevision: partRev,
          latestReleaseState: tags.length ? 'released' : 'draft',
          latestUpdatedAt: m.updatedAt,
          hasReleased: tags.length > 0,
          releasedRevisionID: tags.length ? m.id : null,
          releasedRevision: tags.length ? partRev : null,
        });
      }
      return res.json(out);
    } catch (err) {
      return res.status(500).json({ error: `Failed to list parts with CAD: ${err.message}` });
    }
  },

  async listByPart(req, res) {
    try {
      const partID = Number(req.params.partID);
      const rows = await db.DesignCADModel.findAll({
        where: activeWhere({ partID: await lineagePartIds(partID) }),
        order: [['createdAt', 'DESC']],
      });
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: `Failed to list CAD models: ${err.message}` });
    }
  },

  async getActiveByPart(req, res) {
    try {
      const partID = Number(req.params.partID);
      // Resolve across the whole revision lineage — the CAD model may sit on a
      // different revision than the one being viewed (see lineagePartIds).
      const model = await db.DesignCADModel.findOne({
        where: activeWhere({ partID: await lineagePartIds(partID) }),
        include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'sku', 'manufacturerPN', 'revision'] }],
        // Deterministic pick if a lineage ever holds more than one active row.
        order: [['updatedAt', 'DESC']],
      });
      if (!model) return res.status(404).json({ error: `No CAD models found for part ${partID}` });
      return res.json(await withReleaseFlag(model));
    } catch (err) {
      return res.status(500).json({ error: `Failed to fetch active CAD model: ${err.message}` });
    }
  },

  async createForPart(req, res) {
    const partID = Number(req.params.partID);
    const { name } = req.body || {};

    const part = await db.Part.findByPk(partID);
    if (!part) {
      return res.status(404).json({ error: `Part ${partID} does not exist` });
    }
    // Assembly-category parts get assembly designs (created via the assembly
    // endpoints) — steer away before the unique index would block them anyway.
    if (part.partCategoryID) {
      const category = await db.PartCategory.findByPk(part.partCategoryID);
      if (category && category.name === 'Assembly') {
        return res.status(422).json({ error: 'This part is in the Assembly category — create an assembly instead (POST /api/design/assembly/by-part/:partID)' });
      }
    }

    const conflict = await db.DesignCADModel.findOne({ where: activeWhere({ partID }) });
    if (conflict) {
      return res.status(409).json({ error: `Part ${partID} already has a CAD model` });
    }

    try {
      const model = await db.DesignCADModel.create({
        name: name || null,
        partID,
        featureTree: INITIAL_FEATURE_TREE,
        sketchDoc: INITIAL_SKETCH_DOC,
        equations: INITIAL_EQUATIONS,
        createdByUserID: req.user.id,
        activeFlag: true,
      });
      // Seed `main` with an initial commit, then auto-create the first draft
      // branch (draft/01) and land the working copy on it — `main` is protected,
      // so the user always edits on a draft branch. If the repo already exists
      // (a prior model on this lineage was soft-deleted) the refs may be present,
      // so reuse the draft branch instead of re-creating it.
      const mainHead = await cadVcsService.seedMain(model, req.user.id);
      const repo = await cadVcsService.repoForModel(model);
      const draftName = `draft/${await cadVcsService.derivedDraftRev(model)}`;
      if (!(await vcsService.getRef(repo, draftName))) {
        await cadBranchService.createBranch(model, draftName, { fromCommit: mainHead }, req.user.id);
      }
      await cadBranchService.switchBranch(model, draftName, req.user.id);
      await recordHistory(model.id, req.user.id, 'created', null, { partID, branch: draftName });
      return res.status(201).json(await withReleaseFlag(model));
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: `Part ${partID} already has a CAD model` });
      }
      return res.status(500).json({ error: `Failed to create CAD model: ${err.message}` });
    }
  },

  async getById(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    return res.json(await withReleaseFlag(model));
  },

  async update(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    if (rejectAssembly(model, res, 'Feature-tree update')) return undefined;

    // `main` is protected — edits happen on a draft branch and reach main only
    // via submit → approve → release.
    if (isLockedForEdit(model)) {
      return res.status(423).json({ error: 'The main branch is protected — create or switch to a draft branch to make changes' });
    }
    // Edits require an active checkout held by THIS user — nothing can change
    // unless the model is checked out (PDM semantics). Reject otherwise with 423.
    if (model.lockedByUserID !== req.user.id) {
      if (model.lockedByUserID) {
        const holder = await db.User.findByPk(model.lockedByUserID);
        return res.status(423).json({
          error: `CAD model ${id} is checked out by ${holder ? holder.displayName : 'another user'}`,
        });
      }
      return res.status(423).json({ error: `Check out CAD model ${id} before editing it` });
    }

    const patch = {};
    const previousSnapshot = {
      featureTree: model.featureTree,
      sketchDoc: model.sketchDoc,
      equations: model.equations,
    };
    if (req.body && req.body.featureTree !== undefined) patch.featureTree = req.body.featureTree;
    if (req.body && req.body.sketchDoc !== undefined) patch.sketchDoc = req.body.sketchDoc;
    if (req.body && req.body.equations !== undefined) patch.equations = req.body.equations;
    if (req.body && req.body.name !== undefined) patch.name = req.body.name;
    // Any content change makes the working copy differ from its base commit (VC-13).
    if (patch.featureTree !== undefined || patch.sketchDoc !== undefined || patch.equations !== undefined) {
      patch.dirty = true;
    }

    try {
      await model.update(patch);
      await recordHistory(model.id, req.user.id, 'updated', previousSnapshot, {
        featureTree: model.featureTree,
        sketchDoc: model.sketchDoc,
        equations: model.equations,
      });
      return res.json(await withReleaseFlag(model));
    } catch (err) {
      return res.status(500).json({ error: `Failed to update CAD model: ${err.message}` });
    }
  },

  async delete(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });

    try {
      await model.update({ activeFlag: false });
      await recordHistory(model.id, req.user.id, 'deleted', { activeFlag: true }, { activeFlag: false });
      return res.status(204).end();
    } catch (err) {
      return res.status(500).json({ error: `Failed to delete CAD model: ${err.message}` });
    }
  },

  // Release the current working copy as the Part's revision: commit it, freeze
  // its geometry, and tag the commit with Parts.revision (VC-18). There is no
  // separate CAD revision/release-state — Parts.revision is the single identity
  // (VC-19). Route is gated by cad.approve.
  async release(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });

    try {
      const wf = await workflowRepo(model);
      // A draft branch releases ONTO main SELF-SERVICE (no review/approval): mint
      // the numeric rev, advance main, freeze + tag, lock the Part, archive the
      // branch. (The approval gate lives on the production-letter release, not here.)
      if ((model.branchName || 'main') !== 'main') {
        const released = await releaseBranchToMain(model, req.user.id);
        await workflowEngine.setState(wf, 'draft', req.user.id);
        await recordHistory(model.id, req.user.id, 'released_to_main', null, released);
        const refreshed = await fetchActiveModel(model.id);
        return res.json({ commitHash: released.commitHash, revision: released.tag, model: await withReleaseFlag(refreshed) });
      }
      // Legacy in-place release on main still requires workflow approval.
      if (!(await workflowEngine.canRelease(wf))) {
        return res.status(409).json({ error: 'CAD model must be approved before it can be released' });
      }
      const part = model.part || await db.Part.findByPk(model.partID);
      const revision = part && part.revision;
      if (!revision) return res.status(400).json({ error: `Part for CAD model ${id} has no revision to release as` });
      const { commitHash, tag } = await bindingFor(model).vcs.release(model, req.user.id, revision, {});
      await workflowEngine.setState(wf, 'draft', req.user.id);
      await recordHistory(model.id, req.user.id, 'released', null, { revision: tag, commitHash });
      return res.json({ commitHash, revision: tag, model: await withReleaseFlag(model) });
    } catch (err) {
      // Release freezes geometry through the kernel — surface kernel-down as 503,
      // not a generic 500, so the editor can show the offline notice.
      if (err instanceof KernelDisconnected || err instanceof KernelRpcError) return res.status(503).json({ error: err.message });
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // Development release (REQ 715-718): self-service (cad.write). Requires the
  // design be checked in; freezes + tags the numeric revision, then locks it.
  async devRelease(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    if (rejectAssembly(model, res, 'Development release')) return undefined;
    try {
      const { commitHash, tag } = await cadVcsService.devRelease(model, req.user.id, {});
      await recordHistory(model.id, req.user.id, 'dev_released', null, { revision: tag, commitHash });
      return res.json({ commitHash, revision: tag, model: await withReleaseFlag(model) });
    } catch (err) {
      if (err instanceof KernelDisconnected) return res.status(503).json({ error: err.message });
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // Download a released revision's frozen geometry (REQ 719).
  async exportReleaseStep(req, res) { return exportRelease(req, res, 'step'); },
  async exportReleaseStl(req, res) { return exportRelease(req, res, 'stl'); },

  // New revision (REQ 720): create the next NUMERIC Part revision + a fresh
  // editable CAD model copying this design. Used to edit a locked release.
  async newRevision(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    // The model's included `part` has only a few attributes; revision-cloning
    // needs the full row, so fetch it.
    const part = await db.Part.findByPk(model.partID);
    if (!part) return res.status(400).json({ error: 'Part not found for this model' });
    try {
      const newModel = await db.sequelize.transaction(async (transaction) => {
        const newPart = await partRevisionService.createNewRevision(part, req.user.id, { transaction });
        return db.DesignCADModel.create({
          name: model.name, partID: newPart.id,
          ...bindingFor(model).cloneContent(model),
          branchName: model.branchName || 'main', baseCommitHash: model.baseCommitHash || null,
          dirty: false, releaseLocked: false, lockedByUserID: null,
          createdByUserID: req.user.id, activeFlag: true,
        }, { transaction });
      });
      await recordHistory(newModel.id, req.user.id, 'new_revision', null, { fromModelID: model.id, fromRevision: part.revision });
      // A new revision starts a fresh review cycle: reset the workflow to draft so
      // the new editable revision is not carrying the prior revision's approved /
      // in-review state. Workflow state is keyed PER BRANCH (workflowRepo), so use
      // that composed key — setting it on the bare lineage repo would be ignored by
      // every getState/canRelease, which read the branch-scoped key.
      await workflowEngine.setState(await workflowRepo(newModel), 'draft', req.user.id);
      const full = await fetchActiveModel(newModel.id);
      return res.json(await withReleaseFlag(full));
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // Production release (REQ 721/722): from a dev-released, workflow-approved
  // design, create the next LETTER Part revision + a CAD model carrying the SAME
  // frozen commit, tag it, and lock the source. Same geometry by construction.
  async productionRelease(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    // Full Part row (the included one has limited attributes) for revision cloning.
    const part = await db.Part.findByPk(model.partID);
    if (!part) return res.status(400).json({ error: 'Part not found for this model' });
    try {
      const repo = await bindingFor(model).repoFor(model);
      if (!model.releaseLocked) {
        return res.status(409).json({ error: 'Create a development release before promoting to production' });
      }
      if (!(await workflowEngine.canRelease(await workflowRepo(model)))) {
        return res.status(409).json({ error: 'Production release requires workflow approval' });
      }
      const devRef = await vcsService.getRef(repo, String(part.revision));
      if (!devRef) return res.status(409).json({ error: 'Development release tag not found' });
      const releaseCommit = devRef.targetHash;
      const result = await db.sequelize.transaction(async (transaction) => {
        const prodPart = await partRevisionService.releaseToProduction(part, req.user.id, { transaction });
        const prodModel = await db.DesignCADModel.create({
          name: model.name, partID: prodPart.id,
          ...bindingFor(model).cloneContent(model),
          branchName: model.branchName || 'main', baseCommitHash: releaseCommit,
          dirty: false, releaseLocked: true, lockedByUserID: null,
          createdByUserID: req.user.id, activeFlag: true,
        }, { transaction });
        // Tag the SAME frozen commit with the letter revision (write-once). Inside
        // the txn callback so a tag failure rolls back the new Part + model.
        await vcsService.createTag(repo, String(prodPart.revision), releaseCommit, req.user.id);
        return { prodPart, prodModel };
      });
      await workflowEngine.setState(await workflowRepo(model), 'draft', req.user.id);
      await recordHistory(result.prodModel.id, req.user.id, 'production_release', null, { revision: result.prodPart.revision, commitHash: releaseCommit, fromModelID: model.id });
      const full = await fetchActiveModel(result.prodModel.id);
      return res.json({ revision: result.prodPart.revision, prodModelID: result.prodModel.id, model: await withReleaseFlag(full) });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  async getHistory(req, res) {
    const id = Number(req.params.id);
    try {
      const rows = await db.DesignCADModelHistory.findAll({
        where: { cadModelID: id },
        order: [['createdAt', 'ASC']],
      });
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: `Failed to fetch CAD model history: ${err.message}` });
    }
  },

  // ── VCS: checkout / check-in / lock / commit log (Phase 1) ──────────────────

  async checkout(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    // `main` is protected — check out a draft branch to make changes.
    if (isLockedForEdit(model)) {
      return res.status(423).json({ error: 'The main branch is protected — create or switch to a draft branch to make changes' });
    }
    try {
      await bindingFor(model).vcs.checkout(model, req.user.id, {});
      return res.json(await withReleaseFlag(model));
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  async checkin(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    const message = (req.body && req.body.message) || '';
    const thumbnail = req.body && req.body.thumbnail;
    const binding = bindingFor(model);
    try {
      const { commitHash } = await binding.vcs.checkin(model, req.user.id, message);
      // Best-effort: a missing/invalid thumbnail must not fail the check-in.
      // (Assemblies don't capture thumbnails — binding.thumbnails gates it.)
      if (thumbnail && binding.thumbnails) {
        try { await cadVcsService.storeThumbnail(model, commitHash, thumbnail); } catch { /* ignore */ }
      }
      // Check-in releases the lock — the next edit requires a fresh check-out.
      await binding.vcs.releaseLock(model, req.user.id);
      return res.json({ commitHash, model: await withReleaseFlag(model) });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // Undo checkout: discard uncommitted changes, roll back to the last check-in,
  // and release the lock.
  async undoCheckout(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    try {
      await bindingFor(model).vcs.undoCheckout(model, req.user.id);
      return res.json(await withReleaseFlag(model));
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // Admin override — route is gated by cad.approve.
  async forceUnlock(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    try {
      await bindingFor(model).vcs.releaseLock(model, req.user.id, { force: true });
      return res.json(await withReleaseFlag(model));
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  async getCommits(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    try {
      return res.json(await bindingFor(model).vcs.history(model));
    } catch (err) {
      return res.status(500).json({ error: `Failed to fetch CAD commit log: ${err.message}` });
    }
  },

  // Full version graph (all branches) for the part's CAD history view.
  async getGraph(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    try {
      const repo = await bindingFor(model).repoFor(model);
      return res.json(await cadGraphService.buildGraphForRepo(repo, model.baseCommitHash, db));
    } catch (err) {
      return res.status(500).json({ error: `Failed to build CAD version graph: ${err.message}` });
    }
  },

  // ── VCS: variant branches + cherry-pick (Phase 2) ───────────────────────────

  async listBranches(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    try { return res.json(await bindingFor(model).branch.listBranches(model)); }
    catch (err) { return res.status(500).json({ error: err.message }); }
  },

  async createBranch(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    const { name, fromCommit } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Branch name is required' });
    try { return res.json(await bindingFor(model).branch.createBranch(model, name, { fromCommit }, req.user.id)); }
    catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  async switchBranch(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Branch name is required' });
    try { await bindingFor(model).branch.switchBranch(model, name, req.user.id); return res.json(await withReleaseFlag(model)); }
    catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  async archiveBranch(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    const name = req.params.name || (req.body && req.body.name);
    try { return res.json(await bindingFor(model).branch.archiveBranch(model, name)); }
    catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  async rebaseBranch(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    if (rejectAssembly(model, res, 'Rebase')) return undefined;
    try {
      await cadBranchService.rebaseBranch(model, req.user.id);
      return res.json(await withReleaseFlag(await fetchActiveModel(model.id)));
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // Merge main into the current branch, applying the selected branch changes
  // (features+sketches for part models; instances+mates for assemblies).
  async reconcileBranch(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    const binding = bindingFor(model);
    try {
      await binding.branch.reconcileBranch(model, binding.reconcileSel(req.body), req.user.id);
      return res.json(await withReleaseFlag(await fetchActiveModel(model.id)));
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // The CHANGE LIST a merge would consider — main vs the current branch.
  // Assembly counterpart of the merge picker's feature list. GET (the 3D POST
  // preview below is part-CAD-only).
  async reconcileChanges(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    if (!model.isAssembly) return res.json({ changes: [] }); // part-CAD merge picker derives its list from commit diffs
    try {
      return res.json({ changes: await assemblyBranchService.reconcileChanges(model, db) });
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // 3D geometry of the HYPOTHETICAL merge result (main + selected branch
  // features) — regenerated without committing, for the merge tool's preview.
  async reconcilePreview(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    if (rejectAssembly(model, res, '3D merge preview')) return undefined;
    const featureIds = (req.body && req.body.featureIds) || [];
    const sketchIds = (req.body && req.body.sketchIds) || [];
    const branch = (req.body && req.body.branch) || model.branchName;
    try {
      const merged = await cadBranchService.mergedReconcileDoc(model, branch, { featureIds, sketchIds });
      // Include `part` so #{partName}/#{partRevision} text placeholders resolve
      // (otherwise glyph regions — and regionIndices — come out wrong).
      const pseudo = { id: model.id, partID: model.partID, part: model.part, featureTree: merged.featureTree, sketchDoc: merged.sketchDoc, equations: merged.equations };
      const geo = await cadRegenService.regenerateModel(pseudo, {});
      // Same per-body flatten as the commit preview (avoid overlaying every
      // feature's cumulative state, which hid bosses like f17). Surface regen
      // errors too so the merge UI can flag conflicting features (e.g. an
      // Up-To-Surface extrude whose target no longer applies post-merge).
      return res.json({ ...flattenFinalGeometry(geo), errors: geo.errors || [] });
    } catch (err) {
      if (err instanceof KernelDisconnected || err instanceof KernelRpcError) return res.status(503).json({ error: err.message });
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  async cherryPick(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    if (rejectAssembly(model, res, 'Cherry-pick')) return undefined;
    const { sourceCommit, featureId } = req.body || {};
    if (!sourceCommit || !featureId) return res.status(400).json({ error: 'sourceCommit and featureId are required' });
    try { const r = await cadBranchService.cherryPick(model, sourceCommit, featureId, req.user.id); return res.json(r.model); }
    catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // ── VCS: diff (Phase 3) ─────────────────────────────────────────────────────

  async getCommitDiff(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    try {
      const repo = await bindingFor(model).repoFor(model);
      return res.json(await cadDiffService.commitDiff(repo, req.params.a, req.params.b));
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  async getBodyDiff3D(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    if (rejectAssembly(model, res, '3D body diff')) return undefined;
    try {
      return res.json(await cadDiffService.bodyDiff3D(model, req.params.a, req.params.b, {}));
    } catch (err) {
      if (err instanceof KernelDisconnected) return res.status(503).json({ error: err.message });
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // A single commit's geometry (frozen if released, else regenerated) trimmed to
  // the face meshes — for the lightweight per-commit 3D preview thumbnails.
  async getCommitGeometry(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    if (rejectAssembly(model, res, 'Commit geometry preview')) return undefined;
    try {
      const repo = await cadVcsService.repoForModel(model);
      const geo = await cadDiffService.regenCommitGeometry(repo, model, req.params.hash, {});
      return res.json(flattenFinalGeometry(geo));
    } catch (err) {
      if (err instanceof KernelDisconnected) return res.status(503).json({ error: err.message });
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // Reconstruct a commit's CAD document (featureTree / sketchDoc / equations)
  // from its content-addressed tree. Read-only: powers the editor's "Open
  // version" view (REQ 743), which renders a historical commit without
  // touching the working copy. No kernel calls — pure object-store reads.
  async getCommitDoc(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    if (rejectAssembly(model, res, 'Commit document reconstruction')) return undefined;
    try {
      const repo = await cadVcsService.repoForModel(model);
      const commit = await vcsService.getCommit(repo, req.params.hash, db);
      if (!commit) return res.status(404).json({ error: `Commit ${req.params.hash} not found` });
      const doc = await cadDeserialize(repo, commit.treeHash, db);
      return res.json({
        featureTree: doc.featureTree,
        sketchDoc: doc.sketchDoc,
        equations: doc.equations,
        hash: req.params.hash,
        message: commit.message || null,
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // Real CAD-kernel health probe. Pings the Rust/OCCT kernel over the same
  // singleton connection the regenerate path uses, so the editor can show an
  // accurate "kernel offline" state (distinct from the best-effort WebSocket
  // progress stream) and refuse to render when geometry can't be produced.
  // Always HTTP 200 — the payload IS the status.
  async kernelStatus(req, res) {
    try {
      await getDefaultClient().call('ping', {}, { timeoutMs: 4000 });
      return res.json({ online: true, namingVersion: cadRegenService.NAMING_VERSION });
    } catch (_err) {
      return res.json({ online: false });
    }
  },

  // Uncommitted changes: the working copy diffed against its base commit (the
  // last check-in). Powers the check-in dialog's change list.
  async getWorkingDiff(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    try {
      return res.json(await cadDiffService.workingDiff(model, undefined, bindingFor(model).workingDiffBinding));
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // Face-level diff between two commits (REQ 712). Returns each side's persistent
  // face-name set so the Compare view can paint added faces green / removed red.
  async getFaceDiff(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    if (rejectAssembly(model, res, 'Face diff')) return undefined;
    try {
      const diff = await cadDiffService.faceNameDiff(model, req.params.a, req.params.b, {});
      return res.json(diff);
    } catch (err) {
      if (err instanceof KernelDisconnected) return res.status(503).json({ error: err.message });
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // The low-resolution PNG captured at check-in (REQ 710/711). Served as an
  // image so the version-history preview can show it instantly as a placeholder
  // while the full geometry loads. 404 when no thumbnail was captured.
  async getCommitThumbnail(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    try {
      const img = await cadVcsService.loadThumbnail(model, req.params.hash);
      if (!img) return res.status(404).json({ error: 'No thumbnail for this commit' });
      // Thumbnails captured at check-in are PNG; backfilled ones are SVG. Detect
      // by the leading byte ('<' = SVG) so both serve with the right type.
      const isSvg = img.length > 0 && img[0] === 0x3c;
      res.set('Content-Type', isSvg ? 'image/svg+xml' : 'image/png');
      res.set('Cache-Control', 'private, max-age=31536000, immutable');
      return res.send(img);
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // Persist the model's default camera view (REQ 708/709). A view preference,
  // not versioned doc content — deliberately NOT gated by the edit lock.
  async setDefaultView(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    const v = req.body || {};
    const valid = v && Number.isFinite(v.theta) && Number.isFinite(v.phi)
      && Number.isFinite(v.distance) && Array.isArray(v.target) && v.target.length === 3
      && v.target.every((n) => Number.isFinite(n));
    if (!valid) return res.status(400).json({ error: 'A default view needs numeric theta, phi, distance and a [x,y,z] target' });
    try {
      await model.update({ defaultView: { theta: v.theta, phi: v.phi, distance: v.distance, target: v.target } });
      return res.json(await withReleaseFlag(model));
    } catch (err) { return res.status(500).json({ error: `Failed to save default view: ${err.message}` }); }
  },

  // ── VCS: review workflow (Phase 4) ──────────────────────────────────────────

  async getWorkflow(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    try {
      const repo = await workflowRepo(model);
      return res.json({ state: await workflowEngine.getState(repo), actions: await workflowEngine.availableActions(repo, req.user.id) });
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // The route is read-gated; the engine enforces each transition's own permission.
  async transitionWorkflow(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    const { action } = req.body || {};
    if (!action) return res.status(400).json({ error: 'action is required' });
    try {
      const repo = await workflowRepo(model);
      const r = await workflowEngine.transition(repo, action, req.user.id, { authorUserID: model.createdByUserID });
      // Approval does NOT auto-release — the user then explicitly releases the
      // approved branch onto main via POST /:id/release (cad.approve).
      return res.json({
        state: r.state,
        actions: await workflowEngine.availableActions(repo, req.user.id),
        model: await withReleaseFlag(await fetchActiveModel(model.id)),
      });
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  // Phase 1 — server-side regen. Walks the feature tree, looks up each
  // feature's tessellated faces in DesignBRepCache, falls through to the
  // Rust kernel via TCP JSON-RPC on cache miss. Returns the merged face
  // geometry for the viewer.
  //
  // Phase 1.5 — additionally broadcasts per-feature progress over the
  // cadStreamService WebSocket so subscribed editor sessions render each
  // feature as it completes (don't wait for the full HTTP response). The
  // HTTP response stays canonical for clients that never subscribe (tests,
  // future CLI tools, fallback path on WS-down).
  async regenerate(req, res) {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid model id' });
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: 'CAD model not found' });
    if (rejectAssembly(model, res, 'Feature-tree regeneration')) return undefined;
    // `#{partRevision}` text = the rev being worked on: a draft branch's derived
    // display rev (highest released + 1), or the released revision on main —
    // matching the editor's badge + preview so the engraved rev is consistent.
    const onMainBranch = (model.branchName || 'main') === 'main';
    model.__partRevision = onMainBranch
      ? (model.part && model.part.revision) || ''
      : await cadVcsService.derivedDraftRev(model);
    // SolidWorks-style rollback bar: optional POST body field. Frontend
    // sends the index of the first feature to skip (matches the
    // rollbackBeforeIndex signal); backend skips features at/past that
    // index entirely, saving kernel work + cache lookups.
    const rollbackBeforeIndex =
      typeof req.body?.rollbackBeforeIndex === 'number' && req.body.rollbackBeforeIndex >= 0
        ? req.body.rollbackBeforeIndex
        : null;
    // Per-tab regen id (from the client) so the stream can be correlated to the
    // tab that triggered it — two windows on the same model share this channel.
    const regenId = (req.body && req.body.regenId) || null;
    cadStreamService.broadcastToModel(id, { type: 'regenerate-started', modelId: id, regenId });
    try {
      let dbgCached = 0, dbgKernel = 0;
      const result = await cadRegenService.regenerateModel(model, {
        rollbackBeforeIndex,
        onFeatureResult: (featureResult) => {
          if (featureResult.cached) dbgCached++; else if (!featureResult.error) dbgKernel++;
          cadStreamService.broadcastToModel(id, {
            type: 'feature-result',
            modelId: id,
            regenId,
            featureId: featureResult.featureId,
            // bodyId is load-bearing for the frontend's per-body stream
            // handler — without it, the handler returns early and the
            // body never appears until the HTTP response lands.
            bodyId: featureResult.bodyId,
            bodyDeleted: featureResult.bodyDeleted,
            faces: featureResult.faces,
            topology: featureResult.topology,
            cached: featureResult.cached,
            error: featureResult.error,
          });
        },
      });
      cadStreamService.broadcastToModel(id, {
        type: 'regenerate-complete',
        modelId: id,
        regenId,
        errors: result.errors,
      });
      return res.json({
        modelId: id,
        revision: model.part?.revision ?? null,
        ...result,
      });
    } catch (err) {
      cadStreamService.broadcastToModel(id, {
        type: 'regenerate-complete',
        modelId: id,
        regenId,
        errors: [err.message],
      });
      if (err instanceof KernelDisconnected) {
        return res.status(503).json({ error: `CAD kernel unavailable: ${err.message}` });
      }
      if (err instanceof KernelRpcError) {
        return res.status(500).json({ error: `CAD kernel error (${err.code}): ${err.message}` });
      }
      return res.status(500).json({ error: `Regenerate failed: ${err.message}` });
    }
  },

  /** Export the model's bodies as a downloadable STEP file. Regenerates
   * (cache-backed) to get the final body BReps, then has the kernel combine +
   * serialize them via STEPControl_Writer. */
  async exportStep(req, res) {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid model id' });
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: 'CAD model not found' });
    if (rejectAssembly(model, res, 'Live STEP export')) return undefined; // assemblies export via /api/design/assembly/:id/export/*
    // Optional ?bodyIds=a,b,c to export only a subset of bodies.
    const bodyIds = typeof req.query.bodyIds === 'string' && req.query.bodyIds.trim()
      ? req.query.bodyIds.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;
    try {
      const { step } = await cadRegenService.exportModelStep(model, { bodyIds });
      const pn = String(model.part?.sku || model.part?.name || `part-${model.partID}`);
      const rev = String(model.part?.revision || '');
      const base = (rev ? `${pn}-${rev}` : pn)
        .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'part';
      res.setHeader('Content-Type', 'application/step');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.step"`);
      return res.send(step);
    } catch (err) {
      if (err instanceof KernelDisconnected) {
        return res.status(503).json({ error: `CAD kernel unavailable: ${err.message}` });
      }
      if (err instanceof KernelRpcError) {
        return res.status(500).json({ error: `CAD kernel error (${err.code}): ${err.message}` });
      }
      return res.status(500).json({ error: `STEP export failed: ${err.message}` });
    }
  },

  // exported for unit testing in isolation
  _internals: { INITIAL_FEATURE_TREE, INITIAL_SKETCH_DOC },
};
