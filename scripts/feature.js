#!/usr/bin/env node
/**
 * CLI for managing DesignFeatures via the API.
 * Mirrors scripts/req.js. Used by /feature slash command and ad-hoc admin work.
 *
 * Usage: node scripts/feature.js <command> [args]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const DEFAULT_BASE_URL = 'https://letwinventory.letwin.co/api';
function tokenCachePath(baseUrl) {
  const safe = baseUrl.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 64);
  return `/tmp/letwinventory-claude-token-${safe}.json`;
}

const envPath = path.join(__dirname, '..', '.env.claude');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

function getBaseUrl() {
  const idx = process.argv.indexOf('--url');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env.PROD_API_URL || DEFAULT_BASE_URL;
}

function rawRequest(method, urlStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const transport = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function authRequest(method, urlStr, token, body) {
  return rawRequest(method, urlStr, body, { Authorization: `Bearer ${token}` });
}

async function getToken(baseUrl) {
  const cachePath = tokenCachePath(baseUrl);
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached.expiresAt > Date.now() + 60000) return cached.token;
    } catch { /* re-auth */ }
  }
  const apiKey = process.env.DEV_TEMP_API_KEY || process.env.PROD_API_KEY;
  if (!apiKey) {
    console.error('No API key found. Set DEV_TEMP_API_KEY (for dev) or PROD_API_KEY (for prod) in .env.claude or your environment.');
    process.exit(1);
  }
  const res = await rawRequest('POST', `${baseUrl}/auth/api-key/token`, { key: apiKey });
  if (res.status !== 200 || !res.data.accessToken) {
    console.error('Auth failed:', res.data);
    process.exit(1);
  }
  const token = res.data.accessToken;
  fs.writeFileSync(cachePath, JSON.stringify({ token, expiresAt: Date.now() + 55 * 60 * 1000 }));
  return token;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len - 3) + '...' : str;
}

