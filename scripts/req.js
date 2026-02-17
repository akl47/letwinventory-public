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

const TOKEN_CACHE = '/tmp/letwinventory-claude-token.json';
const DEFAULT_BASE_URL = 'http://localhost:3000/api';

// Parse --url flag from argv
function getBaseUrl() {
  const idx = process.argv.indexOf('--url');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return DEFAULT_BASE_URL;
}

function request(method, urlStr, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));

    const req = http.request(options, (res) => {
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
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));

    const req = http.request(options, (res) => {
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

  const res = await request('POST', `${baseUrl}/auth/google/test-login`, {
    email: 'claude@letwin.co',
    displayName: 'Claude Code',
  });

  if (res.status !== 200 || !res.data.accessToken) {
    console.error('Auth failed:', res.data);
    process.exit(1);
  }

  const token = res.data.accessToken;
  // test-login tokens expire in 1h
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
  list [--project <id>]       List all requirements
  get <id>                    Get requirement with associations
  create <json>               Create requirement (returns id)
  update <id> <json>          Update requirement fields

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
