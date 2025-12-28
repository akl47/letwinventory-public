'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const now = new Date();

    return queryInterface.bulkInsert('OrderItems', [
      // Order 1 - Mixed parts and services
      {
        orderID: 1,
        partID: 1,
        orderLineTypeID: 1, // Part
        lineNumber: 1,
        quantity: 50,
        price: 12.50,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 1,
        partID: 2,
        orderLineTypeID: 1, // Part
        lineNumber: 2,
        quantity: 100,
        price: 8.75,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 1,
        partID: null,
        orderLineTypeID: 2, // Shipping
        lineNumber: 3,
        quantity: 1,
        price: 45.00,
        name: 'Standard Ground Shipping',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 1,
        partID: null,
        orderLineTypeID: 3, // Taxes
        lineNumber: 4,
        quantity: 1,
        price: 112.19,
        name: 'Sales Tax (8.5%)',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },

      // Order 1002 - Parts with express shipping
      {
        orderID: 2,
        partID: 3, // References Parts table (000002)
        orderLineTypeID: 1, // Part
        lineNumber: 1,
        quantity: 25,
        price: 34.99,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 2,
        partID: 4, // References Parts table (000003)
        orderLineTypeID: 1, // Part
        lineNumber: 2,
        quantity: 15,
        price: 67.50,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 2,
        partID: null,
        orderLineTypeID: 2, // Shipping
        lineNumber: 3,
        quantity: 1,
        price: 125.00,
        name: 'Express Overnight Shipping',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },

      // Order 1003 - Consumables and services
      {
        orderID: 3,
        partID: 5, // References Parts table (000004)
        orderLineTypeID: 1, // Part
        lineNumber: 1,
        quantity: 200,
        price: 2.25,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 3,
        partID: 6, // References Parts table (000005)
        orderLineTypeID: 1, // Part
        lineNumber: 2,
        quantity: 500,
        price: 0.85,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 3,
        partID: null,
        orderLineTypeID: 4, // Services
        lineNumber: 3,
        quantity: 1,
        price: 75.00,
        name: 'Hazmat Handling Fee',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 3,
        partID: null,
        orderLineTypeID: 2, // Shipping
        lineNumber: 4,
        quantity: 1,
        price: 65.00,
        name: 'Freight Shipping',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },

      // Order 1004 - Tooling and equipment
      {
        orderID: 4,
        partID: 7, // References Parts table (000006)
        orderLineTypeID: 1, // Part
        lineNumber: 1,
        quantity: 3,
        price: 450.00,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 4,
        partID: 8, // References Parts table (000007)
        orderLineTypeID: 1, // Part
        lineNumber: 2,
        quantity: 5,
        price: 125.00,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 4,
        partID: null,
        orderLineTypeID: 4, // Services
        lineNumber: 3,
        quantity: 1,
        price: 200.00,
        name: 'Installation and Setup Service',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 4,
        partID: null,
        orderLineTypeID: 5, // Other
        lineNumber: 4,
        quantity: 1,
        price: 50.00,
        name: 'Extended Warranty (1 year)',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },

      // Order 1005 - Prototype components
      {
        orderID: 5,
        partID: 9, // References Parts table (000008)
        orderLineTypeID: 1, // Part
        lineNumber: 1,
        quantity: 10,
        price: 89.99,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 5,
        partID: 10, // References Parts table (000009)
        orderLineTypeID: 1, // Part
        lineNumber: 2,
        quantity: 20,
        price: 45.00,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 5,
        partID: null,
        orderLineTypeID: 5, // Other
        lineNumber: 3,
        quantity: 1,
        price: 150.00,
        name: 'Rush Processing Fee',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },

      // Order 1006 - Custom machined parts
      {
        orderID: 6,
        partID: null,
        orderLineTypeID: 5, // Other
        lineNumber: 1,
        quantity: 1,
        price: 5000.00,
        name: 'Custom CNC Machining - Bracket Assembly',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 6,
        partID: null,
        orderLineTypeID: 5, // Other
        lineNumber: 2,
        quantity: 1,
        price: 3500.00,
        name: 'Custom CNC Machining - Housing Component',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 6,
        partID: null,
        orderLineTypeID: 4, // Services
        lineNumber: 3,
        quantity: 1,
        price: 500.00,
        name: 'Engineering Review and Quality Inspection',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: 6,
        partID: null,
        orderLineTypeID: 2, // Shipping
        lineNumber: 4,
        quantity: 1,
        price: 250.00,
        name: 'White Glove Delivery Service',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      }
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('OrderItems', null, {});
  }
};
