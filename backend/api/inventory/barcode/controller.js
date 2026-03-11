const db = require('../../../models');
const Net = require('net');
const createError = require('http-errors');
const printAgentService = require('../../../services/printAgentService');

// ============================================
// Controller Methods
// ============================================

exports.getQueuedUpdatedByID = async (req, res, next) => {
  try {
    const queuedUpdate = await db.QueuedUpdate.findOne({
      where: { id: req.params.id }
    });
    res.json(queuedUpdate);
  } catch (error) {
    next(createError(500, `Error getting queued update: ${error.message}`));
  }
};

exports.printBarcodeByID = async (req, res, next) => {
  try {
    const barcodeID = req.params.id;
    const { labelSize, printerIP: customPrinterIP } = req.body;

    // Determine printer IP based on label size or custom IP
    let printerIP;
    if (customPrinterIP) {
      printerIP = customPrinterIP;
    } else if (labelSize === '3x1') {
      printerIP = "10.50.20.91";
    } else if (labelSize === '1.5x1') {
      printerIP = "10.50.20.92";
    } else {
      return next(createError(400, 'Label size must be specified (3x1 or 1.5x1)'));
    }

    const barcode = await findBarcodeForLabel(barcodeID);
    if (!barcode) {
      return next(createError(404, 'Barcode not found'));
    }

    const zpl = await generateZPL(barcode, labelSize);

    // Check if print agent is connected
    if (printAgentService.hasConnectedAgent()) {
      // Send via print agent (for remote printing)
      console.log(`Sending print job to print agent for printer ${printerIP}`);
      await printAgentService.sendPrintJob(zpl, printerIP);
      res.json({ message: "Label printed successfully via print agent" });
    } else {
      // Fall back to direct TCP (only works if server is on same network)
      console.log(`No connected print agent, sending directly via TCP ${printerIP}`);
      await sendToPrinter(zpl, printerIP);
      res.json({ message: "Label printed successfully" });
    }
  } catch (error) {
    next(createError(500, `Error printing barcode: ${error.message}`));
  }
};

exports.displayBarcode = async (req, res, next) => {
  try {
    const barcodeID = req.params.id;
    const labelSize = req.query.labelSize || '3x1';

    const barcode = await findBarcodeForLabel(barcodeID);
    if (!barcode) {
      return next(createError(404, 'Barcode not found'));
    }

    const zpl = await generateZPL(barcode, labelSize);
    res.send(zpl);
  } catch (error) {
    next(createError(500, `Error displaying barcode: ${error.message}`));
  }
};

exports.getTagByID = async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const barcode = includeInactive
      ? await findBarcodeForLabel(req.params.id)
      : await findBarcodeWithCategory(req.params.id);

    if (!barcode) {
      return next(createError(404, 'Barcode not found'));
    }

    const tag = await buildTag(barcode, { includeInactive });
    res.json(tag);
  } catch (error) {
    next(createError(500, `Error getting tag: ${error.message}`));
  }
};

exports.getTagChainByID = async (req, res, next) => {
  try {
    const tagChain = await buildTagChain(req.params.id);
    res.json(tagChain);
  } catch (error) {
    next(createError(500, `Error getting tag chain: ${error.message}`));
  }
};

exports.getAllTags = async (req, res, next) => {
  try {
    const [results] = await db.sequelize.query(`
      SELECT b.*, l.name, l.description, l.id as item_id, 'Location' as type, NULL::INTEGER as quantity
      FROM "Barcodes" as b
      JOIN "Locations" as l ON l."barcodeID" = b.id

      UNION ALL

      SELECT b.*, l.name, l.description, l.id as item_id, 'Box' as type, NULL::INTEGER as quantity
      FROM "Barcodes" as b
      JOIN "Boxes" as l ON l."barcodeID" = b.id
      WHERE b."activeFlag" = true

      UNION ALL

      SELECT b.*, p.name, p.description, p.id as item_id, 'Trace' as type, t.quantity
      FROM "Barcodes" as b
      JOIN "Traces" as t ON t."barcodeID" = b.id
      JOIN "Parts" as p ON t."partID" = p.id
      WHERE b."activeFlag" = true AND t."activeFlag" = true

      UNION ALL

      SELECT b.*, e.name, e.description, e.id as item_id, 'Equipment' as type, NULL::INTEGER as quantity
      FROM "Barcodes" as b
      JOIN "Equipment" as e ON e."barcodeID" = b.id
      WHERE b."activeFlag" = true AND e."activeFlag" = true
    `);
    res.json(results);
  } catch (error) {
    next(createError(500, `Error getting tags: ${error.message}`));
  }
};

exports.getAllBarcodes = async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const whereClause = includeInactive ? {} : { activeFlag: true };
    const barcodes = await db.Barcode.findAll({
      where: whereClause,
      include: { model: db.BarcodeCategory }
    });
    res.json(barcodes);
  } catch (error) {
    next(createError(500, `Error getting barcodes: ${error.message}`));
  }
};

