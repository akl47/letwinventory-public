'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('BarcodeHistories', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            barcodeID: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: {
                    model: 'Barcodes',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            userID: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: {
                    model: 'Users',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            actionID: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: {
                    model: 'BarcodeHistoryActionTypes',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'RESTRICT'
            },
            fromID: {
                type: Sequelize.INTEGER,
                allowNull: true
            },
            toID: {
                type: Sequelize.INTEGER,
                allowNull: true
            },
            serialNumber: {
                type: Sequelize.STRING,
                allowNull: true
            },
            lotNumber: {
                type: Sequelize.STRING,
                allowNull: true
            },
            qty: {
                type: Sequelize.FLOAT,
                allowNull: true
            },
            unitOfMeasureID: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: {
                    model: 'UnitOfMeasures',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
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
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('BarcodeHistories');
    }
};
