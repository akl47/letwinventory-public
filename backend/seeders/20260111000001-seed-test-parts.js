'use strict';
const db = require('../models');

/**
 * Seeds test parts with various configurations for testing different
 * combinations of serial number, lot number, UOM, and category settings.
 */
module.exports = {
    up: async (queryInterface, Sequelize) => {
        // Get category IDs
        const partCategory = await db.PartCategory.findOne({ where: { name: 'Part' } });
        const consumableCategory = await db.PartCategory.findOne({ where: { name: 'Consumable' } });
        const toolingCategory = await db.PartCategory.findOne({ where: { name: 'Tooling' } });

        if (!partCategory || !consumableCategory || !toolingCategory) {
            console.log('Part categories not found. Run part category seeder first.');
            return;
        }

        const partCategoryId = partCategory.dataValues.id;
        const consumableCategoryId = consumableCategory.dataValues.id;
        const toolingCategoryId = toolingCategory.dataValues.id;

        // Create test parts with different configurations
        const testParts = [
            // Serial number required parts
            {
                name: "TEST-SN-001",
                description: "Test Part - Serial Number Required",
                internalPart: true,
                vendor: "",
                partCategoryID: partCategoryId,
                minimumOrderQuantity: 1,
                serialNumberRequired: true,
                lotNumberRequired: false,
                defaultUnitOfMeasureID: 1, // ea
                createdAt: new Date(),
                updatedAt: new Date()
            },
            // Lot number required parts
            {
                name: "TEST-LOT-001",
                description: "Test Part - Lot Number Required",
                internalPart: false,
                vendor: "Test Vendor Inc",
                sku: "TV-LOT-001",
                partCategoryID: consumableCategoryId,
                minimumOrderQuantity: 100,
                serialNumberRequired: false,
                lotNumberRequired: true,
                defaultUnitOfMeasureID: 1, // ea
                createdAt: new Date(),
                updatedAt: new Date()
            },
            // Both serial and lot required
            {
                name: "TEST-BOTH-001",
                description: "Test Part - Both SN and Lot Required",
                internalPart: false,
                vendor: "Quality Parts Co",
                sku: "QPC-DUAL-001",
                link: "https://example.com/part/dual",
                partCategoryID: partCategoryId,
                minimumOrderQuantity: 10,
                serialNumberRequired: true,
                lotNumberRequired: true,
                defaultUnitOfMeasureID: 1, // ea
                createdAt: new Date(),
                updatedAt: new Date()
            },
            // Gallon UOM consumable
            {
                name: "TEST-GAL-001",
                description: "Test Consumable - Gallon UOM",
                internalPart: false,
                vendor: "Chemical Supply",
                sku: "CS-GAL-001",
                partCategoryID: consumableCategoryId,
                minimumOrderQuantity: 5,
                serialNumberRequired: false,
                lotNumberRequired: true,
                defaultUnitOfMeasureID: 2, // gal
                createdAt: new Date(),
                updatedAt: new Date()
            },
            // Gram UOM consumable
            {
                name: "TEST-GRAM-001",
                description: "Test Consumable - Gram UOM",
                internalPart: false,
                vendor: "Precision Materials",
                sku: "PM-GRAM-001",
                partCategoryID: consumableCategoryId,
                minimumOrderQuantity: 500,
                serialNumberRequired: false,
                lotNumberRequired: true,
                defaultUnitOfMeasureID: 3, // g
                createdAt: new Date(),
                updatedAt: new Date()
            },
            // Kilogram UOM part
            {
                name: "TEST-KG-001",
                description: "Test Part - Kilogram UOM",
                internalPart: false,
                vendor: "Heavy Materials Inc",
                sku: "HM-KG-001",
                partCategoryID: partCategoryId,
                minimumOrderQuantity: 25,
                serialNumberRequired: false,
                lotNumberRequired: false,
                defaultUnitOfMeasureID: 4, // kg
                createdAt: new Date(),
                updatedAt: new Date()
            },
            // Tooling with serial number
            {
                name: "TEST-TOOL-001",
                description: "Test Tooling - With Serial Number",
                internalPart: true,
                vendor: "",
                partCategoryID: toolingCategoryId,
                minimumOrderQuantity: 1,
                serialNumberRequired: true,
                lotNumberRequired: false,
                defaultUnitOfMeasureID: 1, // ea
                createdAt: new Date(),
                updatedAt: new Date()
            },
            // External tooling
            {
                name: "TEST-TOOL-002",
                description: "Test Tooling - External Vendor",
                internalPart: false,
                vendor: "Tool Masters",
                sku: "TM-TOOL-002",
                link: "https://example.com/tools/002",
                partCategoryID: toolingCategoryId,
                minimumOrderQuantity: 1,
                serialNumberRequired: true,
                lotNumberRequired: false,
                defaultUnitOfMeasureID: 1, // ea
                createdAt: new Date(),
                updatedAt: new Date()
            },
            // High MOQ part
            {
                name: "TEST-HIGHMQ-001",
                description: "Test Part - High Min Order Qty",
                internalPart: false,
                vendor: "Bulk Supply",
                sku: "BS-HIGH-001",
                partCategoryID: partCategoryId,
                minimumOrderQuantity: 1000,
                serialNumberRequired: false,
                lotNumberRequired: true,
                defaultUnitOfMeasureID: 1, // ea
                createdAt: new Date(),
                updatedAt: new Date()
            },
            // No tracking required part
            {
                name: "TEST-NOTRACK-001",
                description: "Test Part - No Tracking Required",
                internalPart: true,
                vendor: "",
                partCategoryID: partCategoryId,
                minimumOrderQuantity: 1,
                serialNumberRequired: false,
                lotNumberRequired: false,
                defaultUnitOfMeasureID: 1, // ea
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ];

        // Insert test parts
        await queryInterface.bulkInsert('Parts', testParts, { ignoreDuplicates: true });
        console.log(`Created ${testParts.length} test parts`);
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.bulkDelete('Parts', {
            name: {
                [Sequelize.Op.like]: 'TEST-%'
            }
        });
    }
};
