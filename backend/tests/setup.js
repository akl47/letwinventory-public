const path = require('path');
const os = require('os');
const fs = require('fs');
const Sequelize = require('sequelize');
const jwt = require('jsonwebtoken');

// Set test environment variables before anything else
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key';
process.env.BACKEND_PORT = '3999';
process.env.FRONTEND_URL = 'http://localhost:4200';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3999/api/auth/google/callback';
process.env.FILE_STORAGE_PATH = path.join(os.tmpdir(), 'letwinventory-test-files');
fs.mkdirSync(process.env.FILE_STORAGE_PATH, { recursive: true });

// Create SQLite in-memory Sequelize instance
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: ':memory:',
  logging: false,
});

// Load all models from the models directory (same logic as models/index.js)
const modelsDir = path.join(__dirname, '..', 'models');
const db = {};

fs.readdirSync(modelsDir)
  .filter(group => group.indexOf('.') === -1)
  .forEach(group => {
    fs.readdirSync(path.join(modelsDir, group))
      .filter(file => file.indexOf('.') !== 0 && file.slice(-3) === '.js')
      .forEach(file => {
        const model = require(path.join(modelsDir, group, file))(sequelize, Sequelize.DataTypes);
        db[model.name] = model;
      });
  });

// Set up associations
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

// Set globals before app loads
global.db = db;
global.RestError = require('../util/RestError');
global._ = require('lodash');