exports.getLocationBarcodes = async (req, res, next) => {
  try {
    // Get all LOC barcodes with Location details
    const locations = await db.Location.findAll({
      where: { activeFlag: true },
      include: [{
        model: db.Barcode,
        where: { activeFlag: true },
        attributes: ['id', 'barcode']
      }]
    });

    // Get all BOX barcodes with Box details
    const boxes = await db.Box.findAll({
      where: { activeFlag: true },
      include: [{
        model: db.Barcode,
        where: { activeFlag: true },
        attributes: ['id', 'barcode']
      }]
    });

    // Combine and format the results
    const result = [
      ...locations.map(loc => ({
        id: loc.Barcode.id,
        barcode: loc.Barcode.barcode,
        type: 'Location',
        name: loc.name,
        description: loc.description
      })),
      ...boxes.map(box => ({
        id: box.Barcode.id,
        barcode: box.Barcode.barcode,
        type: 'Box',
        name: box.name,
        description: box.description
      }))
    ];

    res.json(result);
  } catch (error) {
    next(createError(500, `Error getting location barcodes: ${error.message}`));
  }
};

exports.getBarcodeByString = async (req, res, next) => {
  try {
    const barcodeString = req.params.barcode;
    const { Op } = require('sequelize');
    const barcode = await db.Barcode.findOne({
      where: {
        [Op.and]: [
          db.sequelize.where(
            db.sequelize.fn('UPPER', db.sequelize.col('barcode')),
            barcodeString.toUpperCase()
          ),
          // { activeFlag: true }
        ]
      },
      include: { model: db.BarcodeCategory }
    });

    if (!barcode) {
      return next(createError(404, 'Barcode not found'));
    }

    res.json(barcode);
  } catch (error) {
    next(createError(500, `Error finding barcode: ${error.message}`));
  }
};

exports.getBarcodeCategories = async (req, res, next) => {
  try {
    const categories = await db.BarcodeCategory.findAll({
      where: { activeFlag: true }
    });
    res.json(categories);
  } catch (error) {
    next(createError(500, `Error getting barcode categories: ${error.message}`));
  }
};

exports.moveBarcodeByID = async (req, res, next) => {
  try {
    const barcodeID = parseInt(req.params.id);
    const { newLocationID } = req.body;

    if (isNaN(barcodeID) || !newLocationID) {
      return next(createError(400, 'Invalid barcode ID or location ID'));
    }

    if (barcodeID === newLocationID) {
      return next(createError(400, 'A barcode cannot be moved into itself'));
    }

    // Get the current parent barcode ID before updating
    const currentBarcode = await db.Barcode.findOne({
      where: { id: barcodeID, activeFlag: true },
      attributes: ['parentBarcodeID']
    });

    if (!currentBarcode) {
      return next(createError(404, 'Barcode not found'));
    }

    const oldParentBarcodeID = currentBarcode.parentBarcodeID;

    // Use raw update to avoid triggering hooks
    const result = await db.sequelize.query(
      'UPDATE "Barcodes" SET "parentBarcodeID" = :newLocationID, "updatedAt" = NOW() WHERE id = :barcodeID AND "activeFlag" = true RETURNING *',
      {
        replacements: { barcodeID, newLocationID },
        type: db.sequelize.QueryTypes.UPDATE
      }
    );

    if (!result || result.length === 0 || result[0].length === 0) {
      return next(createError(404, 'Barcode not found'));
    }

    // Record barcode move in history
    try {
      const movedAction = await db.BarcodeHistoryActionType.findOne({
        where: { code: 'MOVED', activeFlag: true }
      });

      if (movedAction) {
        await db.BarcodeHistory.create({
          barcodeID: barcodeID,
          userID: req.user ? req.user.id : null,
          actionID: movedAction.id,
          fromID: oldParentBarcodeID,
          toID: newLocationID
        });
      }
    } catch (historyError) {
      console.error('Error recording barcode move history:', historyError);
    }

    res.json(result[0][0]);
  } catch (error) {
    console.error('Move barcode error:', error);
    next(createError(500, `Error moving barcode: ${error.message}`));
  }
};

exports.deleteBarcodeByID = async (req, res, next) => {
  const barcodeId = parseInt(req.params.id);

  try {
    const barcode = await db.Barcode.findOne({
      where: { id: barcodeId }
    });

    if (!barcode) {
      return next(createError(404, 'Barcode not found'));
    }

    barcode.activeFlag = false;
    await barcode.save({ validate: false });

    // Record deletion in history
    try {
      const deletedAction = await db.BarcodeHistoryActionType.findOne({
        where: { code: 'DELETED', activeFlag: true }
      });

      if (deletedAction) {
        await db.BarcodeHistory.create({
          barcodeID: barcodeId,
          userID: req.user ? req.user.id : null,
          actionID: deletedAction.id,
          fromID: barcodeId,
          toID: null
        });
      }
    } catch (historyError) {
      console.error('Error recording barcode deletion history:', historyError);
    }

    res.json({ message: 'Barcode marked as inactive', id: barcodeId });
  } catch (error) {
    next(createError(500, `Error deleting barcode: ${error.message}`));
  }
};

// ============================================
// Helper Functions - Database Queries
// ============================================

async function findBarcodeWithCategory(barcodeID) {
  const barcode = await db.Barcode.findOne({
    where: { id: barcodeID, activeFlag: true },
    include: { model: db.BarcodeCategory }
  });
  return barcode ? barcode.toJSON() : null;
}

