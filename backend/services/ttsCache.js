/**
 * Disk-cached TTS using a wrapper service that exposes a jobs API with SSE
 * progress events. We always use POST /api/tts/jobs (not /speak), so callers
 * can subscribe to progress for any synthesis.
 *
 * Cache key: sha256(`${voice}|${text}`). When the underlying text changes the
 * key changes, so old audio doesn't need to be invalidated explicitly — it
 * just becomes orphaned and can be cleaned up on a schedule if needed.
 *
 * Files live under FILE_STORAGE_PATH/tts-cache/<hash>.mp3. Returns the path
 * for the caller to stream as the HTTP response body.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

const DEFAULT_BASE_URL = process.env.TTS_BASE_URL || 'http://10.50.10.25:5001';

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
  return path.join(cacheDir(), `${key}.mp3`);
}

function describeNetworkError(err, baseUrl, hostname) {
  switch (err && err.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `TTS hostname '${hostname}' did not resolve. Set TTS_BASE_URL in the backend env to a reachable TTS URL.`;
    case 'ECONNREFUSED':
      return `TTS server at ${baseUrl} refused the connection.`;
    case 'ETIMEDOUT':
      return `TTS server at ${baseUrl} timed out. Check connectivity.`;
    default:
      return `TTS server at ${baseUrl} unreachable: ${err && err.message ? err.message : err}`;
  }
}

function postJobCreate(baseUrl, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/tts/jobs`);
    const transport = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          return reject(Object.assign(
            new Error(`Job create at ${baseUrl} returned ${res.statusCode}: ${buf.slice(0, 500)}`),
            { status: res.statusCode },
          ));
        }
        try { resolve(JSON.parse(buf)); }
        catch (err) { reject(new Error(`Job create returned non-JSON: ${buf.slice(0, 200)}`)); }
      });
    });
    req.on('error', (err) => reject(Object.assign(
      new Error(describeNetworkError(err, baseUrl, url.hostname)),
      { status: 502, cause: err },
    )));
    req.write(body);
    req.end();
  });
}

function getJobStatus(baseUrl, jobId) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/tts/jobs/${jobId}`);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'GET',
      headers: { Accept: 'application/json' },
      // 15s per-request timeout: enough for a busy wrapper to respond, short
      // enough that a dropped connection doesn't strand a generation forever.
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          return reject(Object.assign(
            new Error(`Job status at ${baseUrl} returned ${res.statusCode}: ${text.slice(0, 200)}`),
            { status: res.statusCode },
          ));
        }
        try { resolve(JSON.parse(text)); }
        catch { reject(new Error(`Job status returned non-JSON: ${text.slice(0, 200)}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Job status request timed out')));
    req.on('error', (err) => reject(Object.assign(
      new Error(describeNetworkError(err, baseUrl, url.hostname)),
      { status: 502, cause: err },
    )));
    req.end();
  });
}

/**
 * Poll the wrapper's job status endpoint until the job completes or fails.
 * Relays each status as a 'progress' event on the emitter; rejects with the
 * wrapper's message on failure. Polling is more robust than SSE here because
 * the wrapper's SSE has been observed to go silent mid-synthesis (chatterbox
 * pauses event emission for long-running chunks).
 */
