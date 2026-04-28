'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('UploadedFiles', 'filePath', {
      type: Sequelize.STRING(500),
      allowNull: true,
      comment: 'Relative path to file on disk (from FILE_STORAGE_PATH)',
    });

    // Make data nullable — new uploads won't store base64 in DB
    await queryInterface.changeColumn('UploadedFiles', 'data', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('UploadedFiles', 'filePath');
    await queryInterface.changeColumn('UploadedFiles', 'data', {
      type: Sequelize.TEXT,
      allowNull: false,
    });
  },
};
