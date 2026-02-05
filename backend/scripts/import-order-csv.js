#!/usr/bin/env node
/**
 * Import Order CSV Script
 *
 * Takes a CSV file (like DigiKey order export), creates parts if they don't exist,
 * and creates an order with those parts including qty and price.
 *
 * Usage: node backend/scripts/import-order-csv.js <csv-file> [--dry-run]
 *
 * CSV Expected Columns:
 *   name, description, internalPart, vendor, sku, link, activeFlag,
 *   minimumOrderQuantity, partCategoryID, serialNumberRequired, lotNumberRequired,
 *   defaultUnitOfMeasureID, manufacturer, manufacturerPN, qty, price
 */

const fs = require('fs');
const path = require('path');

// Load environment variables
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
require('dotenv').config({ path: path.join(__dirname, '../../', envFile) });

const db = require('../models');
const { Part, Order, OrderItem, sequelize } = db;

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const csvPath = args.find(arg => !arg.startsWith('--'));

if (!csvPath) {
  console.error('Usage: node backend/scripts/import-order-csv.js <csv-file> [--dry-run]');
  console.error('  --dry-run  Show what would be created without making changes');
  process.exit(1);
}

// Resolve CSV path
const resolvedPath = path.isAbsolute(csvPath) ? csvPath : path.resolve(process.cwd(), csvPath);

if (!fs.existsSync(resolvedPath)) {
  console.error(`Error: CSV file not found: ${resolvedPath}`);
  process.exit(1);
}

/**
 * Simple CSV parser that handles quoted fields with commas
 */
function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  // Parse header row
  const headers = parseCSVLine(lines[0]);

  // Parse data rows
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;

    const record = {};
    headers.forEach((header, index) => {
      record[header.trim()] = values[index]?.trim() || '';
    });
    records.push(record);
  }

  return records;
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);

  return values;
}

/**
 * Parse boolean value from CSV
 */
function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return false;
}

/**
 * Parse price value (removes $ and commas)
 */
function parsePrice(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    return parseFloat(value.replace(/[$,]/g, '')) || 0;
  }
  return 0;
}

/**
 * Parse integer with default
 */
