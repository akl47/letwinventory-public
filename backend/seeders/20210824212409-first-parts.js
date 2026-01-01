'use strict';
const db = require('../models'); // Assuming migrations is next to models


module.exports = {
  up: async (queryInterface, Sequelize) => {
    let part_category_id = await db.PartCategory.findOne({
      where: {
        name: 'Part'
      }
    })
    let consumables_category_id = await db.PartCategory.findOne({
      where: {
        name: 'Consumable'
      }
    })
    let tooling_category_id = await db.PartCategory.findOne({
      where: {
        name: 'Tooling'
      }
    })

    return queryInterface.bulkInsert('Parts', [{
      name: "000000",
      description: "Dummy Part 000000",
      internalPart: true,
      vendor: "",
      partCategoryID: part_category_id.dataValues.id,
      minimumOrderQuantity: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      name: "000001",
      description: "Dummy Part 000001",
      internalPart: true,
      vendor: "",
      partCategoryID: part_category_id.dataValues.id,
      minimumOrderQuantity: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      name: "000002",
      description: "Dummy Part 000002",
      internalPart: true,
      vendor: "",
      partCategoryID: consumables_category_id.dataValues.id,
      minimumOrderQuantity: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      name: "000003",
      description: "Dummy Part 000003",
      internalPart: true,
      vendor: "",
      partCategoryID: part_category_id.dataValues.id,
      minimumOrderQuantity: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      name: "000004",
      description: "Dummy Part 000004",
      internalPart: true,
      vendor: "",
      partCategoryID: tooling_category_id.dataValues.id,
      minimumOrderQuantity: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      name: "000005",
      description: "Dummy Part 000005",
      internalPart: true,
      vendor: "",
      partCategoryID: part_category_id.dataValues.id,
      minimumOrderQuantity: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      name: "000006",
      description: "Dummy Part 000006",
      internalPart: true,
      vendor: "",
      partCategoryID: part_category_id.dataValues.id,
      minimumOrderQuantity: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      name: "000007",
      description: "Dummy Part 000007",
      internalPart: true,
      vendor: "",
      partCategoryID: part_category_id.dataValues.id,
      minimumOrderQuantity: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      name: "000008",
      description: "Dummy Part 000008",
      internalPart: true,
      vendor: "",
      partCategoryID: part_category_id.dataValues.id,
      minimumOrderQuantity: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      name: "000009",
      description: "Dummy Part 000009",
      internalPart: true,
      vendor: "",
      partCategoryID: part_category_id.dataValues.id,
      minimumOrderQuantity: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      name: "000010",
      description: "Dummy Part 000010",
      internalPart: true,
      vendor: "",
      partCategoryID: part_category_id.dataValues.id,
      minimumOrderQuantity: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    ])

  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('Parts', null, {});
  }
};
