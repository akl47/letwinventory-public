'use strict';
const { Model } = require('sequelize');

// REQ 1069 — link between a part and a project it belongs to (many-to-many).
module.exports = (sequelize, DataTypes) => {
  class PartProject extends Model {
    static associate(models) {
      PartProject.belongsTo(models.Part, { foreignKey: 'partID' });
      PartProject.belongsTo(models.Project, { foreignKey: 'projectID' });
    }
  }
  PartProject.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    partID: { type: DataTypes.INTEGER, allowNull: false },
    projectID: { type: DataTypes.INTEGER, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  }, {
    sequelize,
    modelName: 'PartProject',
    indexes: [{ unique: true, fields: ['partID', 'projectID'], name: 'part_projects_part_project_unique' }],
  });
  return PartProject;
};
