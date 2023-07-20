'use strict';
const db = require('../models'); // Assuming migrations is next to models


module.exports = {
  up: async (queryInterface, Sequelize) => {
    let loc_category_id = await db.BarcodeCategory.findOne({
      where: {
        prefix: "LOC"
      }
    })
    let box_category_id = await db.BarcodeCategory.findOne({
      where: {
        prefix: "BOX"
      }
    })
    const earthBarcode = await db.Barcode.create({
      barcodeCategoryID: loc_category_id.dataValues.id,
      parentBarcodeID: 0
    })
    const earth = await db.Location.create({
      name: 'Earth',
      description: 'Pale Blue Dot',
      barcodeID: earthBarcode.dataValues.id,
      
    })

    const fremontBarcode = await db.Barcode.create({
      barcodeCategoryID: loc_category_id.dataValues.id,
      parentBarcodeID: earthBarcode.dataValues.id
    })
    const fremont = await db.Location.create({
      name: 'Fremont',
      description: '',
      barcodeID: fremontBarcode.dataValues.id,
      
    })

    const shippingContainerBarcode = await db.Barcode.create({
      barcodeCategoryID: loc_category_id.dataValues.id,
      parentBarcodeID: fremontBarcode.dataValues.id
    })
    const shippingContainer = await db.Location.create({
      name: 'HMS NotPermitted',
      description: 'Shipping container',
      barcodeID: shippingContainerBarcode.dataValues.id,
    })

    for(let i = 0;i<=4;i++) {
      const shelfBarcode = await db.Barcode.create({
        barcodeCategoryID: loc_category_id.dataValues.id,
        parentBarcodeID: shippingContainerBarcode.dataValues.id,})
      const shelf = await db.Location.create({
        name: 'Shelf '+i,
        description: '',
        barcodeID: shelfBarcode.dataValues.id,
      })
      
      for(let j=1;j<=10;j++) {
        const boxBarcode = await db.Barcode.create({
          barcodeCategoryID: box_category_id.dataValues.id,
          parentBarcodeID: shelfBarcode.dataValues.id,})
        const box = await db.Box.create({
          name: 'Box '+(100*i+j).toString().padStart(3,"0"),
          description: '',
          barcodeID: boxBarcode.dataValues.id,
          
        })
      }
    }

    
    
    
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('Barcodes', null, {});
    await queryInterface.bulkDelete('Boxes', null, {});
    await queryInterface.bulkDelete('Locations', null, {});
    return queryInterface.bulkDelete('Traces', null, {});
  }
};
