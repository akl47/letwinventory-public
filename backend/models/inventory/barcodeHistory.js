'use strict';
const {
    Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class BarcodeHistory extends Model {
        static associate(models) {
            BarcodeHistory.belongsTo(models.Barcode, {
                foreignKey: 'barcodeID',
                as: 'barcode'
            });
            BarcodeHistory.belongsTo(models.User, {
                foreignKey: 'userID',
                as: 'user'
            });
            BarcodeHistory.belongsTo(models.BarcodeHistoryActionType, {
                foreignKey: 'actionID',
                as: 'actionType'
            });
            BarcodeHistory.belongsTo(models.UnitOfMeasure, {
                foreignKey: 'unitOfMeasureID',
                as: 'unitOfMeasure'
            });
        }
    };
    BarcodeHistory.init({
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        barcodeID: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        userID: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        actionID: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        fromID: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        toID: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        serialNumber: {
            type: DataTypes.STRING,
            allowNull: true
        },
        lotNumber: {
            type: DataTypes.STRING,
            allowNull: true
        },
        qty: {
            type: DataTypes.FLOAT,
            allowNull: true
        },
        unitOfMeasureID: {
            type: DataTypes.INTEGER,
            allowNull: true
        }
    }, {
        sequelize,
        modelName: 'BarcodeHistory',
    });
    return BarcodeHistory;
};
