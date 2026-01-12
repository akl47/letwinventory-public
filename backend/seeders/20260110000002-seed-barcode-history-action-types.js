'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
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
        await queryInterface.bulkDelete('BarcodeHistoryActionTypes', null, {});
    }
};
