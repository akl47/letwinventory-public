#!/usr/bin/env node
/**
 * Fills missing dimension fields on drill bit Tool records (ToolSubcategory 27).
 * Never overwrites an existing (non-null) value.
 *
 *   shankDiameter   ← tool.diameter            (when shankDiameter null & diameter set)
 *   numberOfFlutes  ← 2                        (when null)
 *   overallLength   ← jobber chart, mm         (when null & size is on chart)
 *   fluteLength     ← jobber chart, mm         (when null & size is on chart)
 *
 * Chart source: https://drillsandcutters.com/jobber-length-drill-bit-chart/
 * Fractional/letter/number values × 25.4 → mm. Metric values used directly.
 * Drill sizes not on the chart (e.g. fractional ≥ 23/32") still get
 * shankDiameter and numberOfFlutes filled — only OAL/flute are skipped.
 *
 * Usage:
 *   node scripts/fill-drill-bit-dimensions.js [--url <baseUrl>] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const TOKEN_CACHE = '/tmp/letwinventory-tools-token.json';
const DEFAULT_BASE_URL = 'https://letwinventory.letwin.co/api';
const DRILL_SUBCATEGORY_ID = 27;
const INCH_TO_MM = 25.4;
const DEFAULT_FLUTES = 2;

// ── Jobber drill bit chart ──────────────────────────────────────────────────
// Number/letter/fractional tables list [oalInchStr, fluteInchStr] as fractions.
// Metric table lists [oalMm, fluteMm] directly.

const NUMBER_DRILL_DIMS = {
   1:['3-7/8','2-5/8'],   2:['3-7/8','2-5/8'],   3:['3-3/4','2-1/2'],   4:['3-3/4','2-1/2'],
   5:['3-3/4','2-1/2'],   6:['3-3/4','2-1/2'],   7:['3-5/8','2-7/16'],  8:['3-5/8','2-7/16'],
   9:['3-5/8','2-7/16'], 10:['3-5/8','2-7/16'], 11:['3-1/2','2-5/16'], 12:['3-1/2','2-5/16'],
  13:['3-1/2','2-5/16'], 14:['3-3/8','2-3/16'], 15:['3-3/8','2-3/16'], 16:['3-3/8','2-3/16'],
  17:['3-3/8','2-3/16'], 18:['3-1/4','2-1/8'],  19:['3-1/4','2-1/8'],  20:['3-1/4','2-1/8'],
  21:['3-1/4','2-1/8'],  22:['3-1/8','2'],      23:['3-1/8','2'],      24:['3-1/8','2'],
  25:['3','1-7/8'],      26:['3','1-7/8'],      27:['3','1-7/8'],      28:['2-7/8','1-3/4'],
  29:['2-7/8','1-3/4'],  30:['2-3/4','1-5/8'],  31:['2-3/4','1-5/8'],  32:['2-3/4','1-5/8'],
  33:['2-5/8','1-1/2'],  34:['2-5/8','1-1/2'],  35:['2-5/8','1-1/2'],  36:['2-1/2','1-7/16'],
  37:['2-1/2','1-7/16'], 38:['2-1/2','1-7/16'], 39:['2-3/8','1-3/8'],  40:['2-3/8','1-3/8'],
  41:['2-3/8','1-3/8'],  42:['2-1/4','1-1/4'],  43:['2-1/4','1-1/4'],  44:['2-1/8','1-1/8'],
  45:['2-1/8','1-1/8'],  46:['2-1/8','1-1/8'],  47:['2','1'],          48:['2','1'],
  49:['2','1'],          50:['2','1'],          51:['2','1'],          52:['1-7/8','7/8'],
  53:['1-7/8','7/8'],    54:['1-7/8','7/8'],    55:['1-7/8','7/8'],    56:['1-3/4','3/4'],
  57:['1-3/4','3/4'],    58:['1-5/8','11/16'],  59:['1-5/8','11/16'],  60:['1-5/8','11/16'],
  61:['1-5/8','11/16'],  62:['1-1/2','5/8'],    63:['1-1/2','5/8'],    64:['1-1/2','5/8'],
  65:['1-1/2','5/8'],    66:['1-3/8','1/2'],    67:['1-3/8','1/2'],    68:['1-3/8','1/2'],
  69:['1-3/8','1/2'],    70:['1-1/4','3/8'],    71:['1-1/4','3/8'],    72:['1-1/8','5/16'],
  73:['1-1/8','5/16'],   74:['1','1/4'],        75:['1','1/4'],        76:['7/8','3/16'],
  77:['7/8','3/16'],     78:['7/8','3/16'],     79:['3/4','1/8'],      80:['3/4','1/8'],
};

const LETTER_DRILL_DIMS = {
  A:['3-7/8','2-5/8'],  B:['4','2-3/4'],      C:['4','2-3/4'],      D:['4','2-3/4'],
  E:['4','2-3/4'],      F:['4-1/8','2-7/8'],  G:['4-1/8','2-7/8'],  H:['4-1/8','2-7/8'],
  I:['4-1/8','2-7/8'],  J:['4-1/8','2-7/8'],  K:['4-1/4','2-15/16'],L:['4-1/4','2-15/16'],
  M:['4-3/8','3-1/16'], N:['4-3/8','3-1/16'], O:['4-1/2','3-3/16'], P:['4-5/8','3-5/16'],
  Q:['4-3/4','3-7/16'], R:['4-3/4','3-7/16'], S:['4-7/8','3-1/2'],  T:['4-7/8','3-1/2'],
  U:['5','3-5/8'],      V:['5','3-5/8'],      W:['5-1/8','3-3/4'],  X:['5-1/8','3-3/4'],
  Y:['5-1/4','3-7/8'],  Z:['5-1/4','3-7/8'],
};

const FRACTIONAL_DRILL_DIMS = {
  '1/64':['3/4','3/16'],     '1/32':['1-3/8','1/2'],    '3/64':['1-3/4','3/4'],    '1/16':['1-7/8','7/8'],
  '5/64':['2','1'],          '3/32':['2-1/4','1-1/4'],  '7/64':['2-5/8','1-1/2'],  '1/8':['2-3/4','1-5/8'],
  '9/64':['2-7/8','1-3/4'],  '5/32':['3-1/8','2'],      '11/64':['3-1/4','2-1/8'], '3/16':['3-1/2','2-5/16'],
  '13/64':['3-5/8','2-7/16'],'7/32':['3-3/4','2-1/2'],  '15/64':['3-7/8','2-5/8'], '1/4':['4','2-3/4'],
  '17/64':['4-1/8','2-7/8'], '9/32':['4-1/4','2-15/16'],'19/64':['4-3/8','3-1/16'],'5/16':['4-1/2','3-3/16'],
  '21/64':['4-5/8','3-5/16'],'11/32':['4-3/4','3-7/16'],'23/64':['4-7/8','3-1/2'], '3/8':['5','3-5/8'],
  '25/64':['5-1/8','3-3/4'], '13/32':['5-1/4','3-7/8'], '27/64':['5-3/8','3-15/16'],'7/16':['5-1/2','4-1/16'],
  '29/64':['5-5/8','4-3/16'],'15/32':['5-3/4','4-5/16'],'31/64':['5-7/8','4-3/8'], '1/2':['6','4-1/2'],
  '33/64':['6-5/8','4-13/16'],'17/32':['6-5/8','4-13/16'],'35/64':['6-5/8','4-13/16'],'9/16':['6-5/8','4-13/16'],
  '37/64':['6-5/8','4-13/16'],'19/32':['7-1/8','5-3/16'],'39/64':['7-1/8','5-3/16'],'5/8':['7-1/8','5-3/16'],
  '41/64':['7-1/8','5-3/16'],'21/32':['7-1/8','5-3/16'],'43/64':['7-5/8','5-5/8'], '11/16':['7-5/8','5-5/8'],
};

// Key matches the metric size token in the part name (number before "mm").
const METRIC_DRILL_DIMS = {
  '0.3':[19,3],   '0.35':[19,3],  '0.4':[20,5],   '0.45':[20,5],  '0.5':[22,5],
  '0.55':[24,6],  '0.6':[24,8],   '0.65':[26,10], '0.7':[28,10],  '0.75':[28,13],
  '0.8':[30,13],  '0.85':[30,16], '0.9':[32,16],  '0.95':[32,16],
  '1':[34,17],    '1.05':[34,17], '1.1':[36,19],  '1.15':[36,19],
  '1.2':[38,22],  '1.25':[38,22], '1.3':[38,22],  '1.35':[40,22],
  '1.4':[40,22],  '1.45':[40,22], '1.5':[40,22],  '1.55':[43,22],
  '1.6':[43,22],  '1.65':[43,25], '1.7':[43,25],  '1.75':[46,25],
  '1.8':[46,25],  '1.85':[46,25], '1.9':[46,25],  '1.95':[49,25],
  '2':[49,25],    '2.05':[49,29], '2.1':[49,29],  '2.15':[53,29],
  '2.2':[53,32],  '2.25':[53,32], '2.3':[53,32],  '2.35':[53,32],
  '2.4':[57,35],  '2.45':[57,35], '2.5':[57,35],  '2.55':[57,35],
  '2.6':[57,37],  '2.65':[57,37], '2.7':[61,37],  '2.75':[61,37],
  '2.8':[61,38],  '2.85':[61,38], '2.9':[61,41],  '2.95':[61,41],
  '3':[61,41],    '3.05':[65,41], '3.1':[65,41],  '3.15':[65,41],
  '3.2':[65,41],  '3.25':[65,41], '3.3':[65,44],  '3.35':[70,44],
  '3.4':[70,44],  '3.45':[70,44], '3.5':[70,44],  '3.55':[70,48],
  '3.6':[70,48],  '3.65':[70,48], '3.7':[70,48],  '3.75':[75,48],
  '3.8':[75,48],  '3.85':[75,51], '3.9':[75,51],  '3.95':[75,51],
  '4':[75,54],    '4.05':[75,54], '4.1':[75,54],  '4.2':[75,54],
  '4.25':[80,54], '4.3':[80,54],  '4.35':[80,54], '4.4':[80,56],
  '4.5':[80,56],  '4.6':[80,56],  '4.65':[80,56], '4.7':[80,59],
  '4.75':[86,59], '4.8':[86,59],  '4.85':[86,62], '4.9':[86,62],
  '5':[86,62],    '5.1':[86,62],  '5.2':[86,64],  '5.25':[86,64],
  '5.3':[86,64],  '5.4':[93,64],  '5.5':[93,64],  '5.6':[93,67],
  '5.7':[93,67],  '5.75':[93,67], '5.8':[93,67],  '5.9':[93,67],
  '6':[93,70],    '6.1':[101,70], '6.2':[101,70], '6.25':[101,70],
  '6.3':[101,70], '6.4':[101,73], '6.5':[101,73], '6.6':[101,73],
  '6.7':[101,73], '6.75':[109,73],'6.8':[109,73], '6.9':[109,73],
  '7':[109,73],   '7.1':[109,75], '7.2':[109,75], '7.25':[109,75],
  '7.3':[109,75], '7.4':[109,78], '7.5':[109,78], '7.6':[117,78],
  '7.7':[117,81], '7.75':[117,81],'7.8':[117,81], '7.9':[117,81],
  '8':[117,81],   '8.1':[117,84], '8.2':[117,84], '8.25':[117,84],
  '8.3':[117,84], '8.4':[117,87], '8.5':[117,87], '8.6':[125,87],
  '8.7':[125,87], '8.75':[125,87],'8.8':[125,89], '8.9':[125,89],
  '9':[125,89],   '9.1':[125,89], '9.2':[125,92], '9.25':[125,92],
  '9.3':[125,92], '9.4':[125,92], '9.5':[125,92], '9.6':[133,95],
  '9.7':[133,95], '9.75':[133,95],'9.8':[133,95], '9.9':[133,95],
  '10':[133,95],  '10.2':[133,98],'10.25':[133,98],'10.5':[133,98],
  '10.7':[142,100],'10.75':[142,101],'10.8':[142,103],'11':[142,103],
  '11.5':[142,106],'11.7':[142,110],'12':[151,111],'12.5':[151,114],
  '12.8':[151,114],'13':[151,114], '13.5':[160,122],'14':[160,122],
  '14.5':[169,122],'15':[169,132], '15.5':[178,132],'16':[178,132],
  '16.5':[184,132],'17':[184,143], '17.5':[191,143],'18':[191,145],
  '18.5':[198,149],'19':[198,149], '19.5':[205,154],'20':[205,154],
};

// "3-7/8", "1/2", "1" → decimal inches
function fracInchToInches(s) {
  s = String(s).trim();
  let total = 0;
  const dash = s.indexOf('-');
  if (dash !== -1) {
    total += parseInt(s.slice(0, dash), 10);
    s = s.slice(dash + 1);
  }
  const slash = s.indexOf('/');
  if (slash !== -1) {
    total += parseInt(s.slice(0, slash), 10) / parseInt(s.slice(slash + 1), 10);
  } else if (s) {
    total += parseFloat(s);
  }
  return total;
}

function inchPairToMm([oalIn, fluteIn]) {
  return {
    oalMm: fracInchToInches(oalIn) * INCH_TO_MM,
    fluteMm: fracInchToInches(fluteIn) * INCH_TO_MM,
  };
}

// Return {oalMm, fluteMm} for a drill name, or null if size unknown / not on chart.
function dimensionsMmFromName(name) {
  if (!name) return null;

  let m = name.match(/^(\d+(?:\.\d+)?)mm\b/i);
  if (m) {
    const e = METRIC_DRILL_DIMS[m[1]];
    return e ? { oalMm: e[0], fluteMm: e[1] } : null;
  }

  m = name.match(/^#(\d{1,2})\b/);
  if (m) {
    const e = NUMBER_DRILL_DIMS[parseInt(m[1], 10)];
    return e ? inchPairToMm(e) : null;
  }

  m = name.match(/^(\d{1,3}\/\d{1,3})/);
  if (m) {
    const e = FRACTIONAL_DRILL_DIMS[m[1]];
    return e ? inchPairToMm(e) : null;
  }

  m = name.match(/^([A-Z])(?=\s|"|$)/);
  if (m) {
    const e = LETTER_DRILL_DIMS[m[1]];
    return e ? inchPairToMm(e) : null;
  }

  return null;
}

function round3(n) { return Math.round(n * 1000) / 1000; }
function isNullish(v) { return v === null || v === undefined; }

// ── env / auth (identical to set-drill-diameters.js) ────────────────────────
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

  let updated = 0, skipped = 0, failed = 0;
  const offChart = [];

  for (const tool of toolsRes.data) {
    const name = tool.part?.name || '';
    const dims = dimensionsMmFromName(name);
    const payload = {};

    if (isNullish(tool.shankDiameter) && !isNullish(tool.diameter)) {
      payload.shankDiameter = round3(Number(tool.diameter));
    }
    if (isNullish(tool.numberOfFlutes)) {
      payload.numberOfFlutes = DEFAULT_FLUTES;
    }
    if (dims) {
      if (isNullish(tool.overallLength)) payload.overallLength = round3(dims.oalMm);
      if (isNullish(tool.fluteLength)) payload.fluteLength = round3(dims.fluteMm);
    } else if (isNullish(tool.overallLength) || isNullish(tool.fluteLength)) {
      offChart.push(`tool#${tool.id} ${name}`);
    }

    if (Object.keys(payload).length === 0) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[dry] tool#${tool.id} ${name}: ${JSON.stringify(payload)}`);
      updated++;
      continue;
    }

    const putRes = await request('PUT',
      `${baseUrl}/tools/tool/${tool.id}`, payload, token);
    if (putRes.status === 200) {
      updated++;
      console.log(`✓ tool#${tool.id} ${name} ${JSON.stringify(payload)}`);
    } else {
      failed++;
      const msg = putRes.data?.errorMessage || putRes.data?.error || JSON.stringify(putRes.data);
      console.log(`✗ tool#${tool.id} ${name} [${putRes.status}] ${msg}`);
    }
  }

  if (offChart.length) {
    console.log(`\nDrill bits not on jobber chart (OAL/flute left null${dryRun ? ', other fields would still be filled' : ''}):`);
    for (const s of offChart) console.log(`  - ${s}`);
  }
  console.log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed} off-chart=${offChart.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
