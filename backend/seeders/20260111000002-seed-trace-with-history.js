'use strict';
const db = require('../models');

/**
 * Creates a trace barcode with 50 lines of barcode history
 * for testing the barcode history feature.
 */
module.exports = {
    up: async (queryInterface, Sequelize) => {
        // Get the part we'll use for the trace with history
        const testPart = await db.Part.findOne({ where: { name: 'TEST-BOTH-001' } });
        if (!testPart) {
            console.log('Test part TEST-BOTH-001 not found. Run test parts seeder first.');
            return;
        }

        // Get barcode category for traces (AKL)
        const traceCategory = await db.BarcodeCategory.findOne({ where: { prefix: 'AKL' } });
        if (!traceCategory) {
            console.log('Trace barcode category (AKL) not found.');
            return;
        }

        // Get a parent location barcode (find any existing box or location)
        const parentBarcode = await db.Barcode.findOne({
            where: { activeFlag: true },
            order: [['id', 'ASC']]
        });
        if (!parentBarcode) {
            console.log('No parent barcode found. Skipping trace creation.');
            return;
        }

        // Get some location/box barcodes for move history
        const locationBarcodes = await db.Barcode.findAll({
            where: { activeFlag: true },
            limit: 10,
            order: [['id', 'ASC']]
        });

        // Create the trace barcode
        const traceBarcode = await db.Barcode.create({
            barcodeCategoryID: traceCategory.dataValues.id,
            parentBarcodeID: parentBarcode.dataValues.id
        });
        console.log('Created trace barcode:', traceBarcode.dataValues.barcode);

        // Create the trace
        const trace = await db.Trace.create({
            partID: testPart.dataValues.id,
            quantity: 100.5,
            unitOfMeasureID: testPart.dataValues.defaultUnitOfMeasureID || 1,
            barcodeID: traceBarcode.dataValues.id,
            serialNumber: 'SN-TEST-12345',
            lotNumber: 'LOT-2026-001'
        });
        console.log('Created trace:', trace.dataValues.id);

        // Get action types for history
        const createdAction = await db.BarcodeHistoryActionType.findOne({ where: { code: 'CREATED' } });
        const movedAction = await db.BarcodeHistoryActionType.findOne({ where: { code: 'MOVED' } });
        const receivedAction = await db.BarcodeHistoryActionType.findOne({ where: { code: 'RECEIVED' } });
        const splitAction = await db.BarcodeHistoryActionType.findOne({ where: { code: 'SPLIT' } });

        if (!createdAction || !movedAction) {
            console.log('Required action types not found. Run action types seeder first.');
            return;
        }

        // Create 50 history entries
        const historyEntries = [];
        const baseDate = new Date();
        baseDate.setDate(baseDate.getDate() - 60); // Start 60 days ago

        // First entry is always CREATED
        historyEntries.push({
            barcodeID: traceBarcode.dataValues.id,
            userID: null,
            actionID: createdAction.dataValues.id,
            fromID: null,
            toID: parentBarcode.dataValues.id,
            qty: 100.5,
            serialNumber: 'SN-TEST-12345',
            lotNumber: 'LOT-2026-001',
            unitOfMeasureID: testPart.dataValues.defaultUnitOfMeasureID || 1,
            createdAt: new Date(baseDate),
            updatedAt: new Date(baseDate)
        });

        // Generate 49 more history entries with various actions
        let currentLocationIdx = 0;
        for (let i = 1; i < 50; i++) {
            const entryDate = new Date(baseDate);
            entryDate.setHours(entryDate.getHours() + (i * 24)); // Advance by ~1 day each entry

            // Cycle through different action types
            let actionId, fromId, toId, qty, sn, lot, uomId;
            const actionType = i % 4;

            const prevLocationIdx = currentLocationIdx;
            currentLocationIdx = (currentLocationIdx + 1) % locationBarcodes.length;

            switch (actionType) {
                case 0: // MOVED
                    actionId = movedAction.dataValues.id;
                    fromId = locationBarcodes[prevLocationIdx].dataValues.id;
                    toId = locationBarcodes[currentLocationIdx].dataValues.id;
                    qty = 100.5 - (i * 0.5); // Decreasing quantity over time
                    sn = 'SN-TEST-12345';
                    lot = 'LOT-2026-001';
                    uomId = testPart.dataValues.defaultUnitOfMeasureID || 1;
                    break;
                case 1: // RECEIVED (if available)
                    actionId = receivedAction ? receivedAction.dataValues.id : movedAction.dataValues.id;
                    fromId = null;
                    toId = locationBarcodes[currentLocationIdx].dataValues.id;
                    qty = 50 + (i % 20); // Varying quantities
                    sn = `SN-RCV-${i.toString().padStart(3, '0')}`;
                    lot = `LOT-2026-${Math.floor(i / 10).toString().padStart(3, '0')}`;
                    uomId = testPart.dataValues.defaultUnitOfMeasureID || 1;
                    break;
                case 2: // SPLIT (if available)
                    actionId = splitAction ? splitAction.dataValues.id : movedAction.dataValues.id;
                    fromId = locationBarcodes[prevLocationIdx].dataValues.id;
                    toId = locationBarcodes[currentLocationIdx].dataValues.id;
                    qty = 25 + (i % 15);
                    sn = `SN-SPLIT-${i.toString().padStart(3, '0')}`;
                    lot = 'LOT-2026-001';
                    uomId = testPart.dataValues.defaultUnitOfMeasureID || 1;
                    break;
                default: // MOVED
                    actionId = movedAction.dataValues.id;
                    fromId = locationBarcodes[prevLocationIdx].dataValues.id;
                    toId = locationBarcodes[currentLocationIdx].dataValues.id;
                    qty = 75.25;
                    sn = 'SN-TEST-12345';
                    lot = 'LOT-2026-001';
                    uomId = testPart.dataValues.defaultUnitOfMeasureID || 1;
                    break;
            }

            historyEntries.push({
                barcodeID: traceBarcode.dataValues.id,
                userID: null,
                actionID: actionId,
                fromID: fromId,
                toID: toId,
                qty: qty,
                serialNumber: sn,
                lotNumber: lot,
                unitOfMeasureID: uomId,
                createdAt: entryDate,
                updatedAt: entryDate
            });
        }

        // Insert all history entries
        await queryInterface.bulkInsert('BarcodeHistories', historyEntries);
        console.log(`Created ${historyEntries.length} barcode history entries for trace ${traceBarcode.dataValues.barcode}`);
    },

    down: async (queryInterface, Sequelize) => {
        // Find the test trace and clean up
        const testPart = await db.Part.findOne({ where: { name: 'TEST-BOTH-001' } });
        if (testPart) {
            const traces = await db.Trace.findAll({
                where: {
                    partID: testPart.dataValues.id,
                    serialNumber: 'SN-TEST-12345'
                }
            });

            for (const trace of traces) {
                await db.BarcodeHistory.destroy({ where: { barcodeID: trace.dataValues.barcodeID } });
                await db.Trace.destroy({ where: { id: trace.dataValues.id } });
                await db.Barcode.destroy({ where: { id: trace.dataValues.barcodeID } });
            }
        }
    }
};
