#!/usr/bin/env node
/**
 * Backfill docs/features/*.md files into the DesignFeatures table (REQ 311).
 *
 * Usage (CLI):
 *   node scripts/migrate-feature-docs.js [--dry-run] [--dir <path>] [--project <id>]
 *
 * Usage (programmatic, used by tests):
 *   const { run } = require('./scripts/migrate-feature-docs');
 *   const result = await run({ dir, dryRun, auth, projectID });
 *
 * The `auth` parameter is a supertest-style helper exposing post/get/put/delete
 * shortcuts. When provided, the script uses it directly (test mode). Otherwise
 * the script obtains a JWT via the API key flow (production mode).
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
const DEFAULT_DOCS_DIR = path.join(__dirname, '..', 'docs', 'features');

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
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getProductionToken(baseUrl) {
  const cachePath = tokenCachePath(baseUrl);
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached.expiresAt > Date.now() + 60000) return cached.token;
    } catch { /* re-auth */ }
  }
  const apiKey = process.env.DEV_TEMP_API_KEY || process.env.PROD_API_KEY;
  if (!apiKey) throw new Error('No API key found. Set DEV_TEMP_API_KEY (for dev) or PROD_API_KEY (for prod).');
  const res = await rawRequest('POST', `${baseUrl}/auth/api-key/token`, { key: apiKey });
  if (res.status !== 200 || !res.data.accessToken) throw new Error(`Auth failed: ${JSON.stringify(res.data)}`);
  fs.writeFileSync(cachePath, JSON.stringify({
    token: res.data.accessToken,
    expiresAt: Date.now() + 55 * 60 * 1000,
  }));
  return res.data.accessToken;
}

// Wrap a supertest helper or a JWT into a uniform { get, post, put, delete } interface.
function makeApi({ auth, baseUrl, token }) {
  if (auth) {
    return {
      get: async (p) => {
        const r = await auth.get('/api' + p);
        return { status: r.status, data: r.body };
      },
      post: async (p, body) => {
        const r = await auth.post('/api' + p).send(body);
        return { status: r.status, data: r.body };
      },
      put: async (p, body) => {
        const r = await auth.put('/api' + p).send(body);
        return { status: r.status, data: r.body };
      },
      delete: async (p) => {
        const r = await auth.delete('/api' + p);
        return { status: r.status, data: r.body };
      },
    };
  }
  const headers = { Authorization: `Bearer ${token}` };
  return {
    get: (p) => rawRequest('GET', `${baseUrl}${p}`, null, headers),
    post: (p, body) => rawRequest('POST', `${baseUrl}${p}`, body, headers),
    put: (p, body) => rawRequest('PUT', `${baseUrl}${p}`, body, headers),
    delete: (p) => rawRequest('DELETE', `${baseUrl}${p}`, null, headers),
  };
}

function deriveSlug(filename) {
  return filename
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function deriveFromBody(body, filename) {
  const lines = body.split('\n');
  let name = null;
  for (const line of lines) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) { name = m[1].trim(); break; }
  }
  if (!name) name = filename.replace(/\.md$/i, '').replace(/[-_]/g, ' ');

  // Description: first non-heading non-blank paragraph.
  let description = null;
  let buf = [];
  for (const line of lines) {
    if (line.trim().startsWith('#')) {
      if (buf.length) break;
      continue;
    }
    if (line.trim() === '') {
      if (buf.length) break;
      continue;
    }
    buf.push(line.trim());
    if (buf.length >= 1 && buf.join(' ').length > 40) break;
  }
  description = buf.join(' ').trim() || null;

  return { name, description };
}

