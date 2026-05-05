/**
 * Disk-cached TTS using the local chatterbox-tts service.
 *
 * Cache key: sha256(`${voice}|${text}`). When the underlying text changes the
 * key changes, so old audio doesn't need to be invalidated explicitly — it
 * just becomes orphaned and can be cleaned up on a schedule if needed.
 *
 * Files live under FILE_STORAGE_PATH/tts-cache/<hash>.wav. Returns the path
 * for the caller to stream as the HTTP response body.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const DEFAULT_BASE_URL = process.env.TTS_BASE_URL || 'http://chatterbox-tts:4123';

function cacheDir() {
  const base = process.env.FILE_STORAGE_PATH || os.tmpdir();
  const dir = path.join(base, 'tts-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cacheKey(text, voice) {
  return crypto.createHash('sha256').update(`${voice}|${text}`).digest('hex');
}

function pathFor(key) {
  return path.join(cacheDir(), `${key}.wav`);
}

function postSpeech(baseUrl, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/v1/audio/speech`);
    const transport = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'audio/wav',
      },
    };
    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          let detail = buf.toString('utf8').slice(0, 500);
          return reject(Object.assign(
            new Error(`TTS service returned ${res.statusCode}: ${detail}`),
            { status: res.statusCode },
          ));
        }
        resolve(buf);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Returns the cache file path for the given text + voice. Generates and
 * persists the audio if not already cached.
 */
async function getOrGenerate(text, opts = {}) {
  if (!text || !text.trim()) {
    throw Object.assign(new Error('text is empty'), { status: 400 });
  }
  const voice = opts.voice || 'alloy';
  const baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  const key = cacheKey(text, voice);
  const filePath = pathFor(key);
  if (fs.existsSync(filePath)) return { path: filePath, cached: true };

  const buf = await postSpeech(baseUrl, {
    input: text,
    voice,
    response_format: 'wav',
    ...(opts.exaggeration != null ? { exaggeration: opts.exaggeration } : {}),
    ...(opts.cfg_weight != null ? { cfg_weight: opts.cfg_weight } : {}),
  });
  // Write atomically: write to .part then rename.
  const tmpPath = `${filePath}.part`;
  fs.writeFileSync(tmpPath, buf);
  fs.renameSync(tmpPath, filePath);
  return { path: filePath, cached: false };
}

const REQUIREMENT_TTS_FIELDS = ['description', 'rationale', 'parameter', 'verification', 'validation'];

const REQUIREMENT_LABELS = {
  description: 'Description',
  rationale: 'Rationale',
  parameter: 'Parameter',
  verification: 'Verification',
  validation: 'Validation',
};

/**
 * Concatenate every populated field into a single readable string. Kept for
 * the on-demand `field='all'` endpoint; we no longer pre-generate this on
 * requirement create/update — the frontend stitches per-field clips together
 * for "play all" instead.
 */
function buildCombinedRequirementText(requirement) {
  if (!requirement) return null;
  const parts = [];
  for (const field of REQUIREMENT_TTS_FIELDS) {
    const raw = requirement[field];
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (!text) continue;
    parts.push(`${REQUIREMENT_LABELS[field]}. ${text}`);
  }
  return parts.length ? parts.join(' ') : null;
}

/**
 * Fire-and-forget warm of the TTS cache for every text-bearing field on a
 * requirement. Errors are logged but never thrown — this runs after the DB
 * write has already completed.
 *
 * Fields are processed sequentially: chatterbox-tts has a tensor-batching
 * bug that 500s when synthesis requests overlap, so we await each one before
 * starting the next.
 */
function warmRequirementCache(requirement) {
  if (!requirement) return;
  (async () => {
    for (const field of REQUIREMENT_TTS_FIELDS) {
      const raw = requirement[field];
      if (typeof raw !== 'string') continue;
      const text = raw.trim();
      if (!text) continue;
      try {
        await getOrGenerate(text);
        await recordOwnerLink({ ownerType: 'design_requirement', ownerID: requirement.id, field, text });
      } catch (err) {
        console.warn(`[TTS] warm req ${requirement.id} ${field} failed: ${err.message}`);
      }
    }
  })().catch(() => {/* already logged per-field */});
}

/**
 * Returns whether a wav for the given (text, voice) pair is already on disk.
 * Empty/missing text returns false.
 */
function isCached(text, opts = {}) {
  if (!text || !text.trim()) return false;
  const voice = opts.voice || 'alloy';
  return fs.existsSync(pathFor(cacheKey(text, voice)));
}

/**
 * Upserts a TtsAudio row linking (ownerType, ownerID, field) to the cached
 * file. Lazy-requires models to avoid circular import. Best-effort: never
 * throws — the file cache is the authoritative source, the table is just a
 * reverse-lookup index.
 */
async function recordOwnerLink({ ownerType, ownerID, field, text, voice = 'alloy' }) {
  if (!ownerType || !ownerID || !field || !text) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    const db = require('../models');
    if (!db || !db.TtsAudio) return; // table not migrated yet → no-op
    const hash = cacheKey(trimmed, voice);
    const filePath = pathFor(hash);
    let sizeBytes = null;
    try { sizeBytes = fs.statSync(filePath).size; } catch { /* file missing — leave null */ }

    const [row, created] = await db.TtsAudio.findOrCreate({
      where: { ownerType, ownerID, field, textHash: hash },
      defaults: { filePath, voice, sizeBytes, generatedAt: new Date() },
    });
    if (!created) {
      const updates = {};
      if (row.filePath !== filePath) updates.filePath = filePath;
      if (sizeBytes != null && row.sizeBytes !== sizeBytes) updates.sizeBytes = sizeBytes;
      if (Object.keys(updates).length > 0) await row.update(updates);
    }
  } catch (err) {
    console.warn(`[TTS] recordOwnerLink failed (${ownerType} ${ownerID} ${field}): ${err.message}`);
  }
}

module.exports = {
  getOrGenerate, cacheKey, cacheDir, pathFor,
  isCached, warmRequirementCache, buildCombinedRequirementText,
  recordOwnerLink,
  REQUIREMENT_TTS_FIELDS,
};
