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

exports.printBarcode = async (req, res, next) => {
  try {
    const { barcode, description, labelSize, printerIP } = req.body;
    const zpl = generateZPL(barcode, description);

    await sendToPrinter(zpl, printerIP);
    res.json({ message: "Done" });
  } catch (error) {
    next(createError(500, `Error printing barcode: ${error.message}`));
  }
};

exports.printBarcodeByID = async (req, res, next) => {
  try {
    const barcodeID = req.params.id;
    const { labelSize, printerIP } = req.body;

    const barcode = await findBarcodeWithCategory(barcodeID);

    if (!barcode) {
      return next(createError(404, 'Barcode not found'));
    }

    const prefix = barcode.BarcodeCategory.prefix;
    const qrCodeData = `${barcode.barcode}`;

    let zpl;
    if (labelSize === '1.5x1') {
      const zplHeader = generateZPLHeader_1_5x1(qrCodeData);
      let zplDetails;
      switch (prefix) {
        case "LOC":
          zplDetails = await getLocationZPL_1_5x1(barcode.id);
          break;
        case "BOX":
          zplDetails = await getBoxZPL_1_5x1(barcode.id);
          break;
        case "AKL":
          zplDetails = await getPartZPL_1_5x1(barcode.id);
          break;
        default:
          return next(createError(400, `Unknown barcode type: ${prefix}`));
      }
      zpl = zplHeader + zplDetails;
    } else {
      // Default 3x1 label
      const zplHeader = generateZPLHeader(qrCodeData);
      let zplDetails;
      switch (prefix) {
        case "LOC":
          zplDetails = await getLocationZPL(barcode.id);
          break;
        case "BOX":
          zplDetails = await getBoxZPL(barcode.id);
          break;
        case "AKL":
          zplDetails = await getPartZPL(barcode.id);
          break;
        default:
          return next(createError(400, `Unknown barcode type: ${prefix}`));
      }
      zpl = zplHeader + zplDetails;
    }

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

    const prefix = barcode.BarcodeCategory.prefix;
    const qrCodeData = `${barcode.barcode}`;

    let zpl;
    if (labelSize === '1.5x1') {
      const zplHeader = generateZPLHeader_1_5x1(qrCodeData);
      let zplDetails;
      switch (prefix) {
        case "LOC":
          zplDetails = await getLocationZPL_1_5x1(barcode.id);
          break;
        case "BOX":
          zplDetails = await getBoxZPL_1_5x1(barcode.id);
          break;
        case "AKL":
          zplDetails = await getPartZPL_1_5x1(barcode.id);
          break;
        default:
          return next(createError(400, `Unknown barcode type: ${prefix}`));
      }
      zpl = zplHeader + zplDetails;
    } else {
      const zplHeader = generateZPLHeader(qrCodeData);
      let zplDetails;
      switch (prefix) {
        case "LOC":
          zplDetails = await getLocationZPL(barcode.id);
          break;
        case "BOX":
          zplDetails = await getBoxZPL(barcode.id);
          break;
        case "AKL":
          zplDetails = await getPartZPL(barcode.id);
          break;
        default:
          return next(createError(400, `Unknown barcode type: ${prefix}`));
      }
      zpl = zplHeader + zplDetails;
    }

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
    const barcodes = await db.Barcode.findAll({
      where: { activeFlag: true }
    });
    res.json(barcodes);
  } catch (error) {
    next(createError(500, `Error getting barcodes: ${error.message}`));
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

    res.json(result[0][0]);
  } catch (error) {
    console.error('Move barcode error:', error);
    next(createError(500, `Error moving barcode: ${error.message}`));
  }
};

