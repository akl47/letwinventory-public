'use strict';

const TOOL_CATEGORIES = [
  { id: 1, name: 'Hand Tools' },
  { id: 2, name: 'Power Tools' },
  { id: 3, name: 'Mill Tools' },
  { id: 4, name: 'Lathe Tools' },
  { id: 5, name: 'General Purpose' },
];

const TOOL_SUBCATEGORIES = [
  // Hand Tools (1-7)
  { id: 1,  name: 'Hammer' },
  { id: 2,  name: 'Screwdriver' },
  { id: 3,  name: 'Wrench' },
  { id: 4,  name: 'Pliers' },
  { id: 5,  name: 'Hand Saw' },
  { id: 6,  name: 'File' },
  { id: 7,  name: 'Chisel' },
  // Power Tools (8-11)
  { id: 8,  name: 'Cordless Drill' },
  { id: 9,  name: 'Angle Grinder' },
  { id: 10, name: 'Circular Saw' },
  { id: 11, name: 'Sander' },
  // Cutting tools (12-36)
  { id: 12, name: 'Square End Mill' },
  { id: 13, name: 'Ball End Mill' },
  { id: 14, name: 'Bull Nose End Mill' },
  { id: 15, name: 'Chamfer Mill' },
  { id: 16, name: 'Tapered End Mill' },
  { id: 17, name: 'Roughing End Mill' },
  { id: 18, name: 'Lollipop Mill' },
  { id: 19, name: 'Dovetail Cutter' },
  { id: 20, name: 'T-Slot Cutter' },
  { id: 21, name: 'Woodruff Cutter' },
  { id: 22, name: 'Thread Mill' },
  { id: 23, name: 'V-Bit' },
  { id: 24, name: 'Face Mill' },
  { id: 25, name: 'Fly Cutter' },
  { id: 26, name: 'Slitting Saw' },
  { id: 27, name: 'Drill Bit' },
  { id: 28, name: 'Spot Drill' },
  { id: 29, name: 'Center Drill' },
  { id: 30, name: 'Step Drill' },
  { id: 31, name: 'Core Drill' },
  { id: 32, name: 'Counterbore' },
  { id: 33, name: 'Countersink' },
  { id: 34, name: 'Reamer' },
  { id: 35, name: 'Boring Bar / Boring Head' },
  { id: 36, name: 'Tap' },
];