/**
 * Find barcode with category, including inactive barcodes (for label generation)
 */
async function findBarcodeForLabel(barcodeID) {
  const barcode = await db.Barcode.findOne({
    where: { id: barcodeID },
    include: { model: db.BarcodeCategory }
  });
  return barcode ? barcode.toJSON() : null;
}

async function buildTag(barcode, opts = {}) {
  const typeName = barcode.BarcodeCategory.name;

  const includeOpts = typeName === 'Trace'
    ? [{ model: db.Part }]
    : [];

  const where = { barcodeID: barcode.id };
  if (!opts.includeInactive) where.activeFlag = true;

  const tagData = await db[typeName].findOne({
    where,
    include: includeOpts,
  });

  if (!tagData) {
    throw new Error(`${typeName} not found for barcode`);
  }

  const tagDataJson = tagData.toJSON();

  const tag = {
    id: tagDataJson.id,
    barcodeID: barcode.id,
    barcode: barcode.barcode,
    type: typeName,
    barcodeCategoryID: barcode.BarcodeCategory.id,
    parentBarcodeID: barcode.parentBarcodeID,
    activeFlag: barcode.activeFlag,
    name: tagDataJson.name,
    description: tagDataJson.description,
  };

  if (typeName === 'Trace') {
    tag.name = tagDataJson.Part?.name;
    tag.description = tagDataJson.Part?.description;
    tag.quantity = tagDataJson.quantity;
    tag.partID = tagDataJson.partID;
    tag.manufacturer = tagDataJson.Part?.manufacturer;
    tag.manufacturerPN = tagDataJson.Part?.manufacturerPN;
  }

  return tag;
}

async function buildTagChain(startingBarcodeID) {
  const tagChain = [];
  let currentBarcodeID = startingBarcodeID;

  while (currentBarcodeID) {
    const barcode = await findBarcodeWithCategory(currentBarcodeID);

    if (!barcode) {
      break;
    }

    const tag = await buildTag(barcode);
    tagChain.push(tag);

    currentBarcodeID = tag.parentBarcodeID === 0 ? null : tag.parentBarcodeID;
  }

  return tagChain;
}

// Exported helpers for use by other controllers
exports.buildTagChain = buildTagChain;
exports.buildTag = buildTag;
exports.findBarcodeWithCategory = findBarcodeWithCategory;

// ============================================
// Helper Functions - Printer
// ============================================

function sendToPrinter(zpl, printerIP = "10.50.20.91") {
  return new Promise((resolve, reject) => {
    const client = new Net.Socket();

    client.on('error', (error) => {
      reject(new Error(`Printer connection error: ${error.message}`));
    });

    client.connect({ port: 9100, host: printerIP }, () => {
      client.write(zpl);
      client.destroy();
      resolve();
    });
  });
}

// ============================================
// Helper Functions - ZPL Generation
// ============================================

/**
 * Generate complete ZPL for a barcode label
 * @param {Object} barcode - Barcode object with BarcodeCategory included
 * @param {string} labelSize - Label size: '3x1' or '1.5x1'
 * @returns {string} Complete ZPL code
 */
async function generateZPL(barcode, labelSize = '3x1') {
  const prefix = barcode.BarcodeCategory.prefix;
  const qrCodeData = barcode.barcode;

  const zplHeader = generateZPLHeader(qrCodeData, labelSize);
  const zplWatermark = generateWatermark(barcode, labelSize);
  const zplDetails = await getZPLDetails(barcode.id, prefix, labelSize);

  return zplHeader + zplWatermark + zplDetails;
}

/**
 * Generate watermark ZPL for DEV and/or INACTIVE labels
 * Placed before detail content so it renders behind
 */
