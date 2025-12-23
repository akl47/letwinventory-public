'use strict';
const {
    Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
    class TaskHistory extends Model {
        static associate(models) {
            TaskHistory.belongsTo(models.Task, {
                foreignKey: 'taskID',
                as: 'task'
            });
            TaskHistory.belongsTo(models.User, {
                foreignKey: 'userID',
                as: 'user'
            });
        }
    };
    TaskHistory.init({
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        taskID: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        userID: {
            type: DataTypes.INTEGER,
            allowNull: false
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
        }
    }, {
        sequelize,
        modelName: 'TaskHistory',
    });
    return TaskHistory;
};
