'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('Parts', 'defaultUnitOfMeasureID', {
            type: Sequelize.INTEGER,
            allowNull: true,
            defaultValue: 1, // Default to 'ea'
            references: {
                model: 'UnitOfMeasures',
                key: 'id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('Parts', 'defaultUnitOfMeasureID');
    }
};
