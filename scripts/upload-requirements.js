#!/usr/bin/env node
/**
 * Uploads requirements from docs/requirements.json to a Letwinventory server.
 *
 * Usage: node scripts/upload-requirements.js --token <jwt> --project <projectID> [--url <apiUrl>] [--dry-run]
 *
 * Options:
 *   --token     JWT auth token (required)
 *   --project   Project ID to assign requirements to (required)
 *   --url       API base URL (default: http://localhost:3000/api)
 *   --dry-run   Print what would be uploaded without making requests
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
const dryRun = args.includes('--dry-run');
const token = getArg('token');
const projectID = getArg('project');
const apiUrl = getArg('url') || 'http://localhost:3000/api';

if (!token || !projectID) {
  console.error('Usage: node scripts/upload-requirements.js --token <jwt> --project <projectID> [--url <apiUrl>] [--dry-run]');
  process.exit(1);
}

const jsonPath = path.join(__dirname, '..', 'docs', 'requirements.json');
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

async function request(method, endpoint, body) {
  const res = await fetch(`${apiUrl}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${endpoint} — ${res.status}: ${text}`);
  }
  return res.json();
}

// Step 1: Create categories, return name -> id map
async function createCategories() {
  const categoryMap = {};
  for (const cat of data.categories) {
    if (dryRun) {
      console.log(`[DRY RUN] Create category: ${cat.name} (${cat.description})`);
      categoryMap[cat.name] = `<id:${cat.name}>`;
      continue;
    }
    try {
      const created = await request('POST', '/design/requirement-category', {
        name: cat.name,
        description: cat.description,
      });
      categoryMap[cat.name] = created.id;
      console.log(`Created category: ${cat.name} (id: ${created.id})`);
    } catch (err) {
      // May already exist
      console.warn(`Category "${cat.name}" may already exist, fetching list...`);
      const all = await request('GET', '/design/requirement-category');
      const existing = all.find(c => c.name === cat.name);
      if (existing) {
        categoryMap[cat.name] = existing.id;
        console.log(`Using existing category: ${cat.name} (id: ${existing.id})`);
      } else {
        throw err;
      }
    }
  }
  return categoryMap;
}

// Step 2: Upload requirements depth-first so parents exist before children
async function uploadRequirements(nodes, parentID, categoryMap, depth) {
  let count = 0;
  for (const node of nodes) {
    const indent = '  '.repeat(depth);
    const desc = node.description.slice(0, 70);
    const body = {
      projectID: parseInt(projectID),
      categoryID: categoryMap[node.categoryName] || null,
      description: node.description,
      rationale: node.rationale || null,
      parameter: node.parameter || null,
      verification: node.verification || null,
      validation: node.validation || null,
      parentRequirementID: parentID || null,
    };

    if (dryRun) {
      console.log(`[DRY RUN] ${indent}${desc}...`);
      console.log(`          ${indent}category: ${node.categoryName}, parent: ${parentID || 'root'}`);
      count++;
      if (node.children) {
        count += await uploadRequirements(node.children, `<parent>`, categoryMap, depth + 1);
      }
      continue;
    }

    const created = await request('POST', '/design/requirement', body);
    console.log(`${indent}Created id:${created.id} — ${desc}...`);
    count++;

    if (node.children) {
      count += await uploadRequirements(node.children, created.id, categoryMap, depth + 1);
    }
  }
  return count;
}

function countAll(nodes) {
  let c = 0;
  for (const n of nodes) {
    c++;
    if (n.children) c += countAll(n.children);
  }
  return c;
}

async function main() {
  console.log(`Target: ${apiUrl}`);
  console.log(`Project ID: ${projectID}`);
  console.log(`Requirements: ${countAll(data.requirements)} total`);
  console.log(`Categories: ${data.categories.length}`);
  if (dryRun) console.log('\n--- DRY RUN MODE ---\n');
  else console.log('');

  const categoryMap = await createCategories();
  console.log(`\nCategories ready: ${Object.keys(categoryMap).length}\n`);
  console.log('Uploading requirements...\n');

  const count = await uploadRequirements(data.requirements, null, categoryMap, 0);
  console.log(`\nDone. ${dryRun ? 'Would upload' : 'Uploaded'} ${count} requirements.`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
