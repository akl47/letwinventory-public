#!/usr/bin/env node
/**
 * Pinball Life Part Lookup Script
 *
 * Scrapes pinballlife.com for parts by their SKU (PBL product code),
 * then updates the part's link field and optionally downloads product images.
 *
 * Usage:
 *   node backend/scripts/pinballlife-lookup.js --token <jwt> <partID...>
 *   node backend/scripts/pinballlife-lookup.js --token <jwt> --all
 *   node backend/scripts/pinballlife-lookup.js --token <jwt> --all --dry-run
 *   node backend/scripts/pinballlife-lookup.js --token <jwt> --all --image
 *   node backend/scripts/pinballlife-lookup.js --token <jwt> --all --prod
 */

const path = require('path');
const readline = require('readline');

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const all = args.includes('--all');
const pullImages = args.includes('--image');
const useProduction = args.includes('--prod');
const tokenIdx = args.indexOf('--token');
const token = tokenIdx !== -1 ? args[tokenIdx + 1] : null;
const partIds = args.filter((arg, i) => !arg.startsWith('--') && i !== tokenIdx + 1);

if (!token) {
  console.error('Error: --token <jwt> is required. Get your token from the auth_token cookie in the browser.');
  process.exit(1);
}

// Load environment variables
const envFile = useProduction ? '.env.production' : '.env.development';
require('dotenv').config({ path: path.join(__dirname, '../../', envFile) });

if (!all && partIds.length === 0) {
  console.error('Usage: node backend/scripts/pinballlife-lookup.js --token <jwt> <partID...> [--dry-run]');
  console.error('       node backend/scripts/pinballlife-lookup.js --token <jwt> --all [--dry-run]');
  process.exit(1);
}

// --- Letwinventory API helpers ---

const API_URL = useProduction
  ? `${process.env.FRONTEND_URL}/api`
  : `http://localhost:${process.env.BACKEND_PORT || 3000}/api`;

const authHeaders = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
};

