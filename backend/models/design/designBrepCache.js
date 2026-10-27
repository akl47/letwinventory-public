'use strict';
const { Model } = require('sequelize');

// Per-feature BRep + tessellated-mesh cache. See the corresponding migration
// (`backend/migrations/20260515000000-create-design-brep-cache.js`) for the
// full design notes and the `(cadModelID, featureID, paramHash, upstreamHash)`
// cache-key contract.

module.exports = (sequelize, DataTypes) => {
  class DesignBRepCache extends Model {
    static associate(models) {
      DesignBRepCache.belongsTo(models.DesignCADModel, { as: 'cadModel', foreignKey: 'cadModelID' });
    }
  }
  DesignBRepCache.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    cadModelID: { type: DataTypes.INTEGER, allowNull: false },
    featureID: { type: DataTypes.STRING(64), allowNull: false },
    paramHash: { type: DataTypes.STRING(64), allowNull: false },
    upstreamHash: { type: DataTypes.STRING(64), allowNull: false, defaultValue: '' },
    brepBytes: { type: DataTypes.BLOB('long'), allowNull: false },
    tessellatedFaces: { type: DataTypes.JSONB, allowNull: false },
    namingVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    lastAccessedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'DesignBRepCache',
    tableName: 'DesignBRepCache',
    timestamps: false,  // createdAt + lastAccessedAt are managed explicitly
    indexes: [
      {
        unique: true,
        fields: ['cadModelID', 'featureID', 'paramHash', 'upstreamHash'],
        name: 'design_brep_cache_key_unique',
      },
      { fields: ['lastAccessedAt'] },
    ],
  });
  return DesignBRepCache;
};
