#!/usr/bin/env node
/**
 * Annotates drill bit part descriptions with their tap-drill / clearance-fit usage.
 *
 * Reads all parts assigned to ToolSubcategory 27 (Drill Bit), parses the drill size
 * from the part name (e.g. '#29 Drill', '5/16" Drill', 'F Drill'), and if it matches
 * a tap drill chart entry, appends a ' - <fit> <tap>' suffix to the description.
 *
 * Idempotent: the suffix added by this script is delimited by ' — ' (em-dash)
 * so a second run replaces rather than stacks.
 *
 * Usage:
 *   node scripts/annotate-tap-drills.js [--url <baseUrl>] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const TOKEN_CACHE = '/tmp/letwinventory-tools-token.json';
const DEFAULT_BASE_URL = 'https://letwinventory.letwin.co/api';
const DRILL_SUBCATEGORY_ID = 27;
// Em-dash separator — anything after the first em-dash in description is treated
// as auto-generated and replaced on each run.
const SEPARATOR = ' — ';

// Tap drill chart: tap → [75%, 50%, Close Fit, Free Fit]
const TAP_CHART = [
  // Imperial UNC/UNF
  ['#2-56',     '#50',   '#49',   '#43',   '#41'],
  ['#4-40',     '#43',   '#41',   '#32',   '#30'],
  ['#6-32',     '#36',   '#32',   '#27',   '#25'],
  ['#8-32',     '#29',   '#27',   '#18',   '#16'],
  ['#10-24',    '#25',   '#20',   '#9',    '#7'],
  ['#10-32',    '#21',   '#18',   null,    null],
  ['1/4-20',    '#7',    '7/32',  'F',     'H'],
  ['5/16-18',   'F',     'J',     'P',     'Q'],
  ['3/8-16',    '5/16',  'Q',     'W',     'X'],
  ['7/16-14',   'U',     '25/64', '29/64', '15/32'],
  ['1/2-13',    '27/64', '29/64', '33/64', '17/32'],
  ['9/16-12',   '31/64', '33/64', '37/64', '19/32'],
  ['5/8-11',    '17/32', '9/16',  '41/64', '21/32'],
  // Metric ISO
  ['M2x0.4',    '#52',   '#50',   '#45',   '#44'],
  ['M2.5x0.45', '#46',   '#44',   '#37',   '7/64'],
  ['M3x0.5',    '#39',   '#36',   '1/8',   '#30'],
  ['M4x0.7',    '#30',   '#28',   '#19',   '#17'],
  ['M5x0.8',    '#19',   '#16',   '#5',    '7/32'],
  ['M6x1',      '#8',    '#4',    'E',     'G'],
  ['M8x1.25',   'H',     'J',     'Q',     'S'],
  ['M10x1.5',   'R',     'T',     'Z',     '7/16'],
  ['M12x1.75',  '13/32', '27/64', '1/2',   '33/64'],
];
const FIT_LABELS = ['75% Tap', '50% Tap', 'Close Fit', 'Free Fit'];

// Build reverse map: drill size → list of "<fit> <tap>" usage strings.
function buildReverseMap() {
  const map = new Map();
  for (const row of TAP_CHART) {
    const tap = row[0];
    for (let i = 1; i <= 4; i++) {
      const drill = row[i];
      if (!drill) continue;
      const usage = `${FIT_LABELS[i - 1]} ${tap}`;
      if (!map.has(drill)) map.set(drill, []);
      map.get(drill).push(usage);
    }
  }
  return map;
}

// Extract drill size token from a name like '#29 Drill', '5/16" Drill', 'F Drill'.
// Returns null if no recognized size pattern found.
function extractDrillSize(name) {
  if (!name) return null;
  // Number drills: #1 - #80
  let m = name.match(/^#(\d{1,2})\b/);
  if (m) return `#${m[1]}`;
  // Fractional inches: 5/16, 27/64, etc.
  m = name.match(/^(\d{1,2}\/\d{1,2})/);
  if (m) return m[1];
  // Letter drills: single A-Z followed by space or quote/end
  m = name.match(/^([A-Z])(?=\s|"|$)/);
  if (m) return m[1];
  return null;
}

// ── env / auth ──────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env.claude');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = t.slice(eq + 1).trim();
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
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method, headers,
      rejectUnauthorized: false,
    };
    const req = transport.request(opts, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
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
      const c = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
      if (c.expiresAt > Date.now() + 60000) return c.token;
    } catch { /* re-auth */ }
  }
  const apiKey = process.env.TOOL_PROD_API_KEY || process.env.PROD_API_KEY;
  if (!apiKey) {
    console.error('No TOOL_PROD_API_KEY (or PROD_API_KEY) found.');
    process.exit(1);
  }
  const r = await request('POST', `${baseUrl}/auth/api-key/token`, { key: apiKey });
  if (r.status !== 200 || !r.data.accessToken) {
    console.error('Auth failed:', r.data); process.exit(1);
  }
  fs.writeFileSync(TOKEN_CACHE, JSON.stringify({
    token: r.data.accessToken, expiresAt: Date.now() + 55 * 60 * 1000,
  }));
  return r.data.accessToken;
}

async function main() {
  const baseUrl = getBaseUrl();
  const dryRun = process.argv.includes('--dry-run');
  const token = await getToken(baseUrl);
  const reverse = buildReverseMap();

  // Pull all drill bit tools (their part objects already include name/description)
  const toolsRes = await request('GET', `${baseUrl}/tools/tool?subcategoryID=${DRILL_SUBCATEGORY_ID}`, null, token);
  if (toolsRes.status !== 200) {
    console.error('Failed to list drill tools:', toolsRes.status, toolsRes.data);
    process.exit(1);
  }

  // Parts to skip (e.g. ones whose full annotation overflows description column)
  const SKIP_PART_IDS = new Set([475]); // 33/64" Drill — too long for 62-char column

  let updated = 0, skipped = 0, unmatched = 0, failed = 0;
  for (const tool of toolsRes.data) {
    const partID = tool.partID;
    const name = tool.part?.name || '';
    if (SKIP_PART_IDS.has(partID)) { skipped++; continue; }
    const size = extractDrillSize(name);
    if (!size) { unmatched++; continue; }
    const usages = reverse.get(size);
    if (!usages) { unmatched++; continue; }

    // Fetch the full part so the PUT body satisfies bodyValidator.part
    const partRes = await request('GET', `${baseUrl}/inventory/part/${partID}`, null, token);
    if (partRes.status !== 200) {
      console.log(`✗ ${partID} (${name}) — GET part failed [${partRes.status}]`);
      failed++; continue;
    }
    const part = partRes.data;
    const baseDesc = (part.description || '').split(SEPARATOR)[0].trimEnd();
    const newDesc = `${baseDesc}${SEPARATOR}${usages.join(', ')}`;

    if (newDesc === part.description) { skipped++; continue; }

    if (dryRun) {
      console.log(`[dry] ${partID} ${name}: "${part.description || ''}" → "${newDesc}"`);
      updated++; continue;
    }

    const putRes = await request('PUT', `${baseUrl}/inventory/part/${partID}`,
      { ...part, description: newDesc }, token);
    if (putRes.status === 200) {
      updated++;
      console.log(`✓ ${partID} ${name} → ${usages.join(', ')}`);
    } else {
      failed++;
      const msg = putRes.data?.errorMessage || putRes.data?.error || JSON.stringify(putRes.data);
      console.log(`✗ ${partID} ${name} [${putRes.status}] ${msg}`);
    }
  }

  console.log(`\nDone. updated=${updated} unchanged=${skipped} unmatched=${unmatched} failed=${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
