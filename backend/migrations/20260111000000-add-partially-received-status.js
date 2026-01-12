'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Check if status already exists
    const [existing] = await queryInterface.sequelize.query(
      `SELECT id FROM "OrderStatuses" WHERE id = 5`
    );

    if (existing.length > 0) {
      console.log('Partially Received status already exists, skipping...');
      return;
    }

    // Add "Partially Received" status (nextStatusID is null - backend handles transitions)
    await queryInterface.bulkInsert('OrderStatuses', [
      {
        id: 5,
        name: 'Partially Received',
        tagColor: '#FF9800', // Orange (between purple shipped and green received)
        nextStatusID: null, // Backend handles status transitions automatically
        activeFlag: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    // Try to set nextStatusID to 4 (Received) if it exists
    const [receivedStatus] = await queryInterface.sequelize.query(
      `SELECT id FROM "OrderStatuses" WHERE id = 4`
    );

    if (receivedStatus.length > 0) {
      await queryInterface.sequelize.query(
        `UPDATE "OrderStatuses" SET "nextStatusID" = 4 WHERE id = 5`
      );
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Remove the Partially Received status
    await queryInterface.bulkDelete('OrderStatuses', { id: 5 });
  }
};
