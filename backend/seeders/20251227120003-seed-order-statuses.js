'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // First insert the statuses without nextStatusID
    await queryInterface.bulkInsert('OrderStatuses', [
      {
        id: 1,
        name: 'Pending',
        tagColor: '#FFA500', // Orange
        nextStatusID: null, // Will be updated below
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 2,
        name: 'Placed',
        tagColor: '#2196F3', // Blue
        nextStatusID: null, // Will be updated below
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 3,
        name: 'Shipped',
        tagColor: '#9C27B0', // Purple
        nextStatusID: null, // Will be updated below
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 4,
        name: 'Received',
        tagColor: '#4CAF50', // Green
        nextStatusID: null, // Final status, no next
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    // Update nextStatusID values to create the workflow:
    // Pending -> Placed -> Shipped -> Received
    await queryInterface.sequelize.query(
      `UPDATE "OrderStatuses" SET "nextStatusID" = 2, "updatedAt" = NOW() WHERE id = 1;`
    );
    await queryInterface.sequelize.query(
      `UPDATE "OrderStatuses" SET "nextStatusID" = 3, "updatedAt" = NOW() WHERE id = 2;`
    );
    await queryInterface.sequelize.query(
      `UPDATE "OrderStatuses" SET "nextStatusID" = 4, "updatedAt" = NOW() WHERE id = 3;`
    );
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('OrderStatuses', null, {});
  }
};