// Seed reference data required by tests
async function seedReferenceData() {
  // BarcodeCategories
  await db.BarcodeCategory.bulkCreate([
    { id: 1, name: 'Part', prefix: 'AKL', tableName: 'Traces' },
    { id: 2, name: 'Location', prefix: 'LOC', tableName: 'Locations' },
    { id: 3, name: 'Box', prefix: 'BOX', tableName: 'Boxes' },
    { id: 4, name: 'Equipment', prefix: 'EQP', tableName: 'Equipment' },
  ]);

  // OrderStatuses
  await db.OrderStatus.bulkCreate([
    { id: 1, name: 'Draft', tagColor: '#808080', activeFlag: true },
    { id: 2, name: 'Placed', tagColor: '#2196F3', activeFlag: true },
    { id: 3, name: 'Shipped', tagColor: '#FF9800', activeFlag: true },
    { id: 4, name: 'Received', tagColor: '#4CAF50', activeFlag: true },
  ]);

  // OrderLineTypes
  await db.OrderLineType.bulkCreate([
    { id: 1, name: 'Standard', activeFlag: true },
    { id: 2, name: 'Shipping', activeFlag: true },
  ]);

  // PartCategories
  await db.PartCategory.bulkCreate([
    { id: 1, name: 'General', tagColorHex: '#808080', activeFlag: true },
    { id: 2, name: 'Electronic', tagColorHex: '#2196F3', activeFlag: true },
    { id: 3, name: 'Kit', tagColorHex: '#4CAF50', activeFlag: true },
    { id: 4, name: 'Assembly', tagColorHex: '#2196F3', activeFlag: true },
  ]);

  // UnitOfMeasure
  await db.UnitOfMeasure.bulkCreate([
    { id: 1, name: 'Each', allowDecimal: false },
    { id: 2, name: 'Feet', allowDecimal: true },
  ]);

  // TaskTypes
  await db.TaskType.bulkCreate([
    { id: 1, value: 'normal', label: 'Normal', colorClass: 'label-blue', activeFlag: true },
    { id: 2, value: 'tracking', label: 'Tracking', colorClass: 'label-green', activeFlag: true },
    { id: 3, value: 'critical_path', label: 'Critical Path', colorClass: 'label-red', activeFlag: true },
    { id: 4, value: 'scheduled', label: 'Scheduled', colorClass: 'label-purple', activeFlag: true },
  ]);

  // TaskHistoryActionTypes
  await db.TaskHistoryActionType.bulkCreate([
    { id: 1, code: 'CREATED', label: 'Created', activeFlag: true },
    { id: 2, code: 'ADD_TO_PROJECT', label: 'Added to Project', activeFlag: true },
    { id: 3, code: 'ADD_PRIORITY', label: 'Priority Changed', activeFlag: true },
    { id: 4, code: 'CHANGE_STATUS', label: 'Status Changed', activeFlag: true },
    { id: 5, code: 'MOVE_LIST', label: 'Moved to List', activeFlag: true },
  ]);

  // BarcodeHistoryActionTypes
  await db.BarcodeHistoryActionType.bulkCreate([
    { id: 1, code: 'CREATED', label: 'Created', activeFlag: true },
    { id: 2, code: 'MOVED', label: 'Moved', activeFlag: true },
    { id: 3, code: 'RECEIVED', label: 'Received', activeFlag: true },
    { id: 4, code: 'SPLIT', label: 'Split', activeFlag: true },
    { id: 5, code: 'MERGED', label: 'Merged', activeFlag: true },
    { id: 8, code: 'KITTED', label: 'Kitted to Assembly', activeFlag: true },
    { id: 9, code: 'UNKITTED', label: 'Unkitted from Assembly', activeFlag: true },
  ]);

  // ElectricalPinTypes
  await db.ElectricalPinType.bulkCreate([
    { id: 1, name: 'Signal', activeFlag: true },
    { id: 2, name: 'Power', activeFlag: true },
  ]);

  // Permissions (9 resources x 3 actions + extras)
  const resources = ['tasks', 'projects', 'parts', 'inventory', 'equipment', 'orders', 'harness', 'requirements', 'admin', 'manufacturing_planning', 'manufacturing_execution', 'tools'];
  const actions = ['read', 'write', 'delete'];
  let permId = 1;
  const permRows = [];
  for (const resource of resources) {
    for (const action of actions) {
      permRows.push({ id: permId++, resource, action });
    }
  }
  permRows.push({ id: permId++, resource: 'requirements', action: 'approve' });
  permRows.push({ id: permId++, resource: 'admin', action: 'impersonate' });
  permRows.push({ id: permId++, resource: 'manufacturing_execution', action: 'work_order_delete' });
  permRows.push({ id: permId++, resource: 'manufacturing_execution', action: 'work_order_undelete' });
  permRows.push({ id: permId++, resource: 'admin', action: 'manage_tool_categories' });
  await db.Permission.bulkCreate(permRows);

  // Tool Categories (5 broad groupings — must match migration seed)
  const TOOL_CATEGORIES = [
    { id: 1, name: 'Hand Tools' },
    { id: 2, name: 'Power Tools' },
    { id: 3, name: 'Mill Tools' },
    { id: 4, name: 'Lathe Tools' },
    { id: 5, name: 'General Purpose' },
  ];
  await db.ToolCategory.bulkCreate(
    TOOL_CATEGORIES.map(c => ({ ...c, description: '', activeFlag: true }))
  );

  // Tool Subcategories (36 leaves — must match migration seed)
  const TOOL_SUBCATEGORIES = [
    { id: 1, name: 'Hammer' }, { id: 2, name: 'Screwdriver' }, { id: 3, name: 'Wrench' },
    { id: 4, name: 'Pliers' }, { id: 5, name: 'Hand Saw' }, { id: 6, name: 'File' },
    { id: 7, name: 'Chisel' },
    { id: 8, name: 'Cordless Drill' }, { id: 9, name: 'Angle Grinder' },
    { id: 10, name: 'Circular Saw' }, { id: 11, name: 'Sander' },
    { id: 12, name: 'Square End Mill' }, { id: 13, name: 'Ball End Mill' },
    { id: 14, name: 'Bull Nose End Mill' }, { id: 15, name: 'Chamfer Mill' },
    { id: 16, name: 'Tapered End Mill' }, { id: 17, name: 'Roughing End Mill' },
    { id: 18, name: 'Lollipop Mill' }, { id: 19, name: 'Dovetail Cutter' },
    { id: 20, name: 'T-Slot Cutter' }, { id: 21, name: 'Woodruff Cutter' },
    { id: 22, name: 'Thread Mill' }, { id: 23, name: 'V-Bit' }, { id: 24, name: 'Face Mill' },
    { id: 25, name: 'Fly Cutter' }, { id: 26, name: 'Slitting Saw' },
    { id: 27, name: 'Drill Bit' }, { id: 28, name: 'Spot Drill' },
    { id: 29, name: 'Center Drill' }, { id: 30, name: 'Step Drill' },
    { id: 31, name: 'Core Drill' }, { id: 32, name: 'Counterbore' },
    { id: 33, name: 'Countersink' }, { id: 34, name: 'Reamer' },
    { id: 35, name: 'Boring Bar / Boring Head' }, { id: 36, name: 'Tap' },
  ];
  await db.ToolSubcategory.bulkCreate(
    TOOL_SUBCATEGORIES.map(s => ({ ...s, description: '', activeFlag: true }))
  );

  // Category ↔ Subcategory many-to-many links
  const LINKS = [
    [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7],
    [2, 8], [2, 9], [2, 10], [2, 11],
    [3, 12], [3, 13], [3, 14], [3, 15], [3, 16], [3, 17], [3, 18], [3, 19], [3, 20], [3, 21],
    [3, 22], [3, 23], [3, 24], [3, 25], [3, 26],
    [3, 27], [3, 28], [3, 32], [3, 33], [3, 34], [3, 36],
    [4, 35], [4, 27], [4, 29], [4, 34], [4, 36],
    [5, 27], [5, 28], [5, 29], [5, 30], [5, 31], [5, 32], [5, 33], [5, 34], [5, 36],
  ];
  await db.ToolCategorySubcategory.bulkCreate(
    LINKS.map(([catID, subID]) => ({ toolCategoryID: catID, toolSubcategoryID: subID }))
  );

  // Admin group with all permissions
  const adminGroup = await db.UserGroup.create({ id: 1, name: 'Admin', description: 'Full access' });
  const groupPermRows = permRows.map(p => ({ groupID: adminGroup.id, permissionID: p.id }));
  await db.GroupPermission.bulkCreate(groupPermRows);

  // Default group (no permissions)
  await db.UserGroup.create({ id: 2, name: 'Default', description: 'Default group for all new users' });
}

