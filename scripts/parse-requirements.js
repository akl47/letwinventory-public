#!/usr/bin/env node
/**
 * Parses docs/requirements.md into docs/requirements.json
 *
 * Usage: node scripts/parse-requirements.js
 */
const fs = require('fs');
const path = require('path');

const mdPath = path.join(__dirname, '..', 'docs', 'requirements.md');
const jsonPath = path.join(__dirname, '..', 'docs', 'requirements.json');

const md = fs.readFileSync(mdPath, 'utf-8');
const lines = md.split('\n');

// Map parsed section keys to short names + descriptions
const CATEGORY_MAP = {
  '1.1 General System': { name: 'System', description: 'General System' },
  '1.2 Quality Management System (ISO 13485:2016 §4.1, §4.2 / 21 CFR 820.20)': { name: 'QMS', description: 'Quality Management System (ISO 13485:2016 §4.1, §4.2 / 21 CFR 820.20)' },
  '1.3 Design Controls (21 CFR 820.30 / ISO 13485:2016 §7.3 / AS9100D §8.3)': { name: 'Design Controls', description: 'Design Controls (21 CFR 820.30 / ISO 13485:2016 §7.3 / AS9100D §8.3)' },
  '1.4 Purchasing Controls (21 CFR 820.50 / ISO 13485:2016 §7.4 / AS9100D §8.4)': { name: 'Purchasing Controls', description: 'Purchasing Controls (21 CFR 820.50 / ISO 13485:2016 §7.4 / AS9100D §8.4)' },
  '1.5 Identification and Traceability (21 CFR 820.60, 820.65 / ISO 13485:2016 §7.5.3, §7.5.9 / AS9100D §8.5.2)': { name: 'Identification & Traceability', description: 'Identification and Traceability (21 CFR 820.60, 820.65 / ISO 13485:2016 §7.5.3, §7.5.9 / AS9100D §8.5.2)' },
  '1.6 Production and Process Controls (21 CFR 820.70 / ISO 13485:2016 §7.5 / AS9100D §8.5)': { name: 'Production & Process Controls', description: 'Production and Process Controls (21 CFR 820.70 / ISO 13485:2016 §7.5 / AS9100D §8.5)' },
  '1.7 Labeling Controls (21 CFR 820.120 / ISO 13485:2016 §7.5.1 / AS9100D §8.5.1)': { name: 'Labeling Controls', description: 'Labeling Controls (21 CFR 820.120 / ISO 13485:2016 §7.5.1 / AS9100D §8.5.1)' },
  '1.8 Records and Data Integrity (21 CFR 820.180-186 / ISO 13485:2016 §4.2.5)': { name: 'Records & Data Integrity', description: 'Records and Data Integrity (21 CFR 820.180-186 / ISO 13485:2016 §4.2.5)' },
  '1.9 Operational Risk Management (AS9100D §8.1.1)': { name: 'Operational Risk Management', description: 'Operational Risk Management (AS9100D §8.1.1)' },
  '1.10 Configuration Management (AS9100D §8.1.2)': { name: 'Configuration Management', description: 'Configuration Management (AS9100D §8.1.2)' },
  '1.11 Product Safety (AS9100D §8.1.3)': { name: 'Product Safety', description: 'Product Safety (AS9100D §8.1.3)' },
  '1.12 Prevention of Counterfeit Parts (AS9100D §8.1.4)': { name: 'Counterfeit Parts Prevention', description: 'Prevention of Counterfeit Parts (AS9100D §8.1.4)' },
  '1.13 Control of Externally Provided Products (AS9100D §8.4 / ISO 13485:2016 §7.4)': { name: 'External Providers', description: 'Control of Externally Provided Products (AS9100D §8.4 / ISO 13485:2016 §7.4)' },
  '1.14 Production Process Verification (AS9100D §8.5.1.3)': { name: 'Production Process Verification', description: 'Production Process Verification (AS9100D §8.5.1.3)' },
  '1.15 Nonconforming Product Control (AS9100D §8.7 / 21 CFR 820.90 / ISO 13485:2016 §8.3)': { name: 'Nonconforming Product', description: 'Nonconforming Product Control (AS9100D §8.7 / 21 CFR 820.90 / ISO 13485:2016 §8.3)' },
  '2 Authentication & Authorization': { name: 'Authentication', description: 'Authentication & Authorization' },
  '3 Inventory Management': { name: 'Inventory', description: 'Inventory Management' },
  '4 Barcode Management': { name: 'Barcode', description: 'Barcode Management' },
  '5 Parts Management': { name: 'Parts', description: 'Parts Management' },
  '6 Order Management': { name: 'Orders', description: 'Order Management' },
  '7 Wire Harness Design': { name: 'Wire Harness', description: 'Wire Harness Design' },
  '8 Planning & Task Management': { name: 'Planning', description: 'Planning & Task Management' },
  '9 File Management': { name: 'File Management', description: 'File Management' },
  '10 Mobile Scanner': { name: 'Mobile', description: 'Mobile Scanner' },
  '11 Configuration & Printer Management': { name: 'Configuration', description: 'Configuration & Printer Management' },
  '12 UI/UX Requirements': { name: 'UX', description: 'UI/UX Requirements' },
  '13 Push Notifications': { name: 'Notifications', description: 'Push Notifications' },
  '14 Design Requirements': { name: 'Design Requirements', description: 'Design Requirements' },
  'Appendix A Development Requirements': { name: 'Development', description: 'Development Requirements' },
};