// ZPL watermark snippets — keyed by labelSize → condition
const WATERMARK_ZPL = {
  '1.5x1': {
    dev: '^FO0,0^GFA,7917,7917,39,,::::::::::::::::::::::::::::::::::::::::::::::::::N02IA8J02KA2AAI0155,N0K54I01K5154J0AA,N02KAI02KA354I0154,N0L54001K50ABI0154,N02KAC002KA154I02AA,N0M5001K50ABI0154,N02LA802KA054800554,N05501I500154J0AA8002A8,N02A802AAC02AAJ02A80055,N055I0AA80154J055I055,N02A80055402AAJ02AC00AA8,N055I05540154J02A40055,N02A8002AA02AAJ01580155,N055I02AA02AAJ02A600AA,N02A8001550154IA00A80154,N055I02AA02AB55401560154,N02A8003550154IA00AA02AA,N055J0AA02AB55400AA0154,N02A8001550154IA00558554,N055J0AA02AB55400AA82A8,N02A8002AA0154IA0055055,N055I015502KA002A8AA8,N02A8002AA0154K055455,N055I02AA02AAK0150AA,N02A8002A80154K02AC55,N055I055602AAK015155,N02A800AA80154K0156AA,N05500155402AAL0JA,N02A802AA80154K01I54,N05501I5002AAL0I54,N02LA001K5I0IA8,N0M5002KAI0I54,N02LA001K5I0I5,N0L5I02KAI02AA8,N02KAI01K5I0I5,N0K54I02KAI0155,N02JAJ01K5I02AA,,::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::^FS',
    inactive: '^FO0,0^GFA,7714,7714,38,,:::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::gV0155,O0JA81554I0AAJ0IAK01J50MA9J52A8I02AA1K5,N01J502AA8I055J0I5K02KAM50JA554I01540KA8,O0JA81554I0AAJ0IAK0SA9J52AAI02AA1K5,N01J502IAI055J0IA8J0KA8M50JA154I02A80KA8,O0JA81I5I0AAI01I5J02KA8MA9J52AAI05541K5,O0J502IA80055J0IA8I02KA8M50I540AAI02A80KA8,P0AA801I5I0AAI02IA8I0LA0MA82AA8155I0AA81K5,P0AA802IA80055I01I54I0I5005800154J0AA00AAI05500AA,P055001I5400AAI0J54001554002I02AAI015500AA800AA8155,P0AA802JA0055I02IA8I0AA8L0154J0AA0055I0AA00AA,P055001I5400AAI055156002AAM02AAI015500AA801550155,P0AA802IAB0055I0550A800155M0154J0AA002AC00AA00AA,P05500154AA00AAI0AA956002AAM02AAI01550055002AA0155,P0AA802A9558055I0550A900554M0154J0AA002AC015400AA,P055001545540AA001550AA80554M02AAI0155002A402AA01K5,P0AA802A8548055I0AA05580554M0154J0AA00158015400KA,P055001542AA0AA001550AA002A8M02AAI0155002A6055401K5,P0AA802A82AA0550015402B40554M0154J0AAI0A802A800KA,P055001541550AA002AA054802A8M02AAI015500156055001K5,P0AA802A8155055002AA02B40554M0154J0AAI0AA0AA800KA,P055001541550AA002A802A802A8M02AAI0155I055055001K5,P0AA802A80AAC5500L560554M0154J0AAI0AA8AAI0AA,P0550015402A8AA00L5202AAM02AAI0155I05515500155,P0AA802A80554AA00M50554M0154J0AAI0550AAI0AA,P0550015401J500MA02AAM02AAI0155I02A95400155,P0AA802A802JA00M50155M0154J0AAI0554AAI0AA,P0550015400JA01M502AAM02AAI0155I01I5400155,P0AA802A800IAB00MA8155M0154J0AAI02IA8I0AA,P0550015400I5402MA81554L02AAI0155I01I5400155,P0AA802A800J50155I05500IA002800154J0AAI01I54I0AA,P0AA80154002IA02AAI05540AA9I5I02AAI02AA8I0IA8001K5,O0J502A8002IA02AAI02AA0L5800154I0JA001I5J0KA8,N01J50154001I50554I05540L5I02AAI0IA9I0IA8001K5,O0JA82A8001I50554I015601K5I0154001J5I0I5I01K5,N01J50154I0I50554I02A801K5I02AAI0JAI0I5J0KA8,O0JA82A8I0IA0AA8I015700K5I02AA001J5I0554I01K5,N01J50154I02AA055J0154002JAI0154I0JAI02AAJ0KA8,gV0155,,:::::::::::::::::::::::::::::::::::::::::::::::::::::::^FS',
  },
  '3x1': {
    dev: '^FO0,0^GFA,33900,33900,113,,::::::::::::::::::::::::::::::::::::::::::::::::::::::g01O54Q0RA81J54O0K5,gG0OA94P0R500JA8O0J54,g01Q5P0RA80KAO0KA,gG0RAO0R500J54O0J54,g01R58N0RA80KAN01J54,gG0SAN0R5002JAO0JA8,g01S58M0RA80K5N01J54,gG0SA4M0R5002JAN01J5,g01T5M0RA802JA8M02JA8,gG0TA8L0R5001J5N01J58,g01T54L0RA802JA8M0K5,gG0TA8L0R5I0JA8M02JA,g01T56L0RA801J54M0J54,gG0UA8K0R5I0JA8M0J54,g01U54K0RA800J54M0KA,gG0JA8I0MA8K0J54P0KAM0J54,g01J54I01L54K0KAP0JA8M0JA8,gG0JA8J01K54K0J54P02JAL01J54,g01J54J01KABK0KAP0K5M0JA8,gG0JA8K02KA8J0J54P06JAL01J5,g01J54K02KAK0KAP01J5L02JA8,gG0JA8L0KA8J0J54P02JA8K01J5,g01J54L0KA8J0KAP02JAL02JA,gG0JA8L02JA8J0J54P01J58K02JA,g01J5M0K56J0KAQ0JA4K0J54,gG0JACL01J54J0J54Q0JA8K02JA,g01J5M02KAJ0KAQ0J54K0KA,gG0JA8M0KAJ0J54Q0KAK0J54,g01J54L01J54J0KAQ0J54K0JA8,gG0JA8M0K5J0J54Q02JAJ01J54,g01J54M0KAJ0KAQ0K5K0JA8,gG0JA8M0K5J0J54Q01I54J01J5,g01J54M0KAJ0RAJ02IABJ02JA8,gG0JA8M0K5J0Q54J01I54J01J5,g01J5N0K5J0RAJ01J58I02JA,gG0JACM02JA8I0Q54K0JAJ02JA,g01J5N0K5J0RAJ01J58I0J54,gG0JA8M02JA8I0Q54K0J5J02JA,g01J54M0K5J0RAK0JACI0KA,gG0JA8M02JA8I0Q54K0J5J0J54,g01J54M0K5J0RAK0J54I0JA8,gG0JA8M02JA8I0Q54K02JAI0J54,g01J54M0K5J0RAK0J54001J5,gG0JA8M02JA8I0Q54K02JAI0JA8,g01J5N0K5J0RAK01J5001J5,gG0JA8M0K5J0Q54K02JA002JA,g01J54M02JAJ0RAL0JA801J5,gG0JA8M0K5J0Q54K01J5002JA,g01J54M0J54J0KAS0JA80J54,gG0JA8M0JABJ0J54S0JA802JA,g01J54M0J54J0KAS0J540J54,gG0JA8M0JABJ0J54S0JA80J54,g01J5N0J54J0KAS02IA80JA8,gG0JACL01J54J0J54S0J540J54,g01J5N0KAJ0KAS02JA0JA8,gG0JA8L02KAJ0J54S02JA1J5,g01J54L01J54J0KAS01I540JA8,gG0JA8L02JA8J0J54S02JA1J5,g01J54L0K54J0KAT0JA0JA,gG0JA8L0K5K0J54S01J52JA,g01J54K01K5K0KAT0JA1I54,gG0JA8K01K5K0J54T0OA,g01J5L0L5K0KAT0J51I54,gG0JA8K0L5K0J54T0NA8,g01J54J01K54K0KAT02MA8,gG0JA8J0L54K0J54T0N5,g01J54I02LA8K0KAT02MA8,gG0JA8002A9K5L0J54T02MA8,g01U5L0RA8L01M5,gG0UAL0R5M02MA,g01T54L0RA8L01M5,gG0TA8L0R5N0MA,g01T5M0RA8M0LA8,gG0TAM0R5N0MA,g01S54M0RA8M0L54,gG0SACM0R5N0LA8,g01S5N0RA8M02KA8,gG0SAN0R5N0L5,g01R5O0RA8M0L5,gG0RAO0R5N02KA8,g01Q5P0RA8M01K5,gG0PA8P0R5N03J52,g01O5R0RA8N0JAD,gG0JA4A8T0M524925N0155492,,::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::^FS',
    inactive: '^FO0,0^GFA,33900,33900,113,,:::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::jM02A8,iJ02KA8T02AD56A8,gI0O54I0L5N02JAO02KA8S01552JA8I0VA0PA2JA8N01J5400RA,gI02OAI02KA8M01I54O0L5T0N56800U540O541J5P0JA800R5,gI0O54I0L54M02JAO02KA8R02NA9500VA0PA2JA8N03J5I0RA,gI02OAI02KA8M01I54O0LA8R0QA80U540O540JA8N01J5I0R5,gI0O54I0L54M02JAO0L56Q02Q540VA0PA1J54N02JA800RA,gI02OAI02LAM01I54O0MAQ02QA80U540O540JA8N01J5I0R5,gI0O54I0M5M02JAN01L54Q0RA80VA0PA0KAN0K5I0RA,gI02OAI02LAM01I54O0MAP01R540U540O540J54N02JAI0R5,gI0O54I0M5M02JAN01M5P0S500VA0PA0KAN0J54I0RA,gI02OAI02LACL01I54N01M5P0S500VA0O5402JAN0KAI0RA,gI0O54I0M5M02JAN02MAO01S500U540PA0K5N0J54I0R5,gJ0NA8I02LACL01I54N01M58O0SA00VA01N5002JAN0JA8I0RA,gJ0M54J0M54L02JAN0N5O02SA00VA002LA8001J5N0JA8I0R5,gK0LA8J02LABL01I54N02MA8N02SA00U54001L5I02JA8L01J54I0RA,gK01J54K0M54L02JAN0NA8N0MA800JA00VAI02JA8I01J5N0JA8I0R5,gK01J5L02LABL01I54N0N54N0L54J0AA8M01J5O02JA8I01J5M02JA8I0JA8,gL0JA8K0N54K02JAN0JA9I54M01L5K0154M02JA8N01J5K0JA8L01J5J0JA8,gK01J5L02MA8K01I54N0JA2JAN0KA8L02CM01J5O02JA8J0JACL02JAJ0J54,gL0JA8K0N54K02JAM01J51I54M02KA8L01N02JA8N01J5K0JA4L02JAJ0JA8,gK01J5L02NAK01I54N0JA3J5M01K5V01J5O02JA8J0J54L0K5J0J54,gL0JA8K0O5K02JAM02JA0JAM0K54V02JA8N01J5K0KAL02JAJ0JA8,gK01J5L02NA8J01I54M01J51J58L02JA8V01J5O02JA8J0J54L0J54J0J54,gL0JA8K0J52JA8J02JAM02JA1J5M0KA8V02JA8N01J5K02JAL0KAJ0JA8,gK01J5L02IAK54J01I54M02JA0J5M0K5W01J5O02JA8J06JAL0J54J0J54,gL0JA8K0J51J54J02JAM0J540JA8L0KAW02JA8N01J5K01J5K01JA8J0JA8,gK01J5L02IA0JA8J01I54M02JA0J54L0KAW01J5O02JA8J02JA8J01J54J0J54,gL0JA8K0J59J56J02JAM0JA80JA8K01J54W02JA8N01J5K01J5L0JA8J0JA8,gK01J5L02IA8J52J01I54M0J5402JAL0KAW01J5O02JA8K0JA8J01J5K0JA8,gL0JA8K0J50KA8I02JAM0JA80J54K01J56W02JA8N01J5K01J5K02JA8J0J54,gK01J5L02IA82JA8I01I54M0JA802JAK01J54W01J5O02JA8K0J54J01J5K0JA8,gL0JA8K0J50K54I02JAL01J500K5K02JA8W02JA8N01J5L0JA8J02JAK0J54,gK01J5L02IA81J5J01I54M0JA802JAK01J54W01J5O02JA8K0J54J0K5K0JA8,gL0JA8K0J501J5AI02JAL02JA801J5K02JA8W02JA8N01J5L0J54J02JAK0Q54,gK01J5L02IA80JA4I01I54L02JA002JA8J01J5X01J5O02JA8K02JAJ0J54K0QA8,gL0JA8K0J500K5I02JAL02JA001J5K02JA8W02JA8N01J5L0J54J0KAK0Q54,gK01J5L02IA80KA8001I54L0K5I0JA8J02JAX01J5O02JA8K01J5J0J54K0QA8,gL0JA8K0J5002JA8002JAL02JAI0JA4J0K58W02JA8N01J5L02JAJ0JA8K0Q54,gK01J5L02IA80K5I01I54L0KAI0JA8J02JAX01J5O02JA8K01J5I01J5L0QA8,gL0JA8K0J5002JAC002JAL0J54I0J56J0K58W02JA8N01J5L01J5J0JA8K0Q54,gK01J5L02IA800JA8001I54L0KAI0KAJ02JAX01J5O02JA8L0JA8001J5L0QA8,gL0JA8K0J5001J56002JAL0JA8I02IA8J0K58W02JA8N01J5L01J5I01J5L0Q54,gK01J5L02IA800J52001I54K01J54I0J56J02JAX01J5O02JA8L0JA8002JAL0QA8,gL0JA8K0J5I0JAD803I54L0JACI02JAJ0K5X02JA8N01J5M0J54002JAL0Q54,gK01J5L02IA8002JAI0JAK02JA8I02JAJ02JA8W01J5O02JA8L0JA800K5L0QA8,gL0JA8K0J5I0K5801I54K01J5J01J58I0K5X02JA8N01J5M02JA002JAL0Q54,gK01J5L02IA8002JA400JAK02JA8I02JAJ0K5X01J5O02JA8L0J5400J54L0QA8,gL0JA8K0J5J0KA01I54K02JAJ01J58I02JA8W02JA8N01J5M02JA002IA8L0Q54,gK01J5L02IA8001K501I54K0K5K0JA4I0K5X01J5O02JA8L02JA00JA8L0QA8,gL0JA8K0J5J0K500JAK02JAO54I02JA8W02JA8N01J5M01J500J54L0J54,gK01J5L02IA8I0KA01I54K0TA8I02JA8W01J5O02JA8L02JA00JA8L0JA8,gL0JA8K0J5J02JA80JAK0T54I01J5X02JA8N01J5M01J501J5M0J54,gK01J5L02IA8I02JA81I54K0UAI02JA8W01J5O02JA8M0JA80JA8L0JA8,gL0JA8K0J5J01J540JAK0UAI01J54W02JA8N01J5M01J501J5M0J54,gK01J5L02IA8I01J541I54J01T54I02JA8W01J5O02JA8M0J500JAM0JA8,gL0JA8K0J5K0JAB1I54J01U5I01J54W02JA8N01J5N0JA82JAM0J54,gK01J5L02IA8J0KA0JAJ02UA8001J54W01J5O02JA8M0J542JAM0JA8,gL0JA8K0J5K0K51I54J01U5J0KAW02JA8N01J5N0J501I54M0J54,gK01J5L02IA8J0K50JAJ0V58001J54W01J5O02JA8M02IACJ54M0JA8,gL0JA8K0J5K01N54J02UA4I0KAW02JA8N01J5N0J522IA8M0J54,gK01J5L02IA8J02OAJ0V54001K58V01J5O02JA8M02IACJ54M0JA8,gL0JA8K0J5L0OAJ0V54I0KA8V02JA8N01J5N01I522IA8M0J54,gK01J5L02IA8J01N54J0VA8I0K54V01J5O02JA8M02JADI5N0JA8,gL0JA8K0J5L0N54J0V54I0KA8V02JA8N01J5O0JAJ5N0J54,gK01J5L02IA8K0OAI01V56I02JABV01J5O02JA8M01N5N0JA8,gL0JA8K0J5L02NAJ0KAM0J52I0K548M02M02JA8N01J5O0NAN0J54,gK01J5L02IA8K02MA8I01J54M0KAI01K54L014M01J5O02JA8N0NAN0JA8,gL0JA8K0J5L01M56I01J54M0K5I02KA9L0AAM02JA8N01J5O0N5N0J54,gK01J5L02IA8K01M52I02JA8M0K5I01L54J0554M01J5O02JA8N0NAN0JA8,gK02KAK0J5M0NAI01J54M02JA8I0LA9400JAM02JA8N02JA4N02MAN0R5,gK0LAK02IA8L0MA8I0K5N0K5J0S54M01J5N01K54N0M54N0RA,gJ0M5AJ0J5M0M56I02JA8M01J54I0S54M02JA8M0M5AM02LA8N0R5,gI01N5J02IA8L0M54I0K5N02JA8I02SAM01J5M029M5M02LA8N0RA,gI0O54I0J5M01L54I0K5N01J56I02SAM02JA8L096NAL01L54N0R5,gI02OAI02IA8L02MAI0KAN01J54J0RA8M01J5M069M54L02LA8N0RA,gI0O54I0J5N0MAI0KAO0KAJ0SAM02JA8L09N54M0LA8N0R5,gI02OAI02IA8L01L54001J54N01K5J02RAM01J5M06OAL01L5O0RA,gI0O54I0J5N0L54I0KAO0J54J02RAM02JA8L09N54M0LAO0R5,gI02OAI02IA8M0DK54001J54O0JABK0QA8M01J5M06OAM0L5O0RA,gI0O54I0J5N02LA002JA8O0J548J02QAM02JA8L09N54M0LAO0RA,gI02OAI02IA8M02LA001J54O0K5K01P54M01J5M06OAM0K54O0R5,gI0O54I0J5N01K5400K54O02JA8K0QAM02JA8L09N54M0K54O0RA,gI02OAI02IA8M01K54002JA8O0K54K01O5N01J5M06OAM02KAO0R5,gI0O54I0J5O0LA00K5P01J5M02MA8N02JA8L09N54M06JA8O0RA,jK02KA8,jM054,,::::::::::::::::::::::::::::::::::::::::::::::::^FS'
  },
};