// Sync all models and seed reference data before all tests
beforeAll(async () => {
  await sequelize.sync({ force: true });
  await seedReferenceData();
});

// Clean up user-created data between tests (keep reference data)
afterEach(async () => {
  const tablesToClean = [
    'UserPermission', 'GroupPermission', 'UserGroupMember', 'UserGroup',
    'RequirementHistory', 'DesignRequirement', 'RequirementCategory',
    'HarnessRevisionHistory', 'WireHarness', 'WireEnd',
    'ElectricalComponent', 'Cable', 'Wire', 'ElectricalConnector',
    'TaskTimeTracking', 'TaskHistory', 'Task', 'ScheduledTask',
    'TaskList', 'Project',
    'BillOfMaterialItem',
    'Tool',
    'WorkOrderStepCompletion', 'WorkOrder',
    'EngineeringMasterHistory', 'EngineeringMasterBomItem', 'EngineeringMasterStepMarker', 'EngineeringMasterStepItem', 'EngineeringMasterStep', 'EngineeringMasterOutputPart', 'EngineeringMaster',
    'BarcodeHistory', 'Trace', 'Equipment', 'OrderItem', 'Order',
    'Box', 'Location', 'Barcode',
    'PartRevisionHistory', 'Part', 'UploadedFile', 'PushSubscription', 'Printer', 'ApiKeyPermission', 'ApiKey', 'RefreshToken', 'User',
  ];

  for (const table of tablesToClean) {
    if (db[table]) {
      await db[table].destroy({ where: {}, force: true });
    }
  }
});

afterAll(async () => {
  await sequelize.close();
});

// Export helpers for use in test files
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, displayName: user.displayName },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

let _testUserSeq = 0;
async function createTestUser(overrides = {}) {
  const seq = ++_testUserSeq;
  const user = await db.User.create({
    googleID: overrides.googleID || `google-test-${Date.now()}-${seq}`,
    displayName: overrides.displayName || 'Test User',
    email: overrides.email || `test-${Date.now()}-${seq}@example.com`,
    activeFlag: true,
    ...overrides,
  });
  return user;
}

module.exports = { generateToken, createTestUser };
