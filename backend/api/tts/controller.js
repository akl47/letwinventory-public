const fs = require('fs');
const db = require('../../models');
const ttsCache = require('../../services/ttsCache');

const REQUIREMENT_FIELDS = new Set([...ttsCache.REQUIREMENT_TTS_FIELDS, 'all']);

exports.requirementStatus = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const requirement = await db.DesignRequirement.findByPk(id, {
      attributes: ['id', 'activeFlag', ...ttsCache.REQUIREMENT_TTS_FIELDS],
    });
    if (!requirement || !requirement.activeFlag) {
      return res.status(404).json({ error: 'Requirement not found' });
    }
    const status = {};
    for (const f of ttsCache.REQUIREMENT_TTS_FIELDS) {
      const text = (requirement[f] || '').toString().trim();
      status[f] = text ? ttsCache.isCached(text) : null; // null = no text → no audio
    }
    // 'all' is a virtual field — the frontend plays per-field audios
    // sequentially. Cached only when every populated per-field clip exists.
    let allCached = null;
    let anyText = false;
    for (const f of ttsCache.REQUIREMENT_TTS_FIELDS) {
      if (status[f] === null) continue;
      anyText = true;
      if (status[f] === false) { allCached = false; break; }
    }
    if (allCached === null) allCached = anyText ? true : null;
    status.all = allCached;
    res.json(status);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'TTS status error' });
  }
};

/**
 * List every TtsAudio row for a given owner.
 * GET /api/tts/owner/:ownerType/:ownerID
 */
exports.listForOwner = async (req, res) => {
  try {
    const { ownerType, ownerID } = req.params;
    const idNum = parseInt(ownerID, 10);
    if (!ownerType || !Number.isFinite(idNum)) {
      return res.status(400).json({ error: 'ownerType and numeric ownerID required' });
    }
    const rows = await db.TtsAudio.findAll({
      where: { ownerType, ownerID: idNum },
      attributes: ['id', 'ownerType', 'ownerID', 'field', 'textHash', 'voice', 'sizeBytes', 'generatedAt'],
      order: [['field', 'ASC']],
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * SSE stream of synthesis progress for one requirement field. Emits the same
 * shape the upstream wrapper does: `progress`, `completed`, `error` events.
 */
exports.requirementFieldEvents = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const field = req.params.field;
    if (!REQUIREMENT_FIELDS.has(field)) {
      return res.status(400).json({ error: `Unsupported field '${field}'` });
    }
    const attrs = field === 'all'
      ? ['id', 'activeFlag', ...ttsCache.REQUIREMENT_TTS_FIELDS]
      : ['id', 'activeFlag', field];
    const requirement = await db.DesignRequirement.findByPk(id, { attributes: attrs });
    if (!requirement || !requirement.activeFlag) {
      return res.status(404).json({ error: 'Requirement not found' });
    }
    const text = field === 'all'
      ? ttsCache.buildCombinedRequirementText(requirement)
      : (requirement[field] || '').toString().trim() || null;
    if (!text) {
      return res.status(404).json({ error: `Requirement ${id} has no ${field} text` });
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const emitter = ttsCache.subscribeToProgress(text, { voice: 'alloy' });
    const send = (event, data) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`); }
      catch { /* socket already closed */ }
    };
    emitter.on('progress', (data) => send('progress', data));
    emitter.on('completed', (data) => { send('completed', data); try { res.end(); } catch {} });
    emitter.on('error', (data) => { send('error', data); try { res.end(); } catch {} });
    req.on('close', () => {
      emitter.removeAllListeners();
      try { res.end(); } catch {}
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: err.message || 'TTS events error' });
    } else {
      try { res.end(); } catch {}
    }
  }
};

exports.requirementField = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const field = req.params.field;
    if (!REQUIREMENT_FIELDS.has(field)) {
      return res.status(400).json({ error: `Unsupported field '${field}'` });
    }
    const attrs = field === 'all'
      ? ['id', 'activeFlag', ...ttsCache.REQUIREMENT_TTS_FIELDS]
      : ['id', 'activeFlag', field];
    const requirement = await db.DesignRequirement.findByPk(id, { attributes: attrs });
    if (!requirement || !requirement.activeFlag) {
      return res.status(404).json({ error: 'Requirement not found' });
    }

    let text;
    if (field === 'all') {
      text = ttsCache.buildCombinedRequirementText(requirement);
    } else {
      text = (requirement[field] || '').toString().trim() || null;
    }
    if (!text) {
      return res.status(404).json({ error: `Requirement ${id} has no ${field} text` });
    }

    const result = await ttsCache.getOrGenerate(text, { voice: 'alloy' });
    // Record (or refresh) the reverse-lookup row in the background.
    ttsCache.recordOwnerLink({
      ownerType: 'design_requirement', ownerID: id, field, text,
    }).catch(() => {/* logged inside */});
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-TTS-Cached', result.cached ? '1' : '0');
    fs.createReadStream(result.path).pipe(res);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'TTS error' });
  }
};
