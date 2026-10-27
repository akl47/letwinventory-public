#!/usr/bin/env node
/**
 * Pre-generate TTS audio for every text-bearing field on every active design
 * requirement, via the HTTP API. The backend handles synthesis, disk caching,
 * and `TtsAudio` linkage during each request — this script just walks the list
 * and hits each (requirement, field) once.
 *
 * Auth: either a short-lived JWT (--token) or an API key (--api-key). API key
 * is preferred for long runs because the script automatically re-exchanges
 * it for a fresh token whenever a request returns 401.
 *
 * Usage:
 *   node backend/scripts/generate-tts-cache.js --api-key <key>
 *   node backend/scripts/generate-tts-cache.js --token <jwt>
 *   node backend/scripts/generate-tts-cache.js --api-key <key> --base-url https://letwinventory.letwin.co
 *   node backend/scripts/generate-tts-cache.js --api-key <key> --id 123
 *   node backend/scripts/generate-tts-cache.js --api-key <key> --field description
 *   node backend/scripts/generate-tts-cache.js --api-key <key> --limit 5
 *   node backend/scripts/generate-tts-cache.js --api-key <key> --dry-run
 *
 * Token: `localStorage.auth_token` in the browser devtools while logged in.
 * API key: create one under /admin or via POST /api/auth/api-key. Required
 * permissions: requirements.read.
 */

const args = process.argv.slice(2);

function flagValue(name) {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : null;
}

const initialToken = flagValue('--token') || process.env.LETWINVENTORY_TOKEN;
const apiKey = flagValue('--api-key') || process.env.LETWINVENTORY_API_KEY;
const baseUrl = (flagValue('--base-url') || 'https://letwinventory.letwin.co').replace(/\/$/, '');
const dryRun = args.includes('--dry-run');
const onlyIdRaw = flagValue('--id');
const onlyId = onlyIdRaw != null ? parseInt(onlyIdRaw, 10) : null;
const onlyField = flagValue('--field');
const limitRaw = flagValue('--limit');
const limit = limitRaw != null ? parseInt(limitRaw, 10) : null;

if (!initialToken && !apiKey) {
    console.error('Error: --token <jwt> or --api-key <key> required.');
    console.error('  Token (short-lived): copy `localStorage.auth_token` from devtools while logged in.');
    console.error('  API key (auto-refreshes): create one under admin, or POST /api/auth/api-key.');
    process.exit(1);
}

// Mutable: re-exchanged from the API key when a request hits 401.
let token = initialToken;

const FIELDS = ['description', 'rationale', 'parameter', 'verification', 'validation'];
if (onlyField && !FIELDS.includes(onlyField)) {
    console.error(`Error: --field must be one of ${FIELDS.join(', ')}`);
    process.exit(1);
}

function fmt(ms) {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

async function exchangeApiKey() {
    if (!apiKey) throw new Error('no --api-key available to exchange');
    const resp = await fetch(`${baseUrl}/api/auth/api-key/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey }),
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`API key exchange failed: HTTP ${resp.status} ${body.slice(0, 300)}`);
    }
    const { accessToken } = await resp.json();
    if (!accessToken) throw new Error('API key exchange returned no accessToken');
    token = accessToken;
    console.log(`[tts-warm] exchanged API key for fresh access token`);
}

async function apiFetch(path, opts = {}) {
    const doFetch = () => fetch(`${baseUrl}${path}`, {
        ...opts,
        headers: {
            ...(opts.headers || {}),
            Authorization: `Bearer ${token}`,
        },
    });
    let resp = await doFetch();
    // On 401, refresh the token from the API key (if available) and retry once.
    if (resp.status === 401 && apiKey) {
        await exchangeApiKey();
        resp = await doFetch();
    }
    return resp;
}

async function run() {
    console.log(`[tts-warm] base=${baseUrl} auth=${apiKey ? 'api-key' : 'token'} dryRun=${dryRun}`);
    // If no token was supplied but we have an API key, exchange it upfront so
    // the first request doesn't waste a round trip on a guaranteed 401.
    if (!token && apiKey) await exchangeApiKey();

    const listResp = await apiFetch('/api/design/requirement');
    if (!listResp.ok) {
        const body = await listResp.text();
        console.error(`[tts-warm] failed to list requirements: HTTP ${listResp.status} ${body.slice(0, 300)}`);
        process.exit(1);
    }
    let requirements = await listResp.json();
    if (onlyId != null) requirements = requirements.filter(r => r.id === onlyId);
    if (limit) requirements = requirements.slice(0, limit);

    if (requirements.length === 0) {
        console.log('[tts-warm] no requirements matched the filter');
        return;
    }
    console.log(`[tts-warm] processing ${requirements.length} requirement${requirements.length === 1 ? '' : 's'}`);

    const fieldsToProcess = onlyField ? [onlyField] : FIELDS;
    let totalGenerated = 0;
    let totalCached = 0;
    let totalFailed = 0;
    const startedAt = Date.now();

    for (let i = 0; i < requirements.length; i++) {
        const req = requirements[i];
        const prefix = `[tts-warm] (${i + 1}/${requirements.length}) req=${req.id}`;
        for (const field of fieldsToProcess) {
            const raw = req[field];
            if (typeof raw !== 'string') continue;
            const text = raw.trim();
            if (!text) continue;

            if (dryRun) {
                totalGenerated++;
                console.log(`${prefix} ${field} — would warm (${text.length} chars)`);
                continue;
            }

            const t0 = Date.now();
            try {
                const resp = await apiFetch(`/api/tts/requirement/${req.id}/${field}`);
                if (!resp.ok) {
                    totalFailed++;
                    const body = await resp.text();
                    console.warn(`${prefix} ${field} — FAILED HTTP ${resp.status}: ${body.slice(0, 200)}`);
                    continue;
                }
                // Consume the body so the connection closes cleanly. The
                // backend already updated its disk cache and TtsAudio row
                // during this request — we don't need to keep the bytes.
                const buf = await resp.arrayBuffer();
                const cached = resp.headers.get('x-tts-cached') === '1';
                if (cached) totalCached++; else totalGenerated++;
                console.log(`${prefix} ${field} — ${cached ? 'cached' : 'generated'} in ${fmt(Date.now() - t0)} (${buf.byteLength} bytes)`);
            } catch (err) {
                totalFailed++;
                console.warn(`${prefix} ${field} — FAILED after ${fmt(Date.now() - t0)}: ${err.message}`);
            }
        }
    }

    console.log(`[tts-warm] done in ${fmt(Date.now() - startedAt)}: generated=${totalGenerated} cached=${totalCached} failed=${totalFailed}`);
}

run().catch((err) => {
    console.error('[tts-warm] fatal:', err);
    process.exit(1);
});