exports.deleteBarcodeByID = (req, res, next) => {
  const barcodeId = parseInt(req.params.id);

  db.Barcode.findOne({
    where: { id: barcodeId }
  }).then(barcode => {
    if (!barcode) {
      next(createError(404, 'Barcode not found'));
      return;
    }

    barcode.activeFlag = false;
    return barcode.save({ validate: false });
  }).then(updatedBarcode => {
    if (updatedBarcode) {
      res.json({ message: 'Barcode marked as inactive', id: barcodeId });
    }
  }).catch(error => {
    next(createError(500, `Error deleting barcode: ${error.message}`));
  });
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

async function getLocationZPL(barcodeID) {
  const location = await db.Location.findOne({
    where: { barcodeID, activeFlag: true }
  });

  if (!location) {
    throw new Error('Location not found');
  }

  const locationData = location.toJSON();
  return generateZPLDetails(locationData.name, locationData.description);
}

async function getBoxZPL(barcodeID) {
  const box = await db.Box.findOne({
    where: { barcodeID, activeFlag: true }
  });

  if (!box) {
    throw new Error('Box not found');
  }

  const boxData = box.toJSON();
  return generateZPLDetails(boxData.name, boxData.description);
}

async function getPartZPL(barcodeID) {
  const trace = await db.Trace.findOne({
    include: [{ model: db.Part, required: true }],
    where: { barcodeID, activeFlag: true }
  });

  if (!trace) {
    throw new Error('Part not found');
  }

  const traceData = trace.toJSON();
  const details = `PN: ${traceData.Part.name}\n${traceData.Part.description}\nQty: ${traceData.quantity}\nOrder Qty: ${traceData.Part.minimumOrderQuantity}`;

  return generateZPLDetails(traceData.Part.name, details);
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

function generateZPL(barcodeText, description) {
  return `
  ^XA

  ^FO16,16^GFA,1080,1080,20,I02,I03,I01,J08,J0C8,J048L08,J064K01,I0624J042U0FEK07C,I03F4J0C4T01FFJ01FC,J01CJ08CT03838J07C,K0CJ09FES0703CJ03C,K06I01BET07038J03C,K03I01EU07M03C,K038003CU0FM03C,K01C0078J03P0FM03C,K01E00FK03P0FM03C,K01F03EK03P0FM03C,K01IFCK07P0FM03C,K01IF8007D0FE07E00F3E7IFC03F83CFC,K01IFI0FF1FF1FF83F7F7IFE07F83DFE,K01IF001C30701C380FCF0F03E0E183F1E,K03FFE001C10701C3C07870F01E0E183E0F,K0IFE001E1070083C07820F01E0E083C07,00601IFEI0F807I03C07I0F01E0F803C07,00387IFCI0FC07001FC07I0F01E07E03C07,001KFCI07F0700FDC07I0F01E03F03C07,007KFCI01F8701E1C07I0F01E01F83C07,1MFC001078703C1C07I0F01E187C3C07,70C03IFE00103870381C07I0F01E181C3C07,81I0IFE00183870383C07I0F01E181C3C07,02I07IF001C3879BC7C0F800F01E1C1C3C0F8002I03IF001E783FBFDF3FE03FC7FDF39FF3FE0K03E0F8017E03F1F8E3FE07FEFFDBF1FF3FE0K03E03C,K03C01E,K03C00F,K01C00F,K01C007C,K01C006E,K01C0023,K01C00208,K03C00104,K06C0018,K04EI08,K08F,K0858,L06,J0106,L02,L03,L01,L01,M08,,

  ^FO32,65
   ^BQN,2,5,Q,7
      ^FDMM,A${barcodeText}
      ^FS
  ^FO32,185^A0N,22,22^FD${barcodeText}^FS

  ^CF0,28,28^FO135,80
  ^FB165,3,,C,
  ^FX 62 char limit
  ^FD${description}
  ^FS

   ^XZ
 `;
}

function generateZPLHeader(qrCodeData) {
  return `
    ^XA

    ^FO7,33^GFA,1512,1512,14,,:::::::::::::::::::::::::::::::Q0EI03,P03F801FE,P0FFC03FF,O03FBE03CFC,O0FE0E0783F,N03F80E0700FE,N0FE0C607103F8,M07FC1C607381FE,L01IF0C607387FF8,L0JFC0E0701JF,K03JFE0IF03JFE,J01LF0IF87KF8,J07LF8IF9MF,I01MFCE079MFC,I07JFE07CE03BIF83F7E,I0F8IFE03EE03JF01F0F8,001F0IFC03FE03JF00F87C,003C1IFC03FE03IFE00F83E,00781IFC03FC03IFE00FC0E,00701IFC03FC01JF01FC0F,00F01IFE07FC01JF81FC078,00E01JF0OFC7FC038,01C61FFC7OF1IFC63C,01C71FFC7IF800FFE1IFC71C,03C71FFC7IF800IF1IFC61C,03801MFI0MF801C,03800MFI07LF800C,03800MF800MF800E,03800WFI0E,038007VFI0E,038003KFCIFBKFEI0E,038003KFC0F01KFCI0C,038001KF8J0KF8001C,03CI0KF8J0KFI01C,01CI03JFK07IFEI01C,01CJ0JFK0JF8I038,00EJ01F3F8I01FCFCJ038,00FL07FCI03FEL078,007I0600F9KFCF003I0F,007800E01F0KF87807I0E,003C00603E07JF03E03003E,001EJ07C07800F03FJ07C,I0F8001FFBF800JFC001F8,I07F007EIF800IF3F007E,I01JF83FF800FFE1JFC,J07FFEI03800EI07IF,K0FF8I03800EJ0FF8,Q03800E,::Q03IFE,Q0KF,P01KF8,P01EI03C,P01CI01C,::P01F8IFC,P01FCIFC,P01CI01C,:::::P01KFC,:P01CI01C,:::001gGFC,003gGFE,00gIF8,03FJ07Q0EJ0FC,07FJ07Q0EJ07F,^FS

    ^FO15,147^A0N,13,13^FDLETWINVENTORY^FS
    ^FO493,46
    ^BQN,2,5
    ^FDMA,${qrCodeData}^FS
    ^FO500,165^A0N,17,17^FD${qrCodeData}^FS`;
}

function generateZPLDetails(name, description) {
  return `
          ^FO120,58^A0N,46,46^FD${name}^FS

          ^CF0,23,23^FO120,102
             ^FB367,2,,,
             ^FX 62 char limit
             ^FD ${description}
             ^FS
             ^XZ
             `;
}

// ============================================
// Helper Functions - ZPL Generation (1.5"x1" Labels)
// ============================================

function generateZPLHeader_1_5x1(qrCodeData) {
  // Duplicate of generateZPLHeader for 1.5"x1" label
  // TODO: Replace with actual 1.5"x1" ZPL code when provided
  return `
    ^XA

    ^FO7,33^GFA,1512,1512,14,,:::::::::::::::::::::::::::::::Q0EI03,P03F801FE,P0FFC03FF,O03FBE03CFC,O0FE0E0783F,N03F80E0700FE,N0FE0C607103F8,M07FC1C607381FE,L01IF0C607387FF8,L0JFC0E0701JF,K03JFE0IF03JFE,J01LF0IF87KF8,J07LF8IF9MF,I01MFCE079MFC,I07JFE07CE03BIF83F7E,I0F8IFE03EE03JF01F0F8,001F0IFC03FE03JF00F87C,003C1IFC03FE03IFE00F83E,00781IFC03FC03IFE00FC0E,00701IFC03FC01JF01FC0F,00F01IFE07FC01JF81FC078,00E01JF0OFC7FC038,01C61FFC7OF1IFC63C,01C71FFC7IF800FFE1IFC71C,03C71FFC7IF800IF1IFC61C,03801MFI0MF801C,03800MFI07LF800C,03800MF800MF800E,03800WFI0E,038007VFI0E,038003KFCIFBKFEI0E,038003KFC0F01KFCI0C,038001KF8J0KF8001C,03CI0KF8J0KFI01C,01CI03JFK07IFEI01C,01CJ0JFK0JF8I038,00EJ01F3F8I01FCFCJ038,00FL07FCI03FEL078,007I0600F9KFCF003I0F,007800E01F0KF87807I0E,003C00603E07JF03E03003E,001EJ07C07800F03FJ07C,I0F8001FFBF800JFC001F8,I07F007EIF800IF3F007E,I01JF83FF800FFE1JFC,J07FFEI03800EI07IF,K0FF8I03800EJ0FF8,Q03800E,::Q03IFE,Q0KF,P01KF8,P01EI03C,P01CI01C,::P01F8IFC,P01FCIFC,P01CI01C,:::::P01KFC,:P01CI01C,:::001gGFC,003gGFE,00gIF8,03FJ07Q0EJ0FC,07FJ07Q0EJ07F,^FS

    ^FO15,147^A0N,13,13^FDLETWINVENTORY^FS
    ^FO493,46
    ^BQN,2,5,Q,7
    ^FD   ${qrCodeData}
    ^FS
    ^FO500,165^A0N,17,17^FD${qrCodeData}^FS`;
}

function generateZPLDetails_1_5x1(name, description) {
  // Duplicate of generateZPLDetails for 1.5"x1" label
  // TODO: Replace with actual 1.5"x1" ZPL code when provided
  return `
          ^FO120,58^A0N,46,46^FD${name}^FS

          ^CF0,23,23^FO120,102
             ^FB367,2,,,
             ^FX 62 char limit
             ^FD ${description}
             ^FS
             ^XZ
             `;
}

async function getLocationZPL_1_5x1(barcodeID) {
  const location = await db.Location.findOne({
    where: { barcodeID, activeFlag: true }
  });

  if (!location) {
    throw new Error('Location not found');
  }

  const locationData = location.toJSON();
  return generateZPLDetails_1_5x1(locationData.name, locationData.description);
}

async function getBoxZPL_1_5x1(barcodeID) {
  const box = await db.Box.findOne({
    where: { barcodeID, activeFlag: true }
  });

  if (!box) {
    throw new Error('Box not found');
  }

  const boxData = box.toJSON();
  return generateZPLDetails_1_5x1(boxData.name, boxData.description);
}

async function getPartZPL_1_5x1(barcodeID) {
  const trace = await db.Trace.findOne({
    include: [{ model: db.Part, required: true }],
    where: { barcodeID, activeFlag: true }
  });

  if (!trace) {
    throw new Error('Part not found');
  }

  const traceData = trace.toJSON();
  const details = `PN: ${traceData.Part.name}\n${traceData.Part.description}\nQty: ${traceData.quantity}\nOrder Qty: ${traceData.Part.minimumOrderQuantity}`;

  return generateZPLDetails_1_5x1(traceData.Part.name, details);
}
