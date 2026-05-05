'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = Sequelize.literal('NOW()');
    await queryInterface.createTable('TtsAudio', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      ownerType: { type: Sequelize.STRING(40), allowNull: false },
      ownerID: { type: Sequelize.INTEGER, allowNull: false },
      field: { type: Sequelize.STRING(40), allowNull: false },
      textHash: { type: Sequelize.STRING(64), allowNull: false },
      filePath: { type: Sequelize.TEXT, allowNull: false },
      voice: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'alloy' },
      sizeBytes: { type: Sequelize.BIGINT, allowNull: true },
      generatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
    });
    await queryInterface.addIndex('TtsAudio', ['ownerType', 'ownerID'], {
      name: 'tts_audio_owner_idx',
    });
    await queryInterface.addIndex('TtsAudio', ['textHash'], {
      name: 'tts_audio_hash_idx',
    });
    await queryInterface.addIndex('TtsAudio', ['ownerType', 'ownerID', 'field', 'textHash'], {
      unique: true,
      name: 'tts_audio_unique_owner_field_hash',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('TtsAudio');
  },
};
