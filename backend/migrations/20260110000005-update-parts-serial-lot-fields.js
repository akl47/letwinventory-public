'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('Parts', 'serialNumberRequired', {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false
        });

        await queryInterface.addColumn('Parts', 'lotNumberRequired', {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('Parts', 'lotNumberRequired');
        await queryInterface.removeColumn('Parts', 'serialNumberRequired');
    }
};
