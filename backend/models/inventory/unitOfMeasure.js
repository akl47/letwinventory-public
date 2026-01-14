'use strict';
const {
    Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class UnitOfMeasure extends Model {
        static associate(models) {
            UnitOfMeasure.hasMany(models.Trace, {
                foreignKey: 'unitOfMeasureID',
                as: 'traces'
            });
            UnitOfMeasure.hasMany(models.BarcodeHistory, {
                foreignKey: 'unitOfMeasureID',
                as: 'barcodeHistories'
            });
        }
    };
    UnitOfMeasure.init({
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        description: {
            type: DataTypes.STRING,
            allowNull: true
        }
    }, {
        sequelize,
        modelName: 'UnitOfMeasure',
    });
    return UnitOfMeasure;
};
