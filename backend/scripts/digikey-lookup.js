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
 *   node backend/scripts/digikey-lookup.js --all --prod       Use production database
 */

const path = require('path');
const readline = require('readline');

// Parse command line arguments (before env loading so --prod is available)
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const all = args.includes('--all');
const pullImages = args.includes('--image');
const useProduction = args.includes('--prod');
const partIds = args.filter(arg => !arg.startsWith('--'));

// Load environment variables
const envFile = useProduction ? '.env.production' : '.env.development';
require('dotenv').config({ path: path.join(__dirname, '../../', envFile) });

const db = require('../models');
const { Part, UploadedFile, sequelize } = db;

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

let cachedToken = null;

async function getToken() {
  if (cachedToken) return cachedToken;

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
  cachedToken = data.access_token;
  return cachedToken;
}

async function searchDigiKey(keyword) {
  const token = await getToken();

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

  const file = await UploadedFile.create({
    filename: `${partName}.${ext}`,
    mimeType: contentType,
    fileSize: buffer.length,
    data: `data:${contentType};base64,${base64}`,
    uploadedBy: null,
    activeFlag: true,
  });

  return file.id;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  // Check if sku/link already match what's in the DB
  const skuSame = part.sku && part.sku === match.sku;
  const linkSame = part.link && part.link === match.link;
  if (skuSame && linkSame) {
    console.log(`    Already up to date (sku and link match)`);
    if (!pullImages || !match.photoUrl || part.imageFileID) {
      return { status: 'skipped', part };
    }
    // Fall through to image handling below
  }

  const updateData = {};

  // Only update fields that are currently empty; prompt on conflicts
  if (!part.sku) {
    updateData.sku = match.sku;
  } else if (!skuSame) {
    console.log(`    SKU conflict:`);
    console.log(`      1) Keep existing: ${part.sku}`);
    console.log(`      2) Use DigiKey:   ${match.sku}`);
    if (!dryRun) {
      const answer = await prompt('    Select [1]: ');
      if (answer === '2') updateData.sku = match.sku;
    }
  }

  if (!part.link) {
    updateData.link = match.link;
  } else if (!linkSame) {
    console.log(`    Link conflict:`);
    console.log(`      1) Keep existing: ${part.link}`);
    console.log(`      2) Use DigiKey:   ${match.link}`);
    if (!dryRun) {
      const answer = await prompt('    Select [1]: ');
      if (answer === '2') updateData.link = match.link;
    }
  }

  if (!part.vendor) updateData.vendor = 'DigiKey';

  // Image handling
  if (pullImages && match.photoUrl) {
    if (part.imageFileID) {
      console.log(`    Image already exists (fileID: ${part.imageFileID}), skipping download`);
    } else if (!dryRun) {
      try {
        const fileId = await downloadImage(match.photoUrl, part.name);
        updateData.imageFileID = fileId;
        console.log(`    Image saved (fileID: ${fileId})`);
      } catch (err) {
        console.log(`    Image download failed: ${err.message}`);
      }
    } else {
      console.log(`    [dry-run] Would download image: ${match.photoUrl}`);
    }
  }

  if (!dryRun) {
    await part.update(updateData);
    console.log(`    UPDATED`);
  } else {
    console.log(`    [dry-run] Would update`);
  }

  return { status: 'updated', part, match };
}

async function main() {
  if (dryRun) {
    console.log('*** DRY RUN - No changes will be made ***');
  }

  let parts;

  if (all) {
    parts = await Part.findAll({
      where: { link: null, activeFlag: true },
      order: [['id', 'ASC']],
    });
    console.log(`Found ${parts.length} parts with empty link`);
  } else {
    parts = [];
    for (const id of partIds) {
      const part = await Part.findByPk(id);
      if (!part) {
        console.error(`Error: Part ${id} not found`);
        process.exit(1);
      }
      parts.push(part);
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
