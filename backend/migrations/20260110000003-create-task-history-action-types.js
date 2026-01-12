'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('TaskHistoryActionTypes', {
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

        // Add foreign key constraint to existing TaskHistories table
        await queryInterface.addConstraint('TaskHistories', {
            fields: ['actionID'],
            type: 'foreign key',
            name: 'TaskHistories_actionID_fkey',
            references: {
                table: 'TaskHistoryActionTypes',
                field: 'id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeConstraint('TaskHistories', 'TaskHistories_actionID_fkey');
        await queryInterface.dropTable('TaskHistoryActionTypes');
    }
};
