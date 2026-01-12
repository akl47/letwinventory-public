'use strict';

/**
 * Creates CREATED history entries for existing barcodes that don't have one.
 * This backfills history for barcodes created before the history tracking feature.
 */
module.exports = {
    up: async (queryInterface, Sequelize) => {
        const [actionTypes] = await queryInterface.sequelize.query(
            `SELECT id FROM "BarcodeHistoryActionTypes" WHERE code = 'CREATED' LIMIT 1`
        );

        if (!actionTypes || actionTypes.length === 0) {
            console.log('CREATED action type not found. Skipping barcode history seeding.');
            return;
        }

        const createdActionId = actionTypes[0].id;

        // Get all barcodes that don't already have a CREATED history entry
        const [barcodes] = await queryInterface.sequelize.query(`
            SELECT b.id, b."parentBarcodeID", b."createdAt"
            FROM "Barcodes" b
            LEFT JOIN "BarcodeHistories" bh ON b.id = bh."barcodeID" AND bh."actionID" = ${createdActionId}
            WHERE bh.id IS NULL
        `);

        if (barcodes.length === 0) {
            console.log('No barcodes need history entries.');
            return;
        }

        console.log(`Creating history entries for ${barcodes.length} barcodes...`);

        const historyEntries = barcodes.map(barcode => ({
            barcodeID: barcode.id,
            userID: null,
            actionID: createdActionId,
            fromID: null,
            toID: barcode.parentBarcodeID,
            createdAt: barcode.createdAt,
            updatedAt: barcode.createdAt
        }));

        await queryInterface.bulkInsert('BarcodeHistories', historyEntries);
        console.log(`Created ${historyEntries.length} barcode history entries.`);
    },

    down: async (queryInterface, Sequelize) => {
        const [actionTypes] = await queryInterface.sequelize.query(
            `SELECT id FROM "BarcodeHistoryActionTypes" WHERE code = 'CREATED' LIMIT 1`
        );

        if (actionTypes && actionTypes.length > 0) {
            await queryInterface.bulkDelete('BarcodeHistories', {
                actionID: actionTypes[0].id,
                userID: null
            });
        }
    }
};
