'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class UploadedFile extends Model {
    static associate(models) {
      // Associate with User if it exists
      if (models.User) {
        UploadedFile.belongsTo(models.User, {
          foreignKey: 'uploadedBy',
          as: 'uploader'
        });
      }
    }
  }

  UploadedFile.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    filename: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Original filename'
    },
    mimeType: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'MIME type (e.g., image/png, image/jpeg)'
    },
    fileSize: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'File size in bytes'
    },
    data: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Base64 encoded file data'
    },
    uploadedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      },
      comment: 'User who uploaded the file'
    },
    activeFlag: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    createdAt: {
      allowNull: false,
      type: DataTypes.DATE
    },
    updatedAt: {
      allowNull: false,
      type: DataTypes.DATE
    }
  }, {
    sequelize,
    modelName: 'UploadedFile',
    tableName: 'UploadedFiles',
    freezeTableName: true
  });

  return UploadedFile;
};