async function apiGet(urlPath) {
  const res = await fetch(`${API_URL}${urlPath}`, { headers: authHeaders });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API GET ${urlPath} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function apiPut(urlPath, body) {
  const res = await fetch(`${API_URL}${urlPath}`, { method: 'PUT', headers: authHeaders, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API PUT ${urlPath} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function apiPost(urlPath, body) {
  const res = await fetch(`${API_URL}${urlPath}`, { method: 'POST', headers: authHeaders, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST ${urlPath} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// --- Pinball Life scraping ---

const PBL_BASE = 'https://www.pinballlife.com';

async function lookupProduct(sku) {
  // Direct product page lookup by SKU — returns server-rendered HTML
  const url = `${PBL_BASE}/mm5/merchant.mvc?Screen=PROD&Product_Code=${encodeURIComponent(sku)}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Product lookup failed (${res.status})`);
  }
  const html = await res.text();

  // Check if the page is actually a product page (not a redirect/error)
  if (!html.includes(sku)) return null;

  // Extract canonical product URL from the final resolved URL or page content
  const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/);
  const link = canonicalMatch ? canonicalMatch[1] : res.url;

  // Extract product name from title or heading
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const name = titleMatch ? titleMatch[1].replace(/\s*[-|].*$/, '').trim() : sku;

  // Extract image from og:image meta tag (full URL already present in static HTML)
  let imageUrl = null;
  const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
  if (ogImageMatch) {
    imageUrl = ogImageMatch[1];
  }

  return { link, name, code: sku, imageUrl };
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function downloadImage(imageUrl, partName) {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Image download failed (${res.status})`);
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  const base64 = buffer.toString('base64');
  const ext = contentType.includes('png') ? 'png' : 'jpg';

  const file = await apiPost('/files', {
    filename: `${partName}.${ext}`,
    mimeType: contentType,
    data: `data:${contentType};base64,${base64}`,
  });

  return file.id;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updatePart(partId, updateData) {
  const part = await apiGet(`/inventory/part/${partId}`);
  const body = {
    name: part.name,
    internalPart: part.internalPart,
    vendor: part.vendor,
    minimumOrderQuantity: part.minimumOrderQuantity,
    partCategoryID: part.partCategoryID,
    serialNumberRequired: part.serialNumberRequired,
    lotNumberRequired: part.lotNumberRequired,
    description: part.description,
    sku: part.sku,
    link: part.link,
    defaultUnitOfMeasureID: part.defaultUnitOfMeasureID,
    manufacturer: part.manufacturer,
    manufacturerPN: part.manufacturerPN,
    imageFileID: part.imageFileID,
    ...updateData,
  };
  return apiPut(`/inventory/part/${partId}`, body);
}

async function processPart(part) {
  const sku = part.sku || part.name;
  console.log(`\n  Part ${part.id}: "${part.name}" (SKU: ${sku})`);

  let match;
  try {
    match = await lookupProduct(sku);
  } catch (err) {
    console.log(`    ERROR: ${err.message}`);
    return { status: 'error' };
  }

  if (!match) {
    console.log(`    Product not found on Pinball Life`);
    return { status: 'no-results' };
  }

  console.log(`    FOUND: ${match.name}`);
  console.log(`      link:  ${match.link}`);
  console.log(`      image: ${match.imageUrl || 'none'}`);

  // Check if link already matches
  const linkSame = part.link && part.link === match.link;
  if (linkSame) {
    const imageStatus = part.imageFileID ? 'has image' : match.imageUrl ? 'image available' : 'no image';
    console.log(`    Already up to date (link matches, ${imageStatus})`);
    if (!pullImages || !match.imageUrl || part.imageFileID) {
      return { status: 'skipped' };
    }
  }

  const changes = {};

  if (!part.link) {
    changes.link = match.link;
  } else if (!linkSame) {
    console.log(`    Link conflict:`);
    console.log(`      1) Keep existing: ${part.link}`);
    console.log(`      2) Use PBL:       ${match.link}`);
    if (!dryRun) {
      const answer = await prompt('    Select [1]: ');
      if (answer === '2') changes.link = match.link;
    }
  }

  // Image handling
  if (pullImages && match.imageUrl) {
    if (part.imageFileID) {
      console.log(`    Image already exists (fileID: ${part.imageFileID}), skipping download`);
    } else if (!dryRun) {
      try {
        const fileId = await downloadImage(match.imageUrl, part.name);
        changes.imageFileID = fileId;
        console.log(`    Image saved (fileID: ${fileId})`);
      } catch (err) {
        console.log(`    Image download failed: ${err.message}`);
      }
    } else {
      console.log(`    [dry-run] Would download image: ${match.imageUrl}`);
    }
  }

  if (Object.keys(changes).length > 0) {
    if (!dryRun) {
      await updatePart(part.id, changes);
      console.log(`    UPDATED`);
    } else {
      console.log(`    [dry-run] Would update`);
    }
    return { status: 'updated' };
  }

  return { status: 'skipped' };
}

async function main() {
  console.log(`Using API: ${API_URL}`);

  if (dryRun) {
    console.log('*** DRY RUN - No changes will be made ***');
  }

  let parts;

  if (all) {
    const allParts = await apiGet('/inventory/part');
    parts = allParts
      .filter(p => p.activeFlag === true && p.vendor === 'Pinball Life')
      .sort((a, b) => a.id - b.id);
    console.log(`Found ${parts.length} Pinball Life parts`);
  } else {
    parts = [];
    for (const id of partIds) {
      try {
        const part = await apiGet(`/inventory/part/${id}`);
        parts.push(part);
      } catch (err) {
        console.error(`Error fetching part ${id}: ${err.message}`);
        process.exit(1);
      }
    }
  }

  if (parts.length === 0) {
    console.log('No parts to process');
    return;
  }

  const results = { updated: 0, noResults: 0, noMatch: 0, skipped: 0, errors: 0 };

  for (let i = 0; i < parts.length; i++) {
    const { status } = await processPart(parts[i]);

    if (status === 'updated') results.updated++;
    else if (status === 'no-results') results.noResults++;
    else if (status === 'no-match') results.noMatch++;
    else if (status === 'skipped') results.skipped++;
    else if (status === 'error') results.errors++;

    // Rate limit: 2 seconds between requests (be nice to the site)
    if (i < parts.length - 1) {
      await sleep(2000);
    }
  }

  console.log('\n' + '='.repeat(40));
  console.log('SUMMARY');
  console.log('='.repeat(40));
  console.log(`Updated:    ${results.updated}`);
  console.log(`No results: ${results.noResults}`);
  console.log(`No match:   ${results.noMatch}`);
  console.log(`Skipped:    ${results.skipped}`);
  console.log(`Errors:     ${results.errors}`);

  if (dryRun) {
    console.log('\n*** DRY RUN COMPLETE - No changes were made ***');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nError:', error.message);
    process.exit(1);
  });
