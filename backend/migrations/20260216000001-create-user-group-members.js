'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('UserGroupMembers', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      userID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
      },
      groupID: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'UserGroups', key: 'id' },
        onDelete: 'CASCADE'
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    await queryInterface.addIndex('UserGroupMembers', ['userID', 'groupID'], { unique: true });
    await queryInterface.addIndex('UserGroupMembers', ['groupID']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('UserGroupMembers');
  }
};
