'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('UnitOfMeasures', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            name: {
                type: Sequelize.STRING,
                allowNull: false,
                unique: true
            },
            description: {
                type: Sequelize.STRING,
                allowNull: true
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

        // Seed default unit of measures (required for FK references in later migrations)
        await queryInterface.bulkInsert('UnitOfMeasures', [
            { id: 1, name: 'ea', description: 'Each (individual unit)', createdAt: new Date(), updatedAt: new Date() },
            { id: 2, name: 'gal', description: 'Gallon', createdAt: new Date(), updatedAt: new Date() },
            { id: 3, name: 'g', description: 'Gram', createdAt: new Date(), updatedAt: new Date() },
            { id: 4, name: 'kg', description: 'Kilogram', createdAt: new Date(), updatedAt: new Date() }
        ], { ignoreDuplicates: true });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('UnitOfMeasures');
    }
};
