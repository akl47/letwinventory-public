'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // Change quantity from INTEGER to FLOAT
        await queryInterface.changeColumn('Traces', 'quantity', {
            type: Sequelize.FLOAT,
            allowNull: false
        });

        // Add unitOfMeasureID column
        await queryInterface.addColumn('Traces', 'unitOfMeasureID', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: {
                model: 'UnitOfMeasures',
                key: 'id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        });

        // Add serialNumber and lotNumber columns
        await queryInterface.addColumn('Traces', 'serialNumber', {
            type: Sequelize.STRING,
            allowNull: true
        });

        await queryInterface.addColumn('Traces', 'lotNumber', {
            type: Sequelize.STRING,
            allowNull: true
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('Traces', 'lotNumber');
        await queryInterface.removeColumn('Traces', 'serialNumber');
        await queryInterface.removeColumn('Traces', 'unitOfMeasureID');
        await queryInterface.changeColumn('Traces', 'quantity', {
            type: Sequelize.INTEGER,
            allowNull: false
        });
    }
};
