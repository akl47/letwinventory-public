const db = require('../../../models');
const cadRegenService = require('../../../services/cadRegenService');
const cadStreamService = require('../../../services/cadStreamService');
const cadVcsService = require('../../../services/vcs/cadVcsService');
const cadBranchService = require('../../../services/vcs/cadBranchService');
const cadDiffService = require('../../../services/vcs/cadDiffService');
const workflowEngine = require('../../../services/vcs/workflowEngine');
const vcsService = require('../../../services/vcs/vcsService');
const { KernelDisconnected, KernelRpcError } = require('../../../services/cadKernelClient');

const INITIAL_FEATURE_TREE = { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 };
const INITIAL_SKETCH_DOC = { sketches: {}, nextSketchSeq: 1 };
const INITIAL_EQUATIONS = { entries: {} };

async function recordHistory(cadModelID, changedByUserID, changeType, previousState, newState) {
  await db.DesignCADModelHistory.create({
    cadModelID, changedByUserID, changeType,
    previousState: previousState || null,
    newState: newState || null,
    createdAt: new Date(),
  });
}

function activeWhere(extra = {}) {
  return { activeFlag: true, ...extra };
}

async function fetchActiveModel(id) {
  return db.DesignCADModel.findOne({
    where: activeWhere({ id }),
    // Part identity feeds `#{partNumber}` / `#{partRevision}` etc. in sketch
    // text — cadRegenService builds the text-variable resolver from it.
    include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'sku', 'manufacturerPN', 'revision'] }],
  });
}

module.exports = {
  async listPartsWithCad(req, res) {
    try {
      // One working copy per part now. Revision identity is the Part's revision;
      // released revisions are write-once VCS tags on the part's repo.
      const rows = await db.DesignCADModel.findAll({
        where: { activeFlag: true },
        order: [['updatedAt', 'DESC']],
        include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'revision', 'description'] }],
      });
      const out = [];
      for (const m of rows) {
        const repo = await cadVcsService.repoForModel(m);
        const tags = await vcsService.listRefs(repo, 'tag');
        const partRev = m.part ? m.part.revision : null;
        out.push({
          partID: m.partID,
          part: m.part ? { id: m.part.id, name: m.part.name, revision: m.part.revision, description: m.part.description } : null,
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
        where: activeWhere({ partID }),
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
      const model = await db.DesignCADModel.findOne({
        where: activeWhere({ partID }),
        include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'sku', 'manufacturerPN', 'revision'] }],
      });
      if (!model) return res.status(404).json({ error: `No CAD models found for part ${partID}` });
      return res.json(model);
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
      await recordHistory(model.id, req.user.id, 'created', null, { partID });
      return res.status(201).json(model);
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
    return res.json(model);
  },

  async update(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });

    // VC-10: while another user holds a live checkout lock, reject edits with
    // 423 (Locked) naming the holder. An unheld (or self-held, or expired) lock
    // allows the edit — autosave never requires an explicit checkout.
    if (
      model.lockedByUserID && model.lockedByUserID !== req.user.id &&
      (!model.lockExpiresAt || new Date(model.lockExpiresAt) > new Date())
    ) {
      const holder = await db.User.findByPk(model.lockedByUserID);
      return res.status(423).json({
        error: `CAD model ${id} is checked out by ${holder ? holder.displayName : 'another user'}`,
      });
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
      return res.json(model);
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

    const part = model.part || await db.Part.findByPk(model.partID);
    const revision = part && part.revision;
    if (!revision) {
      return res.status(400).json({ error: `Part for CAD model ${id} has no revision to release as` });
    }

    try {
      const repo = await cadVcsService.repoForModel(model);
      // VC-37: release is gated by the review workflow.
      if (!(await workflowEngine.canRelease(repo))) {
        return res.status(409).json({ error: 'CAD model must be approved before it can be released' });
      }
      const { commitHash, tag } = await cadVcsService.release(model, req.user.id, revision, {});
      await workflowEngine.setState(repo, 'draft', req.user.id); // next change starts a fresh cycle
      await recordHistory(model.id, req.user.id, 'released', null, { revision: tag, commitHash });
      return res.json({ commitHash, revision: tag, model });
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
    try {
      await cadVcsService.checkout(model, req.user.id, {});
      return res.json(model);
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  async checkin(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    const message = (req.body && req.body.message) || '';
    try {
      const { commitHash } = await cadVcsService.checkin(model, req.user.id, message);
      return res.json({ commitHash, model });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  async releaseLock(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    try {
      await cadVcsService.releaseLock(model, req.user.id, { force: false });
      return res.json(model);
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
      await cadVcsService.releaseLock(model, req.user.id, { force: true });
      return res.json(model);
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  async getCommits(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });
    try {
      return res.json(await cadVcsService.history(model));
    } catch (err) {
      return res.status(500).json({ error: `Failed to fetch CAD commit log: ${err.message}` });
    }
  },

  // ── VCS: variant branches + cherry-pick (Phase 2) ───────────────────────────

  async listBranches(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    try { return res.json(await cadBranchService.listBranches(model)); }
    catch (err) { return res.status(500).json({ error: err.message }); }
  },

  async createBranch(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    const { name, fromCommit } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Branch name is required' });
    try { return res.json(await cadBranchService.createBranch(model, name, { fromCommit }, req.user.id)); }
    catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  async switchBranch(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Branch name is required' });
    try { await cadBranchService.switchBranch(model, name, req.user.id); return res.json(model); }
    catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  async archiveBranch(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    const name = req.params.name || (req.body && req.body.name);
    try { return res.json(await cadBranchService.archiveBranch(model, name)); }
    catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  async cherryPick(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
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
      const repo = await cadVcsService.repoForModel(model);
      return res.json(await cadDiffService.commitDiff(repo, req.params.a, req.params.b));
    } catch (err) { return res.status(err.statusCode || 500).json({ error: err.message }); }
  },

  async getBodyDiff3D(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    try {
      return res.json(await cadDiffService.bodyDiff3D(model, req.params.a, req.params.b, {}));
    } catch (err) {
      if (err instanceof KernelDisconnected) return res.status(503).json({ error: err.message });
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },

  // ── VCS: review workflow (Phase 4) ──────────────────────────────────────────

  async getWorkflow(req, res) {
    const model = await fetchActiveModel(Number(req.params.id));
    if (!model) return res.status(404).json({ error: `CAD model ${req.params.id} not found` });
    try {
      const repo = await cadVcsService.repoForModel(model);
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
      const repo = await cadVcsService.repoForModel(model);
      const r = await workflowEngine.transition(repo, action, req.user.id, { authorUserID: model.createdByUserID });
      return res.json({ state: r.state, actions: await workflowEngine.availableActions(repo, req.user.id) });
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
    // SolidWorks-style rollback bar: optional POST body field. Frontend
    // sends the index of the first feature to skip (matches the
    // rollbackBeforeIndex signal); backend skips features at/past that
    // index entirely, saving kernel work + cache lookups.
    const rollbackBeforeIndex =
      typeof req.body?.rollbackBeforeIndex === 'number' && req.body.rollbackBeforeIndex >= 0
        ? req.body.rollbackBeforeIndex
        : null;
    cadStreamService.broadcastToModel(id, { type: 'regenerate-started', modelId: id });
    try {
      const result = await cadRegenService.regenerateModel(model, {
        rollbackBeforeIndex,
        onFeatureResult: (featureResult) => {
          cadStreamService.broadcastToModel(id, {
            type: 'feature-result',
            modelId: id,
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
