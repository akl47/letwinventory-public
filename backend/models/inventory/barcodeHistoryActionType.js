'use strict';
const {
    Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class BarcodeHistoryActionType extends Model {
        static associate(models) {
            BarcodeHistoryActionType.hasMany(models.BarcodeHistory, {
                foreignKey: 'actionID',
                as: 'histories'
            });
        }
    };
    BarcodeHistoryActionType.init({
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        code: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        label: {
            type: DataTypes.STRING,
            allowNull: false
        },
        activeFlag: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        }
    }, {
        sequelize,
        modelName: 'BarcodeHistoryActionType',
    });
    return BarcodeHistoryActionType;
};
