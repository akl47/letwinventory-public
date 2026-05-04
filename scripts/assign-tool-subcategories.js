#!/usr/bin/env node
/**
 * Bulk-assigns Tool subcategories to existing parts by creating Tool records.
 *
 * Usage: node scripts/assign-tool-subcategories.js [--url <baseUrl>]
 *
 * Hardcoded ranges:
 *   partIDs 195-530 → ToolSubcategoryID 27 (Drill Bit)
 *   partIDs 531-551 → ToolSubcategoryID 36 (Tap)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const TOKEN_CACHE = '/tmp/letwinventory-tools-token.json';
const DEFAULT_BASE_URL = 'https://letwinventory.letwin.co/api';

const ASSIGNMENTS = [
  { from: 195, to: 530, toolSubcategoryID: 27 }, // Drill Bit
  { from: 531, to: 551, toolSubcategoryID: 36 }, // Tap
];

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

function request(method, urlStr, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const transport = url.protocol === 'https:' ? https : http;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body) headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
    };
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
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

async function getToken(baseUrl) {
  if (fs.existsSync(TOKEN_CACHE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
      if (cached.expiresAt > Date.now() + 60000) return cached.token;
    } catch { /* re-auth */ }
  }
  const apiKey = process.env.TOOL_PROD_API_KEY || process.env.PROD_API_KEY;
  if (!apiKey) {
    console.error('No TOOL_PROD_API_KEY (or PROD_API_KEY) found. Set it in .env.claude or as an environment variable.');
    process.exit(1);
  }
  const res = await request('POST', `${baseUrl}/auth/api-key/token`, { key: apiKey });
  if (res.status !== 200 || !res.data.accessToken) {
    console.error('Auth failed:', res.data);
    process.exit(1);
  }
  fs.writeFileSync(TOKEN_CACHE, JSON.stringify({
    token: res.data.accessToken,
    expiresAt: Date.now() + 55 * 60 * 1000,
  }));
  return res.data.accessToken;
}

async function main() {
  const baseUrl = getBaseUrl();
  const token = await getToken(baseUrl);

  let created = 0, skipped = 0, failed = 0;
  for (const a of ASSIGNMENTS) {
    console.log(`\n--- partIDs ${a.from}-${a.to} → toolSubcategoryID ${a.toolSubcategoryID} ---`);
    for (let partID = a.from; partID <= a.to; partID++) {
      const res = await request('POST', `${baseUrl}/tools/tool`, {
        partID,
        toolSubcategoryID: a.toolSubcategoryID,
      }, token);

      if (res.status === 201) {
        created++;
        process.stdout.write(`✓ ${partID} `);
      } else if (res.status === 409) {
        skipped++;
        process.stdout.write(`= ${partID} `); // already has a tool
      } else {
        failed++;
        const msg = res.data?.errorMessage || res.data?.error || JSON.stringify(res.data);
        console.log(`\n✗ ${partID} [${res.status}] ${msg}`);
      }
    }
    console.log('');
  }
  console.log(`\nDone. created=${created} skipped(already_exists)=${skipped} failed=${failed}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
