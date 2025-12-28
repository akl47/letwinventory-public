'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    return queryInterface.bulkInsert('Orders', [
      {
        description: 'Quarterly electronics components order. All items received in good condition. Invoice matches.',
        vendor: 'Acme Electronics Supply',
        trackingNumber: '1Z999AA10123456781',
        link: 'https://www.acmeelectronics.example/orders/QE2024-001',
        placedDate: sixtyDaysAgo,
        receivedDate: new Date(sixtyDaysAgo.getTime() + 10 * 24 * 60 * 60 * 1000),
        orderStatusID: 4, // Received
        activeFlag: true,
        createdAt: sixtyDaysAgo,
        updatedAt: new Date(sixtyDaysAgo.getTime() + 10 * 24 * 60 * 60 * 1000)
      },
      {
        description: 'Urgent replacement parts for production line. Express shipping used. 2 items backordered.',
        vendor: 'FastShip Logistics',
        trackingNumber: '1Z999AA10123456782',
        link: 'https://www.fastship.example/track/FS-URGENT-2024',
        placedDate: thirtyDaysAgo,
        receivedDate: new Date(thirtyDaysAgo.getTime() + 5 * 24 * 60 * 60 * 1000),
        orderStatusID: 4, // Received
        activeFlag: true,
        createdAt: thirtyDaysAgo,
        updatedAt: new Date(thirtyDaysAgo.getTime() + 5 * 24 * 60 * 60 * 1000)
      },
      {
        description: 'Monthly consumables and maintenance supplies. Expected delivery: 3 business days.',
        vendor: 'TechParts Direct',
        trackingNumber: '1Z999AA10123456784',
        link: 'https://www.techparts.example/order/TPD-2024-M03',
        placedDate: fifteenDaysAgo,
        receivedDate: null,
        orderStatusID: 3, // Shipped
        activeFlag: true,
        createdAt: fifteenDaysAgo,
        updatedAt: new Date(fifteenDaysAgo.getTime() + 2 * 24 * 60 * 60 * 1000)
      },
      {
        description: 'New tooling for assembly process. Quote #QT-8472. Payment processed. Awaiting shipment confirmation.',
        vendor: 'Industrial Tools Co',
        trackingNumber: null,
        link: 'https://www.industrialtools.example/quotes/QT-8472',
        placedDate: sevenDaysAgo,
        receivedDate: null,
        orderStatusID: 2, // Placed
        activeFlag: true,
        createdAt: sevenDaysAgo,
        updatedAt: sevenDaysAgo
      },
      {
        description: 'Prototype components for R&D project Alpha. Draft order. Pending budget approval from finance.',
        vendor: 'Global Components Ltd',
        trackingNumber: null,
        link: null,
        placedDate: null,
        receivedDate: null,
        orderStatusID: 1, // Pending
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        description: 'Custom machined parts - Project Beta. Lead time: 4-6 weeks. 50% deposit paid.',
        vendor: 'Precision Manufacturing',
        trackingNumber: null,
        link: 'https://www.precisionmfg.example/custom-orders/BETA-2024',
        placedDate: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        receivedDate: null,
        orderStatusID: 2, // Placed
        activeFlag: true,
        createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
      }
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('Orders', null, {});
  }
};
