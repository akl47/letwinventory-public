'use strict';
const {
    Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class TaskHistoryActionType extends Model {
        static associate(models) {
            TaskHistoryActionType.hasMany(models.TaskHistory, {
                foreignKey: 'actionID',
                as: 'histories'
            });
        }
    };
    TaskHistoryActionType.init({
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
        modelName: 'TaskHistoryActionType',
    });
    return TaskHistoryActionType;
};