function generateWatermark(barcode, labelSize) {
  const isDev = process.env.NODE_ENV !== 'production';
  const isInactive = barcode.activeFlag === false;

  if (!isDev && !isInactive) return '';

  const snippets = WATERMARK_ZPL[labelSize] || WATERMARK_ZPL['3x1'];
  let watermark = '';
  if (isDev) watermark += snippets.dev;
  if (isInactive) watermark += snippets.inactive;
  return watermark;
}

/**
 * Get ZPL details based on barcode type
 * @param {number} barcodeID - Barcode ID
 * @param {string} prefix - Barcode category prefix (LOC, BOX, AKL)
 * @param {string} labelSize - Label size: '3x1' or '1.5x1'
 * @returns {string} ZPL details section
 */
async function getZPLDetails(barcodeID, prefix, labelSize) {
  let name, description, qty, uom;

  switch (prefix) {
    case "LOC": {
      const location = await db.Location.findOne({
        where: { barcodeID }
      });
      if (!location) throw new Error('Location not found');
      const data = location.toJSON();
      name = data.name;
      description = data.description;
      break;
    }
    case "BOX": {
      const box = await db.Box.findOne({
        where: { barcodeID }
      });
      if (!box) throw new Error('Box not found');
      const data = box.toJSON();
      name = data.name;
      description = data.description;
      break;
    }
    case "AKL": {
      const trace = await db.Trace.findOne({
        include: [{
          model: db.Part,
          required: true,
          include: [{
            model: db.UnitOfMeasure,
            as: 'UnitOfMeasure',
            required: false
          }]
        }],
        where: { barcodeID }
      });
      if (!trace) throw new Error('Part not found');
      const data = trace.toJSON();
      name = data.Part.name;
      description = data.Part.description;
      qty = data.quantity;
      uom = data.Part.UnitOfMeasure?.name;
      break;
    }
    case "EQP": {
      const equipment = await db.Equipment.findOne({
        where: { barcodeID },
        include: [{ model: db.Part }]
      });
      if (!equipment) throw new Error('Equipment not found');
      const data = equipment.toJSON();
      name = data.name;
      // Use Part's manufacturer and manufacturerPN if available
      if (data.Part?.manufacturer && data.Part?.manufacturerPN) {
        description = `${data.Part.manufacturer} - ${data.Part.manufacturerPN}`;
      } else if (data.Part?.manufacturer) {
        description = data.Part.manufacturer;
      } else {
        description = data.serialNumber || data.description;
      }
      break;
    }
    default:
      throw new Error(`Unknown barcode type: ${prefix}`);
  }

  return generateZPLDetailsSection(name, description, labelSize, qty, uom);
}

