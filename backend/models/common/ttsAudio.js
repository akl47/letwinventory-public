'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TtsAudio extends Model {
    static associate(/* models */) {
      // Polymorphic owner — no FK. Joins go via (ownerType, ownerID).
    }
  }
  TtsAudio.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    ownerType: { type: DataTypes.STRING(40), allowNull: false },
    ownerID: { type: DataTypes.INTEGER, allowNull: false },
    field: { type: DataTypes.STRING(40), allowNull: false },
    textHash: { type: DataTypes.STRING(64), allowNull: false },
    filePath: { type: DataTypes.TEXT, allowNull: false },
    voice: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'alloy' },
    sizeBytes: { type: DataTypes.BIGINT, allowNull: true },
    generatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    modelName: 'TtsAudio',
    tableName: 'TtsAudio',
    freezeTableName: true,
    indexes: [
      { unique: true, fields: ['ownerType', 'ownerID', 'field', 'textHash'], name: 'tts_audio_unique_owner_field_hash' },
      { fields: ['ownerType', 'ownerID'], name: 'tts_audio_owner_idx' },
      { fields: ['textHash'], name: 'tts_audio_hash_idx' },
    ],
  });
  return TtsAudio;
};