async function pollJobUntilDone(baseUrl, jobId, emitter) {
  const intervalMs = 500;
  // Cap consecutive transient errors so a wrapper that's permanently down
  // doesn't keep us looping forever.
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 10;

  while (true) {
    let status;
    try {
      status = await getJobStatus(baseUrl, jobId);
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw err;
      }
      await new Promise(r => setTimeout(r, intervalMs));
      continue;
    }
    const state = status.status;
    if (state === 'completed') {
      emitter.emit('progress', { progress: 100 });
      return;
    }
    if (state === 'failed' || state === 'error') {
      throw Object.assign(
        new Error(status.message || status.error || 'TTS job failed'),
        { status: 502 },
      );
    }
    if (typeof status.progress === 'number') {
      emitter.emit('progress', {
        progress: status.progress,
        current_chunk: status.current_chunk,
        total_chunks: status.total_chunks,
        estimated_remaining_seconds: status.estimated_remaining_seconds,
      });
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

function getJobAudio(baseUrl, jobId) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/tts/jobs/${jobId}/audio`);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'GET',
      headers: { Accept: 'audio/mpeg' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          return reject(Object.assign(
            new Error(`Audio fetch returned ${res.statusCode}: ${buf.toString('utf8').slice(0, 500)}`),
            { status: res.statusCode },
          ));
        }
        resolve(buf);
      });
    });
    req.on('error', (err) => reject(Object.assign(
      new Error(describeNetworkError(err, baseUrl, url.hostname)),
      { status: 502, cause: err },
    )));
    req.end();
  });
}

// The wrapper's chatterbox sidecar has a tensor-batching bug that 500s when
// synthesis requests overlap. Serialize all outbound job orchestration so
// background warm jobs and user-initiated fetches can't collide.
let ttsJobQueue = Promise.resolve();

// In-flight orchestration state, keyed by text+voice hash. Lets concurrent
// callers (audio fetch + SSE progress subscribers) join the same generation
// instead of kicking off duplicate jobs.
const inflightJobs = new Map();      // hash -> Promise<void> (resolves when wav is on disk)
const inflightEmitters = new Map();  // hash -> EventEmitter (emits progress/completed/error)
const inflightProgress = new Map();  // hash -> last progress data object

async function generateViaJob(baseUrl, text, voice, opts, hash, filePath, emitter) {
  try {
    const job = await postJobCreate(baseUrl, {
      text,
      voice,
      ...(opts.exaggeration != null ? { exaggeration: opts.exaggeration } : {}),
      ...(opts.cfg_weight != null ? { cfg_weight: opts.cfg_weight } : {}),
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    });
    await pollJobUntilDone(baseUrl, job.job_id, emitter);
    const buf = await getJobAudio(baseUrl, job.job_id);
    const tmpPath = `${filePath}.part`;
    fs.writeFileSync(tmpPath, buf);
    fs.renameSync(tmpPath, filePath);
    emitter.emit('completed', { message: 'synthesis complete' });
  } catch (err) {
    emitter.emit('error', { message: err && err.message ? err.message : 'TTS failed' });
    throw err;
  } finally {
    // Keep the emitter and last-progress data around briefly so subscribers
    // that connect right after completion still see the 'completed' event.
    setTimeout(() => {
      inflightJobs.delete(hash);
      inflightEmitters.delete(hash);
      inflightProgress.delete(hash);
    }, 2000);
  }
}

/**
 * Returns the cache file path for the given text + voice. Generates and
 * persists the audio via the jobs API if not already cached. Concurrent
 * callers for the same text join the same in-flight job.
 */
async function getOrGenerate(text, opts = {}) {
  if (!text || !text.trim()) {
    throw Object.assign(new Error('text is empty'), { status: 400 });
  }
  const voice = opts.voice || 'alloy';
  const baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  const hash = cacheKey(text, voice);
  const filePath = pathFor(hash);
  if (fs.existsSync(filePath)) return { path: filePath, cached: true };

  let promise = inflightJobs.get(hash);
  if (!promise) {
    // Create the emitter synchronously so progress subscribers that connect
    // before the queue picks up our turn still find a live emitter to listen
    // on.
    const emitter = new EventEmitter();
    inflightEmitters.set(hash, emitter);
    emitter.on('progress', (data) => { inflightProgress.set(hash, data); });
    // Queue the job lifecycle (create + SSE + audio fetch) so chatterbox sees
    // one synthesis at a time across the whole process.
    promise = ttsJobQueue.then(() => generateViaJob(baseUrl, text, voice, opts, hash, filePath, emitter));
    inflightJobs.set(hash, promise);
    ttsJobQueue = promise.catch(() => {/* keep queue alive after failures */});
  }
  await promise;
  return { path: filePath, cached: false };
}

/**
 * Returns an EventEmitter that emits 'progress', 'completed', 'error' for a
 * given text. If the audio is already cached, emits 'completed' on next tick.
 * Otherwise ensures a job is in flight and relays its events.
 */
function subscribeToProgress(text, opts = {}) {
  const voice = opts.voice || 'alloy';
  const hash = cacheKey(text, voice);
  const out = new EventEmitter();

  if (fs.existsSync(pathFor(hash))) {
    process.nextTick(() => out.emit('completed', {}));
    return out;
  }

  // Kick off generation if not already running. inflightEmitters is populated
  // synchronously inside generateViaJob before its first await, so the
  // emitter is guaranteed to be available below.
  getOrGenerate(text, opts).catch(() => {/* error events flow through emitter */});

  const source = inflightEmitters.get(hash);
  if (!source) {
    // Generation already finished (or never started for a cached file) between
    // our cache check and now. Defer to next tick so callers can attach
    // listeners first.
    process.nextTick(() => {
      if (fs.existsSync(pathFor(hash))) out.emit('completed', {});
      else out.emit('error', { message: 'TTS generation unavailable' });
    });
    return out;
  }

  // Replay last known progress so a late subscriber doesn't sit at 0%.
  const last = inflightProgress.get(hash);
  if (last) process.nextTick(() => out.emit('progress', last));

  const onProgress = (data) => out.emit('progress', data);
  const onCompleted = (data) => { out.emit('completed', data || {}); cleanup(); };
  const onError = (data) => { out.emit('error', data || {}); cleanup(); };
  function cleanup() {
    source.off('progress', onProgress);
    source.off('completed', onCompleted);
    source.off('error', onError);
  }
  source.on('progress', onProgress);
  source.on('completed', onCompleted);
  source.on('error', onError);
  return out;
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
  // Tests don't have a TTS service reachable; skipping prevents Jest from
  // hanging on async HTTP requests that never complete.
  if (process.env.NODE_ENV === 'test') return;
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
  recordOwnerLink, subscribeToProgress,
  REQUIREMENT_TTS_FIELDS,
};