/**
 * Generate ZPL header with logo, QR code, and branding
 * @param {string} qrCodeData - Data to encode in QR code
 * @param {string} labelSize - Label size: '3x1' or '1.5x1'
 * @returns {string} ZPL header section
 */
function generateZPLHeader(qrCodeData, labelSize = '3x1') {
  // Logo graphic data (shared between sizes)
  const logoGraphic = `^FO7,33^GFA,1512,1512,14,,:::::::::::::::::::::::::::::::Q0EI03,P03F801FE,P0FFC03FF,O03FBE03CFC,O0FE0E0783F,N03F80E0700FE,N0FE0C607103F8,M07FC1C607381FE,L01IF0C607387FF8,L0JFC0E0701JF,K03JFE0IF03JFE,J01LF0IF87KF8,J07LF8IF9MF,I01MFCE079MFC,I07JFE07CE03BIF83F7E,I0F8IFE03EE03JF01F0F8,001F0IFC03FE03JF00F87C,003C1IFC03FE03IFE00F83E,00781IFC03FC03IFE00FC0E,00701IFC03FC01JF01FC0F,00F01IFE07FC01JF81FC078,00E01JF0OFC7FC038,01C61FFC7OF1IFC63C,01C71FFC7IF800FFE1IFC71C,03C71FFC7IF800IF1IFC61C,03801MFI0MF801C,03800MFI07LF800C,03800MF800MF800E,03800WFI0E,038007VFI0E,038003KFCIFBKFEI0E,038003KFC0F01KFCI0C,038001KF8J0KF8001C,03CI0KF8J0KFI01C,01CI03JFK07IFEI01C,01CJ0JFK0JF8I038,00EJ01F3F8I01FCFCJ038,00FL07FCI03FEL078,007I0600F9KFCF003I0F,007800E01F0KF87807I0E,003C00603E07JF03E03003E,001EJ07C07800F03FJ07C,I0F8001FFBF800JFC001F8,I07F007EIF800IF3F007E,I01JF83FF800FFE1JFC,J07FFEI03800EI07IF,K0FF8I03800EJ0FF8,Q03800E,::Q03IFE,Q0KF,P01KF8,P01EI03C,P01CI01C,::P01F8IFC,P01FCIFC,P01CI01C,:::::P01KFC,:P01CI01C,:::001gGFC,003gGFE,00gIF8,03FJ07Q0EJ0FC,07FJ07Q0EJ07F,^FS`;

  if (labelSize === '1.5x1') {
    // 1.5"x1" label layout
    // TODO: Adjust positions when actual 1.5"x1" dimensions are finalized
    return `
          ^XA
          ^FO10,10^GFA,32,32,2,,::024,0DB,3BEC1B6,9F798E79026,2244024,::3E7E,^FS
          ^FO30,15^A0N,15,15^FDLETWINVENTORY^FS
          ^FO225,5
          ^BQN,2,3
          ^FDMA,${qrCodeData}^FS
          ^FO230,85^A0N,10,10^FD${qrCodeData}^FS`;
  }

  // Default 3x1 label layout
  return `
    ^XA
    ^FO10,10^GFA,288,288,6,,:::::::::J0181C,J07C3F,I01C661C,I0F9268F,003FC663FC,01FFE7E7FF8,07FE366FE7E,0CFE1E3FC33,18FC1C3FC31830FE3C3FC38C30FBJF3F8424FBFC1F3F8660IFC1IF0660NF02607IFCFFE02203FF007FC06200FF007F8043I0F01FI0C18219FF984080C038C19C038070FF81FF06,01F808101FC,K081,K0C3,J01FF8,J0100C,:J0180C,J0100C,:::J0300C,0PF,380CJ0301C3004J0100E,:^FS

    ^FO60,25^A0N,30,30^FDLETWINVENTORY^FS
    ^FO720,15
    ^BQN,2,8
    ^FDMA,${qrCodeData}^FS
    ^FO739,200^A0N,25,25^FD${qrCodeData}^FS`;
}







