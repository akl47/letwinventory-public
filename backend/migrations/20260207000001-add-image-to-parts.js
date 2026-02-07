'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Parts', 'imageFileID', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'UploadedFiles',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Parts', 'imageFileID');
  }
};
