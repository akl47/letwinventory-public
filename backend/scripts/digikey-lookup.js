#!/usr/bin/env node
/**
 * DigiKey Part Lookup Script
 *
 * Searches DigiKey for parts by their name (manufacturer part number),
 * then updates the part's link and sku fields with DigiKey data.
 *
 * Usage:
 *   node backend/scripts/digikey-lookup.js <partID...>        Single or multiple parts
 *   node backend/scripts/digikey-lookup.js --all              All parts with empty link
 *   node backend/scripts/digikey-lookup.js --all --dry-run    Preview without saving
 *   node backend/scripts/digikey-lookup.js --all --image      Also download product images
 *   node backend/scripts/digikey-lookup.js --all --prod       Use production API
 *   node backend/scripts/digikey-lookup.js --all --token <jwt> Provide auth token manually
 */

const path = require('path');
const readline = require('readline');

// Parse command line arguments (before env loading so --prod is available)
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
  console.error('Usage: node backend/scripts/digikey-lookup.js <partID...> [--dry-run]');
  console.error('       node backend/scripts/digikey-lookup.js --all [--dry-run]');
  process.exit(1);
}

const DIGIKEY_CLIENT_ID = process.env.DIGIKEY_CLIENT_ID;
const DIGIKEY_CLIENT_SECRET = process.env.DIGIKEY_CLIENT_SECRET;

if (!DIGIKEY_CLIENT_ID || !DIGIKEY_CLIENT_SECRET) {
  console.error('Error: DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET must be set in your .env file');
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

async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`, { headers: authHeaders });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`${API_URL}${path}`, { method: 'PUT', headers: authHeaders, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API PUT ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: authHeaders, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// --- DigiKey API helpers ---

let cachedDigiKeyToken = null;

async function getDigiKeyToken() {
  if (cachedDigiKeyToken) return cachedDigiKeyToken;

  const res = await fetch('https://api.digikey.com/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DIGIKEY_CLIENT_ID,
      client_secret: DIGIKEY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedDigiKeyToken = data.access_token;
  return cachedDigiKeyToken;
}

async function searchDigiKey(keyword) {
  const token = await getDigiKeyToken();

  const res = await fetch('https://api.digikey.com/products/v4/search/keyword', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-DIGIKEY-Client-Id': DIGIKEY_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ Keywords: keyword, Limit: 5 }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DigiKey search failed (${res.status}): ${text}`);
  }

  return res.json();
}

function findMatches(products, partName) {
  const matches = [];
  for (const product of products) {
    if (product.ManufacturerProductNumber?.toLowerCase() === partName.toLowerCase()) {
      const productStatus = product.ProductStatus?.Status || 'Unknown';
      const totalStock = product.QuantityAvailable || 0;
      const photoUrl = product.PhotoUrl || null;
      for (const variation of (product.ProductVariations || [])) {
        matches.push({
          link: product.ProductUrl || null,
          sku: variation.DigiKeyProductNumber || null,
          packaging: variation.PackageType?.Name || 'Unknown',
          stock: variation.QuantityAvailableforPackageType ?? totalStock,
          productStatus,
          photoUrl,
          manufacturerPN: product.ManufacturerProductNumber,
        });
      }
      // If no variations, still include the product
      if ((product.ProductVariations || []).length === 0) {
        matches.push({
          link: product.ProductUrl || null,
          sku: null,
          packaging: 'N/A',
          stock: totalStock,
          productStatus,
          photoUrl,
          manufacturerPN: product.ManufacturerProductNumber,
        });
      }
    }
  }
  return matches;
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

async function downloadImage(photoUrl, partName) {
  const res = await fetch(photoUrl);
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
  // API validator requires all non-null fields, so fetch full part and merge
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
  console.log(`\n  Part ${part.id}: "${part.name}"`);

  let result;
  try {
    result = await searchDigiKey(part.name);
  } catch (err) {
    console.log(`    ERROR: ${err.message}`);
    return { status: 'error', part };
  }

  const products = result.Products || [];
  if (products.length === 0) {
    console.log(`    No results found`);
    return { status: 'no-results', part };
  }

  const matches = findMatches(products, part.name);
  if (matches.length === 0) {
    console.log(`    No exact match (found ${products.length} results)`);
    for (const p of products.slice(0, 3)) {
      console.log(`      - ${p.ManufacturerProductNumber}`);
    }
    return { status: 'no-match', part };
  }

  let match;
  if (matches.length === 1) {
    match = matches[0];
  } else {
    console.log(`    Multiple options for ${matches[0].manufacturerPN}:`);
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      console.log(`      ${i + 1}) ${m.sku} [${m.packaging}] - ${m.stock} in stock (${m.productStatus})`);
    }
    console.log(`      0) Skip`);
    const answer = await prompt('    Select: ');
    const choice = parseInt(answer, 10);
    if (!choice || choice < 1 || choice > matches.length) {
      console.log(`    Skipped`);
      return { status: 'skipped', part };
    }
    match = matches[choice - 1];
  }

  console.log(`    MATCH: ${match.manufacturerPN}`);
  console.log(`      sku:   ${match.sku}`);
  console.log(`      link:  ${match.link}`);
  console.log(`      image: ${match.photoUrl}`);

  // Check if sku/link already match
  const skuSame = part.sku && part.sku === match.sku;
  const linkSame = part.link && part.link === match.link;
  if (skuSame && linkSame) {
    console.log(`    Already up to date (sku and link match)`);
    if (!pullImages || !match.photoUrl || part.imageFileID) {
      return { status: 'skipped', part };
    }
    // Fall through to image handling below
  }

  const changes = {};

  // Only update fields that are currently empty; prompt on conflicts
  if (!part.sku) {
    changes.sku = match.sku;
  } else if (!skuSame) {
    console.log(`    SKU conflict:`);
    console.log(`      1) Keep existing: ${part.sku}`);
    console.log(`      2) Use DigiKey:   ${match.sku}`);
    if (!dryRun) {
      const answer = await prompt('    Select [1]: ');
      if (answer === '2') changes.sku = match.sku;
    }
  }

  if (!part.link) {
    changes.link = match.link;
  } else if (!linkSame) {
    console.log(`    Link conflict:`);
    console.log(`      1) Keep existing: ${part.link}`);
    console.log(`      2) Use DigiKey:   ${match.link}`);
    if (!dryRun) {
      const answer = await prompt('    Select [1]: ');
      if (answer === '2') changes.link = match.link;
    }
  }

  if (!part.vendor) changes.vendor = 'DigiKey';

  // Image handling
  if (pullImages && match.photoUrl) {
    if (part.imageFileID) {
      console.log(`    Image already exists (fileID: ${part.imageFileID}), skipping download`);
    } else if (!dryRun) {
      try {
        const fileId = await downloadImage(match.photoUrl, part.name);
        changes.imageFileID = fileId;
        console.log(`    Image saved (fileID: ${fileId})`);
      } catch (err) {
        console.log(`    Image download failed: ${err.message}`);
      }
    } else {
      console.log(`    [dry-run] Would download image: ${match.photoUrl}`);
    }
  }

  if (!dryRun) {
    await updatePart(part.id, changes);
    console.log(`    UPDATED`);
  } else {
    console.log(`    [dry-run] Would update`);
  }

  return { status: 'updated', part, match };
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
      .filter(p => p.activeFlag === true && !p.link && p.vendor === 'Digi-Key')
      .sort((a, b) => a.id - b.id);
    console.log(`Found ${parts.length} Digi-Key parts with empty link`);
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

    // Rate limit: 1 second between API calls
    if (i < parts.length - 1) {
      await sleep(1000);
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
