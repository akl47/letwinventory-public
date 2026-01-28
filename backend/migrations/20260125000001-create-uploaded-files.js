'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Create UploadedFiles table for centralized file storage
    await queryInterface.createTable('UploadedFiles', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      filename: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'Original filename'
      },
      mimeType: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'MIME type (e.g., image/png, image/jpeg)'
      },
      fileSize: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'File size in bytes'
      },
      data: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Base64 encoded file data'
      },
      uploadedBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'User who uploaded the file'
      },
      activeFlag: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
    await queryInterface.addIndex('UploadedFiles', ['activeFlag']);
    await queryInterface.addIndex('UploadedFiles', ['uploadedBy']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('UploadedFiles');
  }
};
