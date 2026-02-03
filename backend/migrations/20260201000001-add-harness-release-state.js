'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add release state fields to WireHarnesses table
    await queryInterface.addColumn('WireHarnesses', 'releaseState', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'draft'
    });

    await queryInterface.addColumn('WireHarnesses', 'releasedAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('WireHarnesses', 'releasedBy', {
      type: Sequelize.STRING(100),
      allowNull: true
    });

    await queryInterface.addColumn('WireHarnesses', 'previousRevisionID', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'WireHarnesses',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    // Add index for finding revision chains
    await queryInterface.addIndex('WireHarnesses', ['previousRevisionID'], {
      name: 'wireharnesses_previous_revision_idx'
    });

    // Add index for filtering by release state
    await queryInterface.addIndex('WireHarnesses', ['releaseState'], {
      name: 'wireharnesses_release_state_idx'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('WireHarnesses', 'wireharnesses_release_state_idx');
    await queryInterface.removeIndex('WireHarnesses', 'wireharnesses_previous_revision_idx');
    await queryInterface.removeColumn('WireHarnesses', 'previousRevisionID');
    await queryInterface.removeColumn('WireHarnesses', 'releasedBy');
    await queryInterface.removeColumn('WireHarnesses', 'releasedAt');
    await queryInterface.removeColumn('WireHarnesses', 'releaseState');
  }
};
