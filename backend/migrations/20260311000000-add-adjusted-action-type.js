'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.bulkInsert('BarcodeHistoryActionTypes', [
            { id: 7, code: 'ADJUSTED', label: 'Quantity Adjusted', activeFlag: true, createdAt: new Date(), updatedAt: new Date() }
        ], { ignoreDuplicates: true });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.bulkDelete('BarcodeHistoryActionTypes', { code: 'ADJUSTED' });
    }
};