function parseInt(value, defaultValue = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Main import function
 */
async function importOrderFromCSV(csvFilePath) {
  console.log(`\nReading CSV: ${csvFilePath}`);
  if (dryRun) {
    console.log('*** DRY RUN - No changes will be made ***\n');
  }

  // Read and parse CSV
  const csvContent = fs.readFileSync(csvFilePath, 'utf-8');
  const records = parseCSV(csvContent);

  if (records.length === 0) {
    console.error('Error: CSV file is empty or has no data rows');
    process.exit(1);
  }

  console.log(`Found ${records.length} parts in CSV\n`);

  // Extract vendor from first record for order description
  const vendor = records[0].vendor || 'Unknown Vendor';
  const filename = path.basename(csvFilePath, path.extname(csvFilePath));

  // Track results
  const results = {
    partsCreated: [],
    partsExisting: [],
    partsSkipped: [],
    orderItems: [],
  };

  // Start transaction
  const transaction = dryRun ? null : await sequelize.transaction();

  try {
    // Process each part
    for (const record of records) {
      const partName = record.name?.trim();

      if (!partName) {
        console.log(`  SKIP: Row with empty name`);
        results.partsSkipped.push({ reason: 'Empty name', record });
        continue;
      }

      // Check if part exists
      const existingPart = await Part.findOne({
        where: { name: partName },
        transaction
      });

      let part;

      if (existingPart) {
        console.log(`  EXISTS: ${partName} (ID: ${existingPart.id})`);
        results.partsExisting.push(existingPart);
        part = existingPart;
      } else {
        // Prepare part data
        const partData = {
          name: partName.substring(0, 16), // Max 16 chars
          description: record.description?.substring(0, 62) || '', // Max 62 chars
          internalPart: parseBoolean(record.internalPart),
          vendor: record.vendor || vendor,
          sku: record.sku || null,
          link: record.link || null,
          activeFlag: parseBoolean(record.activeFlag ?? true),
          minimumOrderQuantity: parseInt(record.minimumOrderQuantity, 1),
          partCategoryID: parseInt(record.partCategoryID, 1),
          serialNumberRequired: parseBoolean(record.serialNumberRequired),
          lotNumberRequired: parseBoolean(record.lotNumberRequired),
          defaultUnitOfMeasureID: parseInt(record.defaultUnitOfMeasureID, 1),
          manufacturer: record.manufacturer || null,
          manufacturerPN: record.manufacturerPN || null,
        };

        // Vendor parts require manufacturer info
        if (!partData.internalPart && (!partData.manufacturer || !partData.manufacturerPN)) {
          partData.manufacturer = partData.manufacturer || partData.vendor;
          partData.manufacturerPN = partData.manufacturerPN || partData.name;
        }

        if (dryRun) {
          console.log(`  CREATE: ${partName}`);
          console.log(`          ${partData.description}`);
          part = { id: `NEW-${partName}`, ...partData };
        } else {
          part = await Part.create(partData, { transaction });
          console.log(`  CREATE: ${partName} (ID: ${part.id})`);
        }
        results.partsCreated.push(part);
      }

      // Prepare order item
      const qty = parseInt(record.qty, 1);
      const price = parsePrice(record.price);

      results.orderItems.push({
        partId: part.id,
        partName: partName,
        quantity: qty,
        price: price,
        lineTotal: qty * price,
      });
    }

    // Create order
    const orderDescription = `${vendor} Order - ${filename}`;
    console.log(`\nCreating Order: "${orderDescription}"`);

    let order;
    if (dryRun) {
      order = { id: 'NEW-ORDER', description: orderDescription };
    } else {
      order = await Order.create({
        description: orderDescription,
        vendor: vendor,
        orderStatusID: 1, // Pending
        activeFlag: true,
      }, { transaction });
    }

    console.log(`  Order ID: ${order.id}`);

    // Create order items
    console.log(`\nCreating ${results.orderItems.length} Order Items:`);
    let lineNumber = 1;
    let orderTotal = 0;

    for (const item of results.orderItems) {
      const lineTotal = item.quantity * item.price;
      orderTotal += lineTotal;

      if (dryRun) {
        console.log(`  ${lineNumber}. ${item.partName}: ${item.quantity} x $${item.price.toFixed(5)} = $${lineTotal.toFixed(2)}`);
      } else {
        await OrderItem.create({
          orderID: order.id,
          partID: item.partId,
          orderLineTypeID: 1, // Part
          lineNumber: lineNumber,
          quantity: item.quantity,
          receivedQuantity: 0,
          price: item.price,
          activeFlag: true,
        }, { transaction });
        console.log(`  ${lineNumber}. ${item.partName}: ${item.quantity} x $${item.price.toFixed(5)} = $${lineTotal.toFixed(2)}`);
      }
      lineNumber++;
    }

    // Commit transaction
    if (!dryRun && transaction) {
      await transaction.commit();
    }

    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log('SUMMARY');
    console.log('='.repeat(50));
    console.log(`Parts Created:  ${results.partsCreated.length}`);
    console.log(`Parts Existing: ${results.partsExisting.length}`);
    console.log(`Parts Skipped:  ${results.partsSkipped.length}`);
    console.log(`Order Items:    ${results.orderItems.length}`);
    console.log(`Order Total:    $${orderTotal.toFixed(2)}`);

    if (dryRun) {
      console.log('\n*** DRY RUN COMPLETE - No changes were made ***');
    } else {
      console.log(`\nOrder created successfully! Order ID: ${order.id}`);
    }

    return { order, results };

  } catch (error) {
    // Rollback on error
    if (!dryRun && transaction) {
      await transaction.rollback();
    }
    throw error;
  }
}

// Run the import
importOrderFromCSV(resolvedPath)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nError during import:', error.message);
    if (error.errors) {
      error.errors.forEach(e => console.error(`  - ${e.message}`));
    }
    process.exit(1);
  });
