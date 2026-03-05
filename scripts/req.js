#!/usr/bin/env node
/**
 * CLI for managing design requirements via the API.
 * Used by Claude Code to create/manage requirements without touching docs/requirements.md.
 *
 * Usage: node scripts/req.js <command> [args]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const TOKEN_CACHE = '/tmp/letwinventory-claude-token.json';
const DEFAULT_BASE_URL = 'https://letwinventory.letwin.co/api';

// Load env vars from .env.claude (simple key=value parsing, no dotenv dependency)
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

// Parse --url flag from argv, fall back to env, then default
function getBaseUrl() {
  const idx = process.argv.indexOf('--url');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env.PROD_API_URL || DEFAULT_BASE_URL;
}

function request(method, urlStr, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const transport = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
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
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const transport = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
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

async function getToken(baseUrl) {
  // Check cache
  if (fs.existsSync(TOKEN_CACHE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
      if (cached.expiresAt > Date.now() + 60000) { // 1min buffer
        return cached.token;
      }
    } catch { /* re-auth */ }
  }

  const apiKey = process.env.PROD_API_KEY;
  if (!apiKey) {
    console.error('No PROD_API_KEY found. Set it in .env.claude or as an environment variable.');
    process.exit(1);
  }

  const res = await request('POST', `${baseUrl}/auth/api-key/token`, { key: apiKey });

  if (res.status !== 200 || !res.data.accessToken) {
    console.error('Auth failed:', res.data);
    process.exit(1);
  }

  const token = res.data.accessToken;
  // exchanged tokens expire in 1h
  fs.writeFileSync(TOKEN_CACHE, JSON.stringify({
    token,
    expiresAt: Date.now() + 55 * 60 * 1000, // 55min to be safe
  }));
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
  const args = process.argv.slice(2).filter(a => a !== '--url' && !process.argv[process.argv.indexOf('--url') + 1]?.includes(a) || !process.argv.includes('--url'));
  // Cleaner arg parsing: strip --url and its value
  const rawArgs = process.argv.slice(2);
  const cleanArgs = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--url') { i++; continue; }
    cleanArgs.push(rawArgs[i]);
  }

  const command = cleanArgs[0];
  const baseUrl = getBaseUrl();

  if (!command || command === 'help') {
    console.log(`Usage: node scripts/req.js <command> [args]

Commands:
  categories                  List categories
  create-category <json>      Create category (name, description)
  update-category <id> <json> Update category fields
  delete-category <id>        Delete category
  list [--project <id>]       List all requirements
  tree [file]                 Export hierarchical JSON tree (default: requirements-tree.json)
  get <id>                    Get requirement with associations
  create <json>               Create requirement (returns id)
  update <id> <json>          Update requirement fields
  delete <id>                 Soft-delete requirement (sets activeFlag=false)

Options:
  --url <base_url>            API base URL (default: ${DEFAULT_BASE_URL})`);
    return;
  }

  const token = await getToken(baseUrl);
  const api = (method, path, body) => authRequest(method, `${baseUrl}${path}`, token, body);

  switch (command) {
    case 'list': {
      const projectIdx = cleanArgs.indexOf('--project');
      const query = projectIdx !== -1 && cleanArgs[projectIdx + 1]
        ? `?projectID=${cleanArgs[projectIdx + 1]}` : '';
      const res = await api('GET', `/design/requirement${query}`);
      if (res.status !== 200) { console.error('Error:', res.data); process.exit(1); }
      if (res.data.length === 0) { console.log('No requirements found.'); return; }
      console.log(padEnd('ID', 6) + padEnd('Approved', 10) + padEnd('Category', 25) + 'Description');
      console.log('-'.repeat(100));
      for (const r of res.data) {
        console.log(
          padEnd(r.id, 6) +
          padEnd(r.approved ? 'Yes' : 'No', 10) +
          padEnd(truncate(r.category?.name || '-', 23), 25) +
          truncate(r.description, 60)
        );
      }
      console.log(`\n${res.data.length} requirement(s)`);
      break;
    }

    case 'tree': {
      const [reqRes, catRes] = await Promise.all([
        api('GET', '/design/requirement'),
        api('GET', '/design/requirement-category'),
      ]);
      if (reqRes.status !== 200) { console.error('Error:', reqRes.data); process.exit(1); }
      if (catRes.status !== 200) { console.error('Error:', catRes.data); process.exit(1); }

      const catMap = {};
      for (const c of catRes.data) catMap[c.id] = c.name;

      const byId = {};
      for (const r of reqRes.data) {
        byId[r.id] = {
          id: r.id,
          description: r.description || '',
          category: catMap[r.categoryID] || null,
          approved: r.approved || false,
          rationale: r.rationale || null,
          verification: r.verification || null,
          validation: r.validation || null,
          children: [],
        };
      }

      const roots = [];
      for (const r of reqRes.data) {
        if (r.parentRequirementID && byId[r.parentRequirementID]) {
          byId[r.parentRequirementID].children.push(byId[r.id]);
        } else if (!r.parentRequirementID) {
          roots.push(byId[r.id]);
        }
      }

      // Remove empty children arrays for cleaner output
      function prune(node) {
        if (node.children.length === 0) delete node.children;
        else node.children.forEach(prune);
        return node;
      }
      const tree = roots.length === 1 ? prune(roots[0]) : roots.map(prune);

      const outFile = cleanArgs[1] || 'requirements-tree.json';
      const outPath = path.resolve(outFile);
      fs.writeFileSync(outPath, JSON.stringify(tree, null, 2) + '\n');
      console.log(`Wrote ${reqRes.data.length} requirements as tree to ${outPath}`);
      break;
    }

    case 'get': {
      const id = cleanArgs[1];
      if (!id) { console.error('Usage: get <id>'); process.exit(1); }
      const res = await api('GET', `/design/requirement/${id}`);
      if (res.status !== 200) { console.error('Error:', res.data); process.exit(1); }
      console.log(JSON.stringify(res.data, null, 2));
      break;
    }

    case 'create': {
      const json = cleanArgs[1];
      if (!json) { console.error('Usage: create <json>'); process.exit(1); }
      const body = JSON.parse(json);
      if (!body.projectID) body.projectID = 1;
      const res = await api('POST', '/design/requirement', body);
      if (res.status !== 201) { console.error('Error:', res.data); process.exit(1); }
      console.log(`Created requirement id=${res.data.id}`);
      break;
    }

    case 'update': {
      const id = cleanArgs[1];
      const json = cleanArgs[2];
      if (!id || !json) { console.error('Usage: update <id> <json>'); process.exit(1); }
      const body = JSON.parse(json);
      const res = await api('PUT', `/design/requirement/${id}`, body);
      if (res.status !== 200) { console.error('Error:', res.data); process.exit(1); }
      console.log(`Updated requirement id=${id}`);
      break;
    }

    case 'delete': {
      const id = cleanArgs[1];
      if (!id) { console.error('Usage: delete <id>'); process.exit(1); }
      const res = await api('DELETE', `/design/requirement/${id}`);
      if (res.status !== 200 && res.status !== 204) { console.error('Error:', res.data); process.exit(1); }
      console.log(`Deleted requirement id=${id}`);
      break;
    }

    case 'create-category': {
      const json = cleanArgs[1];
      if (!json) { console.error('Usage: create-category <json>'); process.exit(1); }
      const body = JSON.parse(json);
      const res = await api('POST', '/design/requirement-category', body);
      if (res.status !== 201) { console.error('Error:', res.data); process.exit(1); }
      console.log(`Created category id=${res.data.id} name="${res.data.name}"`);
      break;
    }

    case 'update-category': {
      const id = cleanArgs[1];
      const json = cleanArgs[2];
      if (!id || !json) { console.error('Usage: update-category <id> <json>'); process.exit(1); }
      const body = JSON.parse(json);
      const res = await api('PUT', `/design/requirement-category/${id}`, body);
      if (res.status !== 200) { console.error('Error:', res.data); process.exit(1); }
      console.log(`Updated category id=${id}`);
      break;
    }

    case 'delete-category': {
      const id = cleanArgs[1];
      if (!id) { console.error('Usage: delete-category <id>'); process.exit(1); }
      const res = await api('DELETE', `/design/requirement-category/${id}`);
      if (res.status !== 200 && res.status !== 204) { console.error('Error:', res.data); process.exit(1); }
      console.log(`Deleted category id=${id}`);
      break;
    }

    case 'categories': {
      const res = await api('GET', '/design/requirement-category');
      if (res.status !== 200) { console.error('Error:', res.data); process.exit(1); }
      if (res.data.length === 0) { console.log('No categories found.'); return; }
      console.log(padEnd('ID', 6) + padEnd('Name', 35) + 'Description');
      console.log('-'.repeat(90));
      for (const c of res.data) {
        console.log(padEnd(c.id, 6) + padEnd(truncate(c.name, 33), 35) + truncate(c.description || '', 50));
      }
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