const requirements = [];
let currentSection = '';
let currentReq = null;
let currentField = null;

function flushReq() {
  if (!currentReq) return;
  // Trim all text fields
  for (const key of ['description', 'rationale', 'parameter', 'verification', 'validation']) {
    if (currentReq[key]) currentReq[key] = currentReq[key].trim();
  }
  requirements.push(currentReq);
  currentReq = null;
  currentField = null;
}

for (const line of lines) {
  // Section headings: ## N. Title, ### N.N Title, or ## Appendix X: Title
  const sectionMatch = line.match(/^#{2,3}\s+(\d+(?:\.\d+)?)\.\s+(.+)/);
  const subsectionMatch = !sectionMatch && line.match(/^#{2,3}\s+(\d+\.\d+)\s+(.+)/);
  const appendixMatch = !sectionMatch && !subsectionMatch && line.match(/^#{2,3}\s+(Appendix\s+\w+)[:\s]+(.+)/);
  if ((sectionMatch || subsectionMatch || appendixMatch) && !line.match(/^### REQ-/)) {
    const m = sectionMatch || subsectionMatch || appendixMatch;
    currentSection = `${m[1]} ${m[2]}`;
    continue;
  }

  // Requirement heading: ### REQ-XXX-NNN
  const reqMatch = line.match(/^### (REQ-[\w-]+)/);
  if (reqMatch) {
    flushReq();
    currentReq = {
      reqId: reqMatch[1],
      section: currentSection,
      description: '',
      rationale: '',
      parameter: '',
      parentReqId: null,
      verification: '',
      validation: '',
    };
    currentField = null;
    continue;
  }

  if (!currentReq) continue;

  // Field lines: - **FieldName:** value
  const fieldMatch = line.match(/^- \*\*(.+?):\*\*\s*(.*)/);
  if (fieldMatch) {
    const label = fieldMatch[1].toLowerCase();
    const value = fieldMatch[2].trim();

    if (label === 'description') {
      currentReq.description = value;
      currentField = 'description';
    } else if (label === 'rationale') {
      currentReq.rationale = value;
      currentField = 'rationale';
    } else if (label.startsWith('parameter')) {
      currentReq.parameter = value;
      currentField = 'parameter';
    } else if (label === 'parent req') {
      currentReq.parentReqId = value === 'None' ? null : value.trim();
      currentField = null;
    } else if (label === 'derived reqs') {
      // Skip - not needed for upload
      currentField = null;
    } else if (label.startsWith('verification') || label === 'verified by') {
      currentReq.verification = value;
      currentField = 'verification';
    } else if (label === 'validation') {
      currentReq.validation = value;
      currentField = 'validation';
    } else {
      currentField = null;
    }
    continue;
  }

  // Continuation lines (indented text belonging to previous field)
  if (currentField && line.startsWith('  ')) {
    currentReq[currentField] += ' ' + line.trim();
  }
}

flushReq();

// Build hierarchy: nest children under their parent
const byId = new Map();
for (const req of requirements) {
  byId.set(req.reqId, { ...req, children: [] });
}

const roots = [];
for (const req of byId.values()) {
  if (req.parentReqId && byId.has(req.parentReqId)) {
    byId.get(req.parentReqId).children.push(req);
  } else {
    roots.push(req);
  }
}

// Build categories with name/description from map
const seenSections = [...new Set(requirements.map(r => r.section))].filter(Boolean);
const categories = seenSections.map(section => {
  const mapped = CATEGORY_MAP[section];
  if (!mapped) {
    console.warn(`WARNING: No category mapping for section "${section}"`);
    return { name: section, description: section };
  }
  return mapped;
});

// Rebuild nodes with explicit key order: fields, categoryName, children last
function cleanNode(node) {
  const mapped = CATEGORY_MAP[node.section];
  const ordered = {
    description: node.description,
    rationale: node.rationale,
    parameter: node.parameter,
    verification: node.verification,
    validation: node.validation,
    categoryName: mapped ? mapped.name : node.section,
  };
  if (node.children.length > 0) {
    node.children.forEach(cleanNode);
    ordered.children = node.children;
  }
  for (const key of Object.keys(node)) delete node[key];
  Object.assign(node, ordered);
}
roots.forEach(cleanNode);

const output = { categories, requirements: roots };

fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
const total = requirements.length;
console.log(`Parsed ${total} requirements (${roots.length} top-level) into ${jsonPath}`);
console.log(`Categories: ${categories.length}`);
