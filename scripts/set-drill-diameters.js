#!/usr/bin/env node
/**
 * Sets the `diameter` field (in mm) on every drill bit Tool record (ToolSubcategory 27).
 *
 * Parses the drill size from the part name and converts to metric:
 *   - Number drills (#1–#80) and letter drills (A–Z) use standard ANSI tables
 *   - Fractional inch drills (e.g. 5/16", 27/64") → mm via × 25.4
 *   - Metric drills (e.g. "0.35mm Drill") → use the value directly
 *   - Whole/decimal inches (e.g. '1" Drill') → mm via × 25.4
 *
 * Idempotent: skips tools whose stored diameter already matches the computed value
 * (within 0.001 mm).
 *
 * Usage:
 *   node scripts/set-drill-diameters.js [--url <baseUrl>] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const TOKEN_CACHE = '/tmp/letwinventory-tools-token.json';
const DEFAULT_BASE_URL = 'https://letwinventory.letwin.co/api';
const DRILL_SUBCATEGORY_ID = 27;
const INCH_TO_MM = 25.4;

// ── ANSI drill size tables (inches) ─────────────────────────────────────────
const NUMBER_DRILL_INCHES = {
  1: 0.2280,   2: 0.2210,   3: 0.2130,   4: 0.2090,   5: 0.2055,
  6: 0.2040,   7: 0.2010,   8: 0.1990,   9: 0.1960,  10: 0.1935,
 11: 0.1910,  12: 0.1890,  13: 0.1850,  14: 0.1820,  15: 0.1800,
 16: 0.1770,  17: 0.1730,  18: 0.1695,  19: 0.1660,  20: 0.1610,
 21: 0.1590,  22: 0.1570,  23: 0.1540,  24: 0.1520,  25: 0.1495,
 26: 0.1470,  27: 0.1440,  28: 0.1405,  29: 0.1360,  30: 0.1285,
 31: 0.1200,  32: 0.1160,  33: 0.1130,  34: 0.1110,  35: 0.1100,
 36: 0.1065,  37: 0.1040,  38: 0.1015,  39: 0.0995,  40: 0.0980,
 41: 0.0960,  42: 0.0935,  43: 0.0890,  44: 0.0860,  45: 0.0820,
 46: 0.0810,  47: 0.0785,  48: 0.0760,  49: 0.0730,  50: 0.0700,
 51: 0.0670,  52: 0.0635,  53: 0.0595,  54: 0.0550,  55: 0.0520,
 56: 0.0465,  57: 0.0430,  58: 0.0420,  59: 0.0410,  60: 0.0400,
 61: 0.0390,  62: 0.0380,  63: 0.0370,  64: 0.0360,  65: 0.0350,
 66: 0.0330,  67: 0.0320,  68: 0.0310,  69: 0.0292,  70: 0.0280,
 71: 0.0260,  72: 0.0250,  73: 0.0240,  74: 0.0225,  75: 0.0210,
 76: 0.0200,  77: 0.0180,  78: 0.0160,  79: 0.0145,  80: 0.0135,
};

const LETTER_DRILL_INCHES = {
  A: 0.234, B: 0.238, C: 0.242, D: 0.246, E: 0.250,
  F: 0.257, G: 0.261, H: 0.266, I: 0.272, J: 0.277,
  K: 0.281, L: 0.290, M: 0.295, N: 0.302, O: 0.316,
  P: 0.323, Q: 0.332, R: 0.339, S: 0.348, T: 0.358,
  U: 0.368, V: 0.377, W: 0.386, X: 0.397, Y: 0.404,
  Z: 0.413,
};

// Compute diameter (mm) for a drill name. Returns null if name doesn't match
// any known pattern.
function diameterMmFromName(name) {
  if (!name) return null;

  // Metric drills: "0.35mm Drill", "1.5mm Drill"
  let m = name.match(/^(\d+(?:\.\d+)?)mm\b/i);
  if (m) return parseFloat(m[1]);

  // Number drills: "#29 Drill"
  m = name.match(/^#(\d{1,2})\b/);
  if (m) {
    const inches = NUMBER_DRILL_INCHES[parseInt(m[1], 10)];
    return inches !== undefined ? inches * INCH_TO_MM : null;
  }

  // Fractional inch: "5/16\" Drill", "27/64\" Drill"
  m = name.match(/^(\d{1,3})\/(\d{1,3})/);
  if (m) {
    const num = parseInt(m[1], 10), den = parseInt(m[2], 10);
    if (den === 0) return null;
    return (num / den) * INCH_TO_MM;
  }

  // Whole/decimal inch: "1\" Drill", "1.25\" Drill"
  m = name.match(/^(\d+(?:\.\d+)?)["”]\s*Drill/i);
  if (m) return parseFloat(m[1]) * INCH_TO_MM;

  // Letter drills: "F Drill"
  m = name.match(/^([A-Z])(?=\s|"|$)/);
  if (m) {
    const inches = LETTER_DRILL_INCHES[m[1]];
    return inches !== undefined ? inches * INCH_TO_MM : null;
  }

  return null;
}

// Round to 3 decimals (matches DB DECIMAL(10, 3)).
function round3(n) { return Math.round(n * 1000) / 1000; }

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

  const toolsRes = await request('GET',
    `${baseUrl}/tools/tool?subcategoryID=${DRILL_SUBCATEGORY_ID}`, null, token);
  if (toolsRes.status !== 200) {
    console.error('Failed to list drill tools:', toolsRes.status, toolsRes.data);
    process.exit(1);
  }

  let updated = 0, unchanged = 0, unmatched = 0, failed = 0;
  for (const tool of toolsRes.data) {
    const name = tool.part?.name || '';
    const mm = diameterMmFromName(name);
    if (mm === null) {
      unmatched++;
      console.log(`? ${tool.partID} ${name} — could not parse size`);
      continue;
    }
    const newDia = round3(mm);
    const currentDia = tool.diameter !== null && tool.diameter !== undefined
      ? Number(tool.diameter) : null;
    if (currentDia !== null && Math.abs(currentDia - newDia) < 0.0005) {
      unchanged++;
      continue;
    }

    if (dryRun) {
      console.log(`[dry] tool#${tool.id} (part${tool.partID}) ${name}: diameter ${currentDia ?? '∅'} → ${newDia} mm`);
      updated++;
      continue;
    }

    const putRes = await request('PUT',
      `${baseUrl}/tools/tool/${tool.id}`, { diameter: newDia }, token);
    if (putRes.status === 200) {
      updated++;
      console.log(`✓ ${name} → ${newDia} mm`);
    } else {
      failed++;
      const msg = putRes.data?.errorMessage || putRes.data?.error || JSON.stringify(putRes.data);
      console.log(`✗ tool#${tool.id} ${name} [${putRes.status}] ${msg}`);
    }
  }

  console.log(`\nDone. updated=${updated} unchanged=${unchanged} unmatched=${unmatched} failed=${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
