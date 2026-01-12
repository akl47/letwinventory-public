'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.bulkInsert('UnitOfMeasures', [
            { id: 1, name: 'ea', description: 'Each (individual unit)', createdAt: new Date(), updatedAt: new Date() },
            { id: 2, name: 'gal', description: 'Gallon', createdAt: new Date(), updatedAt: new Date() },
            { id: 3, name: 'g', description: 'Gram', createdAt: new Date(), updatedAt: new Date() },
            { id: 4, name: 'kg', description: 'Kilogram', createdAt: new Date(), updatedAt: new Date() }
        ], { ignoreDuplicates: true });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.bulkDelete('UnitOfMeasures', null, {});
    }
};
