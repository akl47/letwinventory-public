const db = require('../../../models');
const Net = require('net');
const createError = require('http-errors');

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
    const { labelSize = '3x1' } = req.body;
    if (labelSize == '3x1') {
      printerIP = "10.50.10.91"
    } else if (labelSize == '1.5x1') {
      printerIP = "10.50.10.92"
    } else {
      next(createError(400, 'Invalid label size specified'));
    }
    const barcode = await findBarcodeWithCategory(barcodeID);
    if (!barcode) {
      return next(createError(404, 'Barcode not found'));
    }

    const zpl = await generateZPL(barcode, labelSize);
    console.log(labelSize)
    await sendToPrinter(zpl, printerIP);
    res.json({ message: "Label printed successfully" });
  } catch (error) {
    next(createError(500, `Error printing barcode: ${error.message}`));
  }
};

exports.displayBarcode = async (req, res, next) => {
  try {
    const barcodeID = req.params.id;
    const labelSize = req.query.labelSize || '3x1';

    const barcode = await findBarcodeWithCategory(barcodeID);
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
    const barcode = await findBarcodeWithCategory(req.params.id);

    if (!barcode) {
      return next(createError(404, 'Barcode not found'));
    }

    const tag = await buildTag(barcode);
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
      WHERE b."activeFlag" = true

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
    const barcode = await db.Barcode.findOne({
      where: { barcode: barcodeString, activeFlag: true },
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

    console.log('Move barcode request:', { barcodeID, newLocationID, params: req.params, body: req.body });

    if (isNaN(barcodeID) || !newLocationID) {
      return next(createError(400, 'Invalid barcode ID or location ID'));
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

async function buildTag(barcode) {
  const typeName = barcode.BarcodeCategory.name;

  const tagData = await db[typeName].findOne({
    where: { barcodeID: barcode.id, activeFlag: true }
  });

  if (!tagData) {
    throw new Error(`${typeName} not found for barcode`);
  }

  const tagDataJson = tagData.toJSON();

  return {
    id: tagDataJson.id,
    barcodeID: barcode.id,
    barcode: barcode.barcode,
    type: typeName,
    barcodeCategoryID: barcode.BarcodeCategory.id,
    parentBarcodeID: barcode.parentBarcodeID,
    name: tagDataJson.name,
    description: tagDataJson.description
  };
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

// ============================================
// Helper Functions - Printer
// ============================================

function sendToPrinter(zpl, printerIP = "10.10.10.37") {
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
  const zplDetails = await getZPLDetails(barcode.id, prefix, labelSize);

  return zplHeader + zplDetails;
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
        where: { barcodeID, activeFlag: true }
      });
      if (!location) throw new Error('Location not found');
      const data = location.toJSON();
      name = data.name;
      description = data.description;
      break;
    }
    case "BOX": {
      const box = await db.Box.findOne({
        where: { barcodeID, activeFlag: true }
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
        where: { barcodeID, activeFlag: true }
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
        where: { barcodeID, activeFlag: true },
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
    ^FO10,10^GFA,128,128,4,,::::::001E78,007246,01F2478,0FFBDFF,1FCE7E6827C67E6467CE7E6247FE3FE243FE7FE243FC1FC240F81F82201FFC022026240418DC3F18I042,I06E,I0C1,I081,::I0C3,I0C1,3FDCBFFC,:^FS

    ^FO50,20^A0N,20,20^FDLETWINVENTORY^FS
    ^FO493,10
    ^BQN,2,5
    ^FDMA,${qrCodeData}^FS
    ^FO500,135^A0N,17,17^FD${qrCodeData}^FS`;
}






/**
 * Generate ZPL details section with name and description
 * @param {string} name - Item name
 * @param {string} description - Item description
 * @param {string} labelSize - Label size: '3x1' or '1.5x1'
 * @returns {string} ZPL details section
 */
function generateZPLDetailsSection(name, description, labelSize = '3x1', qty = null, uom = null) {
  console.log('Generating ZPL Details Section:', { name, description, labelSize, qty, uom });
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

  font_size = Math.floor(-3.75 * name.length + 96)
  desc_height = Math.floor(-0.833 * font_size + 134.978)
  // Default 3x1 label layout
  label_text = `
          ^FO20,${desc_height}^A0N,${font_size},${font_size}^FD${name}^FS
          ^CF0,23,23
          ^FO20,142
          ^FB465,2,,,
          ^FX 62 char limit
          ^FD${description}
          ^FS`
  if (qty !== null && uom !== null) {
    label_text += `
          ^FO500,175^A0N,20,20^FDQTY: ${qty} ${uom}^FS`
  }
  label_text += `^XZ`
  return label_text;
}
