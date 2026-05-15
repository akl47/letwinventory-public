const db = require('../../../models');
const cadRegenService = require('../../../services/cadRegenService');
const { KernelDisconnected, KernelRpcError } = require('../../../services/cadKernelClient');

const INITIAL_FEATURE_TREE = { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 };
const INITIAL_SKETCH_DOC = { sketches: {}, nextSketchSeq: 1 };

function nextRevisionLetter(letter) {
  const chars = letter.split('');
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] === 'Z') {
      chars[i] = 'A';
      i--;
    } else {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join('');
    }
  }
  return 'A' + chars.join('');
}

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
  return db.DesignCADModel.findOne({ where: activeWhere({ id }) });
}

module.exports = {
  async listPartsWithCad(req, res) {
    try {
      const rows = await db.DesignCADModel.findAll({
        where: { activeFlag: true },
        order: [['updatedAt', 'DESC']],
        include: [{ model: db.Part, as: 'part', attributes: ['id', 'name', 'revision', 'description'] }],
      });
      // Aggregate one row per part: latest revision, release state, counts.
      const byPart = new Map();
      for (const m of rows) {
        const partID = m.partID;
        if (!byPart.has(partID)) {
          byPart.set(partID, {
            partID,
            part: m.part ? { id: m.part.id, name: m.part.name, revision: m.part.revision, description: m.part.description } : null,
            revisionCount: 0,
            latestRevisionID: null,
            latestRevision: null,
            latestReleaseState: null,
            latestUpdatedAt: null,
            hasReleased: false,
            releasedRevisionID: null,
            releasedRevision: null,
          });
        }
        const agg = byPart.get(partID);
        agg.revisionCount += 1;
        if (!agg.latestUpdatedAt || new Date(m.updatedAt) > new Date(agg.latestUpdatedAt)) {
          agg.latestUpdatedAt = m.updatedAt;
          agg.latestRevisionID = m.id;
          agg.latestRevision = m.revision;
          agg.latestReleaseState = m.releaseState;
        }
        if (m.releaseState === 'released' && (!agg.releasedRevisionID || new Date(m.releasedAt) > new Date(agg.releasedRevisionID))) {
          agg.hasReleased = true;
          agg.releasedRevisionID = m.id;
          agg.releasedRevision = m.revision;
        }
      }
      return res.json(Array.from(byPart.values()));
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
      const released = await db.DesignCADModel.findOne({
        where: activeWhere({ partID, releaseState: 'released' }),
        order: [['releasedAt', 'DESC']],
      });
      if (released) return res.json(released);
      const draft = await db.DesignCADModel.findOne({
        where: activeWhere({ partID }),
        order: [['createdAt', 'DESC']],
      });
      if (!draft) return res.status(404).json({ error: `No CAD models found for part ${partID}` });
      return res.json(draft);
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

    const conflict = await db.DesignCADModel.findOne({
      where: activeWhere({ partID, revision: 'A' }),
    });
    if (conflict) {
      return res.status(409).json({
        error: `Part ${partID} already has an active CAD model at revision A — use new-revision to create a successor`,
      });
    }

    try {
      const model = await db.DesignCADModel.create({
        name: name || null,
        partID,
        revision: 'A',
        previousRevisionID: null,
        featureTree: INITIAL_FEATURE_TREE,
        sketchDoc: INITIAL_SKETCH_DOC,
        releaseState: 'draft',
        createdByUserID: req.user.id,
        activeFlag: true,
      });
      await recordHistory(model.id, req.user.id, 'created', null, {
        revision: model.revision,
        releaseState: model.releaseState,
      });
      return res.status(201).json(model);
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: `A CAD model already exists at this part and revision` });
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

    if (model.releaseState !== 'draft') {
      return res.status(400).json({
        error: `CAD model ${id} is in '${model.releaseState}' state and is read-only; only draft models can be edited`,
      });
    }

    const patch = {};
    const previousSnapshot = { featureTree: model.featureTree, sketchDoc: model.sketchDoc };
    if (req.body && req.body.featureTree !== undefined) patch.featureTree = req.body.featureTree;
    if (req.body && req.body.sketchDoc !== undefined) patch.sketchDoc = req.body.sketchDoc;
    if (req.body && req.body.name !== undefined) patch.name = req.body.name;

    try {
      await model.update(patch);
      await recordHistory(model.id, req.user.id, 'updated', previousSnapshot, {
        featureTree: model.featureTree, sketchDoc: model.sketchDoc,
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

    if (model.releaseState !== 'draft') {
      return res.status(400).json({
        error: `CAD model ${id} is in '${model.releaseState}' state and cannot be deleted; only draft models can be soft-deleted`,
      });
    }

    try {
      await model.update({ activeFlag: false });
      await recordHistory(model.id, req.user.id, 'deleted', { activeFlag: true }, { activeFlag: false });
      return res.status(204).end();
    } catch (err) {
      return res.status(500).json({ error: `Failed to delete CAD model: ${err.message}` });
    }
  },

  async submit(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });

    if (model.releaseState !== 'draft') {
      return res.status(400).json({
        error: `CAD model ${id} cannot be submitted from '${model.releaseState}' state; expected 'draft'`,
      });
    }

    try {
      await model.update({ releaseState: 'review', submittedAt: new Date() });
      await recordHistory(model.id, req.user.id, 'submitted', { releaseState: 'draft' }, { releaseState: 'review' });
      return res.json(model);
    } catch (err) {
      return res.status(500).json({ error: `Failed to submit CAD model: ${err.message}` });
    }
  },

  async release(req, res) {
    const id = Number(req.params.id);
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: `CAD model ${id} not found` });

    if (model.releaseState !== 'review') {
      return res.status(400).json({
        error: `CAD model ${id} cannot be released from '${model.releaseState}' state; submit it for review first`,
      });
    }

    try {
      await model.update({
        releaseState: 'released',
        releasedAt: new Date(),
        releasedByUserID: req.user.id,
      });
      await recordHistory(model.id, req.user.id, 'released',
        { releaseState: 'review' },
        { releaseState: 'released', releasedByUserID: req.user.id },
      );
      return res.json(model);
    } catch (err) {
      return res.status(500).json({ error: `Failed to release CAD model: ${err.message}` });
    }
  },

  async newRevision(req, res) {
    const id = Number(req.params.id);
    const source = await fetchActiveModel(id);
    if (!source) return res.status(404).json({ error: `CAD model ${id} not found` });

    if (source.releaseState !== 'released') {
      return res.status(400).json({
        error: `Cannot create a new revision from CAD model ${id}; expected 'released' state, got '${source.releaseState}'`,
      });
    }

    const newRevision = nextRevisionLetter(source.revision);

    const conflict = await db.DesignCADModel.findOne({
      where: activeWhere({ partID: source.partID, revision: newRevision }),
    });
    if (conflict) {
      return res.status(409).json({
        error: `Part ${source.partID} already has an active CAD model at revision ${newRevision}`,
      });
    }

    try {
      const created = await db.DesignCADModel.create({
        name: source.name,
        partID: source.partID,
        revision: newRevision,
        previousRevisionID: source.id,
        featureTree: source.featureTree,
        sketchDoc: source.sketchDoc,
        releaseState: 'draft',
        createdByUserID: req.user.id,
        activeFlag: true,
      });
      await recordHistory(created.id, req.user.id, 'new_revision',
        { previousRevisionID: source.id, sourceRevision: source.revision },
        { revision: created.revision, releaseState: 'draft' },
      );
      return res.status(201).json(created);
    } catch (err) {
      return res.status(500).json({ error: `Failed to create new revision: ${err.message}` });
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

  // Phase 1 — server-side regen. Walks the feature tree, looks up each
  // feature's tessellated faces in DesignBRepCache, falls through to the
  // Rust kernel via Unix-socket JSON-RPC on cache miss. Returns the merged
  // face geometry for the viewer.
  async regenerate(req, res) {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid model id' });
    const model = await fetchActiveModel(id);
    if (!model) return res.status(404).json({ error: 'CAD model not found' });
    try {
      const result = await cadRegenService.regenerateModel(model);
      return res.json({
        modelId: id,
        revision: model.revision,
        ...result,
      });
    } catch (err) {
      if (err instanceof KernelDisconnected) {
        return res.status(503).json({ error: `CAD kernel unavailable: ${err.message}` });
      }
      if (err instanceof KernelRpcError) {
        return res.status(500).json({ error: `CAD kernel error (${err.code}): ${err.message}` });
      }
      return res.status(500).json({ error: `Regenerate failed: ${err.message}` });
    }
  },

  // exported for unit testing in isolation
  _internals: { nextRevisionLetter, INITIAL_FEATURE_TREE, INITIAL_SKETCH_DOC },
};