function extractRequirementIDs(body) {
  const ids = new Set();
  // Match `REQ N` only in contexts that indicate it's a requirement identifier
  // (not prose). Each pattern catches one styling convention used in the docs.
  const patterns = [
    /\(\s*REQ\s*[#-]?\s*(\d+)\s*\)/gi,            // (REQ N)
    /\|\s*REQ\s*[#-]?\s*(\d+)\s*\|/gi,            // | REQ N |  (table cell)
    /\*\*\s*REQ\s*[#-]?\s*(\d+)\s*\*\*/gi,        // **REQ N**  (bold)
    /^[\s>#\-*]*REQ\s*[#-]?\s*(\d+)\b/gmi,        // ^# REQ N  or  ^- REQ N (heading/bullet)
  ];
  let m;
  for (const re of patterns) {
    while ((m = re.exec(body)) !== null) ids.add(parseInt(m[1], 10));
  }
  // Range form: only when explicitly parenthesized like (REQ N-M).
  const parenRange = /\(\s*REQ\s*(\d+)\s*[–\-]\s*(\d+)\s*\)/gi;
  while ((m = parenRange.exec(body)) !== null) {
    const lo = parseInt(m[1], 10);
    const hi = parseInt(m[2], 10);
    if (hi - lo > 100) continue;
    for (let i = lo; i <= hi; i++) ids.add(i);
  }
  return [...ids].sort((a, b) => a - b);
}

async function findActiveFeatureBySlug(api, slug) {
  // The list endpoint doesn't filter by slug; fetch all and look up.
  const list = await api.get('/design/feature');
  if (list.status !== 200) {
    throw new Error(`GET /design/feature returned ${list.status}: ${typeof list.data === 'string' ? list.data.slice(0, 200) : JSON.stringify(list.data).slice(0, 200)}`);
  }
  if (!Array.isArray(list.data)) {
    throw new Error(
      `GET /design/feature returned 200 but the body is not an array (got ${typeof list.data}). ` +
      `This usually means the route is not deployed yet or the response is being intercepted by a proxy. ` +
      `First 200 chars: ${typeof list.data === 'string' ? list.data.slice(0, 200) : JSON.stringify(list.data).slice(0, 200)}`
    );
  }
  return list.data.find(f => f.slug === slug) || null;
}

async function run(opts = {}) {
  const dir = opts.dir || DEFAULT_DOCS_DIR;
  const dryRun = !!opts.dryRun;
  const relink = !!opts.relink;
  const projectID = opts.projectID || 1;
  const baseUrl = opts.baseUrl || (process.env.PROD_API_URL || DEFAULT_BASE_URL);

  let api;
  if (opts.auth) {
    api = makeApi({ auth: opts.auth });
  } else {
    const token = await getProductionToken(baseUrl);
    api = makeApi({ baseUrl, token });
  }

  const planned = [];
  const created = [];
  const skipped = [];
  const warnings = [];
  const relinked = [];

  if (!fs.existsSync(dir)) {
    warnings.push(`Directory ${dir} does not exist`);
    return { planned, created, skipped, warnings, relinked };
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();

  for (const filename of files) {
    const fullPath = path.join(dir, filename);
    const body = fs.readFileSync(fullPath, 'utf8');
    const slug = deriveSlug(filename);
    const { name, description } = deriveFromBody(body, filename);
    const reqIDs = extractRequirementIDs(body);

    const plan = { filename, slug, name, description, reqIDs };
    planned.push(plan);

    if (dryRun) continue;

    const existing = await findActiveFeatureBySlug(api, slug);

    if (relink) {
      // Relink-only mode: do not create features, only refresh requirement links.
      if (!existing) {
        warnings.push(`No existing feature for slug ${slug} — skipping (--relink does not create features)`);
        continue;
      }
      const result = await relinkOne(api, existing, reqIDs, slug);
      relinked.push({ id: existing.id, slug, ...result });
      continue;
    }

    if (existing) {
      skipped.push(slug);
      continue;
    }

    const createRes = await api.post('/design/feature', {
      name, slug, description, markdownBody: body, projectID,
    });
    if (createRes.status !== 201) {
      warnings.push(`Failed to create feature ${slug}: ${JSON.stringify(createRes.data)}`);
      continue;
    }
    const feature = createRes.data;

    // Release it (historical state).
    await api.post(`/design/feature/${feature.id}/submit`);
    await api.post(`/design/feature/${feature.id}/approve`);
    await api.post(`/design/feature/${feature.id}/release`);

    // Link requirements.
    let okCount = 0;
    for (const reqID of reqIDs) {
      const linkRes = await api.post(`/design/feature/${feature.id}/link-requirement`, { requirementID: reqID });
      if (linkRes.status !== 200) {
        warnings.push(`Could not link REQ ${reqID} to feature ${slug}: ${JSON.stringify(linkRes.data)}`);
      } else {
        okCount++;
      }
    }

    created.push({
      id: feature.id, slug, name, markdownBody: feature.markdownBody, reviewState: 'released',
      linkedReqCount: okCount,
      attemptedReqCount: reqIDs.length,
    });
  }

  return { planned, created, skipped, warnings, relinked };
}

async function relinkOne(api, feature, desiredReqIDs, slug) {
  // Step 1: fetch current links for this feature so we can compute diffs.
  const detailRes = await api.get(`/design/feature/${feature.id}`);
  const currentIDs = (detailRes.data && Array.isArray(detailRes.data.requirements))
    ? detailRes.data.requirements.map(r => r.id) : [];

  const desired = new Set(desiredReqIDs);
  const current = new Set(currentIDs);
  const toUnlink = currentIDs.filter(id => !desired.has(id));
  const toLink = desiredReqIDs.filter(id => !current.has(id));

  let linkedOK = 0;
  let unlinkedOK = 0;
  const errors = [];

  for (const reqID of toUnlink) {
    const r = await api.delete(`/design/feature/${feature.id}/link-requirement/${reqID}`);
    if (r.status === 200) unlinkedOK++;
    else errors.push(`unlink REQ ${reqID}: ${JSON.stringify(r.data)}`);
  }
  for (const reqID of toLink) {
    const r = await api.post(`/design/feature/${feature.id}/link-requirement`, { requirementID: reqID });
    if (r.status === 200) linkedOK++;
    else errors.push(`link REQ ${reqID}: ${JSON.stringify(r.data)}`);
  }
  return {
    before: currentIDs.length,
    desired: desiredReqIDs.length,
    linkedOK, unlinkedOK,
    errors,
  };
}

module.exports = { run, deriveSlug, deriveFromBody, extractRequirementIDs };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = { dryRun: false, relink: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--relink') opts.relink = true;
    else if (args[i] === '--dir') { opts.dir = args[++i]; }
    else if (args[i] === '--project') { opts.projectID = parseInt(args[++i], 10); }
    else if (args[i] === '--url') { opts.baseUrl = args[++i]; }
  }
  run(opts).then(result => {
    console.log('\n=== Summary ===');
    console.log(`Planned: ${result.planned.length}`);
    if (opts.relink) {
      console.log(`Relinked: ${result.relinked.length}`);
      console.log(`Warnings: ${result.warnings.length}`);
      for (const w of result.warnings) console.log(`  - ${w}`);
      console.log('\nRelink details:');
      for (const r of result.relinked) {
        const errSuffix = r.errors.length ? `, ${r.errors.length} errors` : '';
        console.log(`  ${r.slug.padEnd(34)} before=${r.before} desired=${r.desired} +${r.linkedOK} -${r.unlinkedOK}${errSuffix}`);
        for (const e of r.errors.slice(0, 3)) console.log(`    ${e}`);
      }
    } else if (opts.dryRun) {
      console.log('\nPlan:');
      for (const p of result.planned) {
        console.log(`  ${p.slug.padEnd(34)} (${p.reqIDs.length} REQ refs): ${p.name}`);
      }
    } else {
      console.log(`Created: ${result.created.length}`);
      console.log(`Skipped: ${result.skipped.length} (${result.skipped.join(', ')})`);
      console.log(`Warnings: ${result.warnings.length}`);
      for (const w of result.warnings) console.log(`  - ${w}`);
      for (const c of result.created) {
        const target = c.attemptedReqCount != null ? `${c.linkedReqCount}/${c.attemptedReqCount}` : c.linkedReqCount;
        console.log(`  ${c.slug.padEnd(34)} → id=${c.id} (${target} reqs linked)`);
      }
    }
  }).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