// [categoryID, subcategoryID] pairs
const CATEGORY_SUBCATEGORY_LINKS = [
  // Hand Tools (1)
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7],
  // Power Tools (2)
  [2, 8], [2, 9], [2, 10], [2, 11],
  // Mill Tools (3)
  [3, 12], [3, 13], [3, 14], [3, 15], [3, 16], [3, 17], [3, 18], [3, 19], [3, 20], [3, 21],
  [3, 22], [3, 23], [3, 24], [3, 25], [3, 26],
  [3, 27], [3, 28], [3, 32], [3, 33], [3, 34], [3, 36],
  // Lathe Tools (4)
  [4, 35], [4, 27], [4, 29], [4, 34], [4, 36],
  // General Purpose (5)
  [5, 27], [5, 28], [5, 29], [5, 30], [5, 31], [5, 32], [5, 33], [5, 34], [5, 36],
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    await queryInterface.createTable('ToolCategories', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      description: { type: Sequelize.STRING(255) },
      activeFlag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.createTable('ToolSubcategories', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      description: { type: Sequelize.STRING(255) },
      activeFlag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.createTable('ToolCategorySubcategories', {
      toolCategoryID: {
        type: Sequelize.INTEGER, allowNull: false, primaryKey: true,
        references: { model: 'ToolCategories', key: 'id' },
        onDelete: 'CASCADE',
      },
      toolSubcategoryID: {
        type: Sequelize.INTEGER, allowNull: false, primaryKey: true,
        references: { model: 'ToolSubcategories', key: 'id' },
        onDelete: 'CASCADE',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.createTable('Tools', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      partID: {
        type: Sequelize.INTEGER, allowNull: false, unique: true,
        references: { model: 'Parts', key: 'id' },
      },
      toolSubcategoryID: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'ToolSubcategories', key: 'id' },
      },
      diameter:             { type: Sequelize.DECIMAL(10, 3) },
      overallLength:        { type: Sequelize.DECIMAL(10, 3) },
      fluteLength:          { type: Sequelize.DECIMAL(10, 3) },
      shankDiameter:        { type: Sequelize.DECIMAL(10, 3) },
      cornerRadius:         { type: Sequelize.DECIMAL(10, 3) },
      reducedShankDiameter: { type: Sequelize.DECIMAL(10, 3) },
      squareDriveSize:      { type: Sequelize.DECIMAL(10, 3) },
      numberOfSteps:        { type: Sequelize.INTEGER },
      stepDelta:            { type: Sequelize.DECIMAL(10, 3) },
      numberOfFlutes:       { type: Sequelize.INTEGER },
      tipAngle:             { type: Sequelize.DECIMAL(5, 2) },
      toolMaterial:         { type: Sequelize.STRING(64) },
      coating:              { type: Sequelize.STRING(64) },
      notes:                { type: Sequelize.TEXT },
      activeFlag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.bulkInsert(
      'ToolCategories',
      TOOL_CATEGORIES.map(c => ({ ...c, description: '', activeFlag: true, createdAt: now, updatedAt: now })),
    );
    await queryInterface.bulkInsert(
      'ToolSubcategories',
      TOOL_SUBCATEGORIES.map(s => ({ ...s, description: '', activeFlag: true, createdAt: now, updatedAt: now })),
    );
    await queryInterface.bulkInsert(
      'ToolCategorySubcategories',
      CATEGORY_SUBCATEGORY_LINKS.map(([catID, subID]) => ({
        toolCategoryID: catID, toolSubcategoryID: subID, createdAt: now,
      })),
    );

    // Permission seed: tools.read/write/delete (didn't exist before this feature)
    // plus the new admin.manage_tool_categories special action.
    await queryInterface.bulkInsert('Permissions', [
      { resource: 'tools', action: 'read', createdAt: now },
      { resource: 'tools', action: 'write', createdAt: now },
      { resource: 'tools', action: 'delete', createdAt: now },
      { resource: 'admin', action: 'manage_tool_categories', createdAt: now },
    ]);

    const [adminRows] = await queryInterface.sequelize.query(
      `SELECT id FROM "UserGroups" WHERE name = 'Admin' LIMIT 1`,
    );
    if (adminRows.length > 0) {
      const [permRows] = await queryInterface.sequelize.query(
        `SELECT id FROM "Permissions" WHERE (resource = 'tools' AND action IN ('read','write','delete')) OR (resource = 'admin' AND action = 'manage_tool_categories')`,
      );
      const groupPerms = permRows.map(p => ({
        groupID: adminRows[0].id,
        permissionID: p.id,
        createdAt: now,
      }));
      if (groupPerms.length > 0) {
        await queryInterface.bulkInsert('GroupPermissions', groupPerms);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM "GroupPermissions" WHERE "permissionID" IN (SELECT id FROM "Permissions" WHERE (resource = 'tools' AND action IN ('read','write','delete')) OR (resource = 'admin' AND action = 'manage_tool_categories'))`,
    );
    await queryInterface.sequelize.query(
      `DELETE FROM "Permissions" WHERE (resource = 'tools' AND action IN ('read','write','delete')) OR (resource = 'admin' AND action = 'manage_tool_categories')`,
    );
    await queryInterface.dropTable('Tools');
    await queryInterface.dropTable('ToolCategorySubcategories');
    await queryInterface.dropTable('ToolSubcategories');
    await queryInterface.dropTable('ToolCategories');
  },
};
