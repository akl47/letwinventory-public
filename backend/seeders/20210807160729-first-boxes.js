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
    console.log("earth barcode", earthBarcode.dataValues)
    const earth = await db.Location.create({
      name: 'Earth',
      description: 'Pale Blue Dot',
      barcodeID: earthBarcode.dataValues.id,

    })
    console.log("6")
    console.log("loc_category_id", loc_category_id.dataValues.id)
    console.log("earth barcode", earthBarcode.dataValues.id)
    const homeBarcode = await db.Barcode.create({
      barcodeCategoryID: loc_category_id.dataValues.id,
      parentBarcodeID: earthBarcode.dataValues.id
    })
    console.log("7")
    const home = await db.Location.create({
      name: 'Home',
      description: '',
      barcodeID: homeBarcode.dataValues.id,

    })
    console.log("8")
    const workbenchBarcode = await db.Barcode.create({
      barcodeCategoryID: loc_category_id.dataValues.id,
      parentBarcodeID: homeBarcode.dataValues.id
    })
    console.log("9")
    const workbench = await db.Location.create({
      name: 'Workbench',
      description: '',
      barcodeID: workbenchBarcode.dataValues.id,
    })

    for (let i = 0; i <= 4; i++) {
      console.log('Shelf ' + i)
      const shelfBarcode = await db.Barcode.create({
        barcodeCategoryID: loc_category_id.dataValues.id,
        parentBarcodeID: workbenchBarcode.dataValues.id,
      })
      const shelf = await db.Location.create({
        name: 'Shelf ' + i,
        description: '',
        barcodeID: shelfBarcode.dataValues.id,
      })

      for (let j = 1; j <= 10; j++) {
        console.log("box " + j)
        const boxBarcode = await db.Barcode.create({
          barcodeCategoryID: box_category_id.dataValues.id,
          parentBarcodeID: shelfBarcode.dataValues.id,
        })
        const box = await db.Box.create({
          name: 'Box ' + (100 * i + j).toString().padStart(3, "0"),
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
