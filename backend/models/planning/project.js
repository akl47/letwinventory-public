'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Project extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Project.belongsTo(models.User, {
        foreignKey: 'ownerUserID',
        as: 'owner'
      });
    }
  };
  Project.init({
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },
    ownerUserID: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    parentProjectID: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    tagColorHex: {
      type: DataTypes.STRING(6),
      allowNull: false
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    shortName: {
      type: DataTypes.STRING(6),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    keyboardShortcut: {
      type: DataTypes.STRING(1),
      allowNull: true,
      unique: true,
      validate: {
        is: /^[1-9]$/ // 0 is reserved for "no project"
      }
    },
    activeFlag: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    sequelize,
    modelName: 'Project',
  });
  return Project;
};