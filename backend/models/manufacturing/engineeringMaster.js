'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class EngineeringMaster extends Model {
    static associate(models) {
      EngineeringMaster.belongsTo(models.User, { as: 'createdBy', foreignKey: 'createdByUserID' });
      EngineeringMaster.belongsTo(models.User, { as: 'releasedBy', foreignKey: 'releasedByUserID' });
      EngineeringMaster.belongsTo(models.EngineeringMaster, { as: 'previousRevision', foreignKey: 'previousRevisionID' });
      EngineeringMaster.hasMany(models.EngineeringMaster, { as: 'laterRevisions', foreignKey: 'previousRevisionID' });
      EngineeringMaster.hasMany(models.EngineeringMasterOutputPart, { as: 'outputParts', foreignKey: 'engineeringMasterID' });
      EngineeringMaster.hasMany(models.EngineeringMasterStep, { as: 'steps', foreignKey: 'engineeringMasterID' });
      EngineeringMaster.hasMany(models.EngineeringMasterHistory, { as: 'history', foreignKey: 'engineeringMasterID' });
      EngineeringMaster.hasMany(models.EngineeringMasterBomItem, { as: 'bomItems', foreignKey: 'engineeringMasterID' });
      EngineeringMaster.hasMany(models.WorkOrder, { as: 'workOrders', foreignKey: 'engineeringMasterID' });
    }
  }

  EngineeringMaster.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    revision: { type: DataTypes.STRING(8), allowNull: false, defaultValue: '01' },
    releaseState: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft' },
    previousRevisionID: { type: DataTypes.INTEGER, allowNull: true },
    createdByUserID: { type: DataTypes.INTEGER, allowNull: false },
    releasedByUserID: { type: DataTypes.INTEGER, allowNull: true },
    releasedAt: { type: DataTypes.DATE, allowNull: true },
    activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'EngineeringMaster',
  });

  return EngineeringMaster;
};
