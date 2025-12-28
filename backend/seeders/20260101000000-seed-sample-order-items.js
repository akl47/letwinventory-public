'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const db = require('../models');

    // Query for orders by vendor name
    const orders = await db.Order.findAll({
      where: {
        vendor: [
          'Acme Electronics Supply',
          'FastShip Logistics',
          'TechParts Direct',
          'Industrial Tools Co',
          'Global Components Ltd',
          'Precision Manufacturing'
        ]
      },
      raw: true
    });

    // Create a map of vendor names to order IDs
    const orderMap = {};
    orders.forEach(order => {
      orderMap[order.vendor] = order.id;
    });

    // Query for order line types
    const partLineType = await db.OrderLineType.findOne({ where: { name: 'Part' }, raw: true });
    const shippingLineType = await db.OrderLineType.findOne({ where: { name: 'Shipping' }, raw: true });
    const taxesLineType = await db.OrderLineType.findOne({ where: { name: 'Taxes' }, raw: true });
    const servicesLineType = await db.OrderLineType.findOne({ where: { name: 'Services' }, raw: true });
    const otherLineType = await db.OrderLineType.findOne({ where: { name: 'Other' }, raw: true });

    // Query for parts by name
    const parts = await db.Part.findAll({
      where: {
        name: ['000000', '000001', '000002', '000003', '000004', '000005', '000006', '000007', '000008', '000009']
      },
      raw: true
    });

    // Create a map of part names to IDs for easy lookup
    const partMap = {};
    parts.forEach(part => {
      partMap[part.name] = part.id;
    });

    const now = new Date();

    return queryInterface.bulkInsert('OrderItems', [
      // Acme Electronics Supply - Mixed parts and services
      {
        orderID: orderMap['Acme Electronics Supply'],
        partID: partMap['000000'],
        orderLineTypeID: partLineType.id,
        lineNumber: 1,
        quantity: 50,
        price: 12.50,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['Acme Electronics Supply'],
        partID: partMap['000001'],
        orderLineTypeID: partLineType.id,
        lineNumber: 2,
        quantity: 100,
        price: 8.75,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['Acme Electronics Supply'],
        partID: null,
        orderLineTypeID: shippingLineType.id,
        lineNumber: 3,
        quantity: 1,
        price: 45.00,
        name: 'Standard Ground Shipping',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['Acme Electronics Supply'],
        partID: null,
        orderLineTypeID: taxesLineType.id,
        lineNumber: 4,
        quantity: 1,
        price: 112.19,
        name: 'Sales Tax (8.5%)',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },

      // FastShip Logistics - Parts with express shipping
      {
        orderID: orderMap['FastShip Logistics'],
        partID: partMap['000002'],
        orderLineTypeID: partLineType.id,
        lineNumber: 1,
        quantity: 25,
        price: 34.99,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['FastShip Logistics'],
        partID: partMap['000003'],
        orderLineTypeID: partLineType.id,
        lineNumber: 2,
        quantity: 15,
        price: 67.50,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['FastShip Logistics'],
        partID: null,
        orderLineTypeID: shippingLineType.id,
        lineNumber: 3,
        quantity: 1,
        price: 125.00,
        name: 'Express Overnight Shipping',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },

      // TechParts Direct - Consumables and services
      {
        orderID: orderMap['TechParts Direct'],
        partID: partMap['000004'],
        orderLineTypeID: partLineType.id,
        lineNumber: 1,
        quantity: 200,
        price: 2.25,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['TechParts Direct'],
        partID: partMap['000005'],
        orderLineTypeID: partLineType.id,
        lineNumber: 2,
        quantity: 500,
        price: 0.85,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['TechParts Direct'],
        partID: null,
        orderLineTypeID: servicesLineType.id,
        lineNumber: 3,
        quantity: 1,
        price: 75.00,
        name: 'Hazmat Handling Fee',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['TechParts Direct'],
        partID: null,
        orderLineTypeID: shippingLineType.id,
        lineNumber: 4,
        quantity: 1,
        price: 65.00,
        name: 'Freight Shipping',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },

      // Industrial Tools Co - Tooling and equipment
      {
        orderID: orderMap['Industrial Tools Co'],
        partID: partMap['000006'],
        orderLineTypeID: partLineType.id,
        lineNumber: 1,
        quantity: 3,
        price: 450.00,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['Industrial Tools Co'],
        partID: partMap['000007'],
        orderLineTypeID: partLineType.id,
        lineNumber: 2,
        quantity: 5,
        price: 125.00,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['Industrial Tools Co'],
        partID: null,
        orderLineTypeID: servicesLineType.id,
        lineNumber: 3,
        quantity: 1,
        price: 200.00,
        name: 'Installation and Setup Service',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['Industrial Tools Co'],
        partID: null,
        orderLineTypeID: otherLineType.id,
        lineNumber: 4,
        quantity: 1,
        price: 50.00,
        name: 'Extended Warranty (1 year)',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },

      // Global Components Ltd - Prototype components
      {
        orderID: orderMap['Global Components Ltd'],
        partID: partMap['000008'],
        orderLineTypeID: partLineType.id,
        lineNumber: 1,
        quantity: 10,
        price: 89.99,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['Global Components Ltd'],
        partID: partMap['000009'],
        orderLineTypeID: partLineType.id,
        lineNumber: 2,
        quantity: 20,
        price: 45.00,
        name: null,
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['Global Components Ltd'],
        partID: null,
        orderLineTypeID: otherLineType.id,
        lineNumber: 3,
        quantity: 1,
        price: 150.00,
        name: 'Rush Processing Fee',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },

      // Precision Manufacturing - Custom machined parts
      {
        orderID: orderMap['Precision Manufacturing'],
        partID: null,
        orderLineTypeID: otherLineType.id,
        lineNumber: 1,
        quantity: 1,
        price: 5000.00,
        name: 'Custom CNC Machining - Bracket Assembly',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['Precision Manufacturing'],
        partID: null,
        orderLineTypeID: otherLineType.id,
        lineNumber: 2,
        quantity: 1,
        price: 3500.00,
        name: 'Custom CNC Machining - Housing Component',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['Precision Manufacturing'],
        partID: null,
        orderLineTypeID: servicesLineType.id,
        lineNumber: 3,
        quantity: 1,
        price: 500.00,
        name: 'Engineering Review and Quality Inspection',
        activeFlag: true,
        createdAt: now,
        updatedAt: now
      },
      {
        orderID: orderMap['Precision Manufacturing'],
        partID: null,
        orderLineTypeID: shippingLineType.id,
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