/**
 * Generate ZPL details section with name and description
 * @param {string} name - Item name
 * @param {string} description - Item description
 * @param {string} labelSize - Label size: '3x1' or '1.5x1'
 * @returns {string} ZPL details section
 */
function generateZPLDetailsSection(name, description, labelSize = '3x1', qty = null, uom = null) {
  description = description || '';
  if (labelSize === '1.5x1') {
    // 1.5"x1" label layout
    font_size = Math.floor(-1.25 * name.length + 42)
    label_text = `
            ^FO10,105^A0N,${font_size},${font_size}^FD${name}^FS
            ^CF0,13,13
            ^FO10,135
            ^FB275,3,,,
            ^FX 62 char limit
            ^FD${description}
            ^FS`
    if (qty !== null && uom !== null) {
      label_text += `
          ^FO220,175^A0N,15,15^FDQTY: ${qty} ${uom}^FS`
    }
    label_text += `^XZ`
    return label_text;
  }
  // Default 3x1 label layout
  d = name.length < 8 ? 8 : name.length
  font_size = Math.floor(800 / d)
  desc_height = Math.floor(110 + 5 * (d - 8))
  label_text = `
          ^FO30,${desc_height}^A0N,${font_size},${font_size}^FD${name}^FS
          ^CF0,34,34
          ^FO30,210
          ^FB465,2,,,
          ^FX 62 char limit
          ^FD${description}
          ^FS`
  if (qty !== null && uom !== null) {
    label_text += `
          ^FO720,258^A0N,30,30^FDQTY: ${qty} ${uom}^FS`
  }
  label_text += `^XZ`
  return label_text;
}
