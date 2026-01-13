'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('BarcodeHistoryActionTypes', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            code: {
                type: Sequelize.STRING,
                allowNull: false,
                unique: true
            },
            label: {
                type: Sequelize.STRING,
                allowNull: false
            },
            activeFlag: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: true
            },
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            }
        });

        // Seed default action types (required for FK references in BarcodeHistories)
        await queryInterface.bulkInsert('BarcodeHistoryActionTypes', [
            { id: 1, code: 'CREATED', label: 'Barcode Created', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 2, code: 'MOVED', label: 'Barcode Moved', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 3, code: 'RECEIVED', label: 'Barcode Received', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 4, code: 'SPLIT', label: 'Barcode Split', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 5, code: 'MERGED', label: 'Barcode Merged', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 6, code: 'DELETED', label: 'Barcode Deleted', activeFlag: true, createdAt: new Date(), updatedAt: new Date() }
        ], { ignoreDuplicates: true });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('BarcodeHistoryActionTypes');
    }
};