function padEnd(str, len) {
  str = String(str);
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const cleanArgs = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--url') { i++; continue; }
    cleanArgs.push(rawArgs[i]);
  }
  const command = cleanArgs[0];
  const baseUrl = getBaseUrl();

  if (!command || command === 'help') {
    console.log(`Usage: node scripts/feature.js <command> [args]

Commands:
  list [--project <id>] [--state <state>]   List features
  get <id>                                  Get feature with associations
  create <json>                             Create feature (returns id)
  update <id> <json>                        Update feature fields
  delete <id>                               Soft-delete feature
  submit <id>                               draft → in_review
  approve <id>                              in_review → approved
  reject <id> [reason]                      in_review → draft
  release <id>                              approved → released
  link-req <featureId> <reqId>              Link a requirement to a feature
  link-reqs <featureId> <reqId...>          Link multiple requirements at once
  unlink-req <featureId> <reqId>            Unlink a requirement from a feature
  history <id> [--limit N] [--offset N]     Print history rows for a feature

Options:
  --url <base_url>                          API base URL (default: ${DEFAULT_BASE_URL})`);
    return;
  }

  const token = await getToken(baseUrl);
  const api = (method, p, body) => authRequest(method, `${baseUrl}${p}`, token, body);

  switch (command) {
    case 'list': {
      const params = new URLSearchParams();
      const projectIdx = cleanArgs.indexOf('--project');
      if (projectIdx !== -1 && cleanArgs[projectIdx + 1]) params.set('projectID', cleanArgs[projectIdx + 1]);
      const stateIdx = cleanArgs.indexOf('--state');
      if (stateIdx !== -1 && cleanArgs[stateIdx + 1]) params.set('reviewState', cleanArgs[stateIdx + 1]);
      const qs = params.toString();
      const res = await api('GET', `/design/feature${qs ? '?' + qs : ''}`);
      if (res.status !== 200) { console.error('Error:', res.data); process.exit(1); }
      if (!Array.isArray(res.data)) {
        console.error('Unexpected response shape (expected array):',
          typeof res.data === 'string' ? res.data.slice(0, 200) : JSON.stringify(res.data).slice(0, 200));
        console.error('The /design/feature route may not be deployed yet.');
        process.exit(1);
      }
      if (res.data.length === 0) { console.log('No features found.'); return; }
      console.log(padEnd('ID', 6) + padEnd('Slug', 25) + padEnd('State', 12) + padEnd('Reqs', 6) + 'Name');
      console.log('-'.repeat(96));
      for (const f of res.data) {
        console.log(
          padEnd(f.id, 6) +
          padEnd(truncate(f.slug, 23), 25) +
          padEnd(f.reviewState, 12) +
          padEnd(f.requirementCount ?? 0, 6) +
          truncate(f.name, 47)
        );
      }
      console.log(`\n${res.data.length} feature(s)`);
      break;
    }

    case 'get': {
      const id = cleanArgs[1];
      if (!id) { console.error('Usage: get <id>'); process.exit(1); }
      const res = await api('GET', `/design/feature/${id}`);
      if (res.status !== 200) { console.error('Error:', res.data); process.exit(1); }
      console.log(JSON.stringify(res.data, null, 2));
      break;
    }

    case 'create': {
      const json = cleanArgs[1];
      if (!json) { console.error('Usage: create <json>'); process.exit(1); }
      const body = JSON.parse(json);
      if (!body.projectID) body.projectID = 1;
      const res = await api('POST', '/design/feature', body);
      if (res.status !== 201) { console.error('Error:', res.data); process.exit(1); }
      console.log(`Created feature id=${res.data.id}`);
      break;
    }

    case 'update': {
      const id = cleanArgs[1];
      const json = cleanArgs[2];
      if (!id || !json) { console.error('Usage: update <id> <json>'); process.exit(1); }
      const body = JSON.parse(json);
      const res = await api('PUT', `/design/feature/${id}`, body);
      if (res.status !== 200) { console.error('Error:', res.data); process.exit(1); }
      console.log(`Updated feature id=${id}`);
      break;
    }

    case 'delete': {
      const id = cleanArgs[1];
      if (!id) { console.error('Usage: delete <id>'); process.exit(1); }
      const res = await api('DELETE', `/design/feature/${id}`);
      if (res.status !== 200 && res.status !== 204) { console.error('Error:', res.data); process.exit(1); }
      console.log(`Deleted feature id=${id}`);
      break;
    }

    case 'submit':
    case 'approve':
    case 'release': {
      const id = cleanArgs[1];
      if (!id) { console.error(`Usage: ${command} <id>`); process.exit(1); }
      const res = await api('POST', `/design/feature/${id}/${command}`);
      if (res.status !== 200) { console.error('Error:', res.data); process.exit(1); }
      console.log(`Feature ${id} → ${res.data.reviewState}`);
      break;
    }

    case 'reject': {
      const id = cleanArgs[1];
      if (!id) { console.error('Usage: reject <id> [reason]'); process.exit(1); }
      const reason = cleanArgs.slice(2).join(' ') || undefined;
      const res = await api('POST', `/design/feature/${id}/reject`, reason ? { reason } : undefined);
      if (res.status !== 200) { console.error('Error:', res.data); process.exit(1); }
      console.log(`Feature ${id} → ${res.data.reviewState}`);
      break;
    }

    case 'link-req': {
      const featureId = cleanArgs[1];
      const reqId = cleanArgs[2];
      if (!featureId || !reqId) { console.error('Usage: link-req <featureId> <reqId>'); process.exit(1); }
      const res = await api('POST', `/design/feature/${featureId}/link-requirement`, { requirementID: parseInt(reqId, 10) });
      if (res.status !== 200) { console.error('Error:', res.data); process.exit(1); }
      console.log(`Linked requirement ${reqId} to feature ${featureId}`);
      break;
    }

    case 'link-reqs': {
      const featureId = cleanArgs[1];
      const reqIds = cleanArgs.slice(2).filter(a => /^\d+$/.test(a));
      if (!featureId || reqIds.length === 0) {
        console.error('Usage: link-reqs <featureId> <reqId> [reqId...]');
        process.exit(1);
      }
      let okCount = 0;
      const errors = [];
      for (const reqId of reqIds) {
        const res = await api('POST', `/design/feature/${featureId}/link-requirement`, { requirementID: parseInt(reqId, 10) });
        if (res.status === 200) okCount++;
        else errors.push(`REQ ${reqId}: ${JSON.stringify(res.data)}`);
      }
      console.log(`Linked ${okCount}/${reqIds.length} requirements to feature ${featureId}`);
      for (const e of errors) console.log(`  - ${e}`);
      if (errors.length > 0) process.exit(1);
      break;
    }

    case 'unlink-req': {
      const featureId = cleanArgs[1];
      const reqId = cleanArgs[2];
      if (!featureId || !reqId) { console.error('Usage: unlink-req <featureId> <reqId>'); process.exit(1); }
      const res = await api('DELETE', `/design/feature/${featureId}/link-requirement/${reqId}`);
      if (res.status !== 200) { console.error('Error:', res.data); process.exit(1); }
      console.log(`Unlinked requirement ${reqId} from feature ${featureId}`);
      break;
    }

    case 'history': {
      const id = cleanArgs[1];
      if (!id) { console.error('Usage: history <id>'); process.exit(1); }
      const params = new URLSearchParams();
      const limitIdx = cleanArgs.indexOf('--limit');
      if (limitIdx !== -1 && cleanArgs[limitIdx + 1]) params.set('limit', cleanArgs[limitIdx + 1]);
      const offsetIdx = cleanArgs.indexOf('--offset');
      if (offsetIdx !== -1 && cleanArgs[offsetIdx + 1]) params.set('offset', cleanArgs[offsetIdx + 1]);
      const qs = params.toString();
      const res = await api('GET', `/design/feature/${id}/history${qs ? '?' + qs : ''}`);
      if (res.status !== 200) { console.error('Error:', res.data); process.exit(1); }
      console.log(JSON.stringify(res.data, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${command}. Run with 'help' for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
