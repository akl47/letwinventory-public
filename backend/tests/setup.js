const path = require('path');
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
  ]);

  // UnitOfMeasure
  await db.UnitOfMeasure.bulkCreate([
    { id: 1, name: 'Each' },
    { id: 2, name: 'Feet' },
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
  ]);

  // ElectricalPinTypes
  await db.ElectricalPinType.bulkCreate([
    { id: 1, name: 'Signal', activeFlag: true },
    { id: 2, name: 'Power', activeFlag: true },
  ]);

  // Permissions (9 resources x 3 actions + extras)
  const resources = ['tasks', 'projects', 'parts', 'inventory', 'equipment', 'orders', 'harness', 'requirements', 'admin'];
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
  await db.Permission.bulkCreate(permRows);

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
    'BarcodeHistory', 'Trace', 'Equipment', 'OrderItem', 'Order',
    'Box', 'Location', 'Barcode',
    'Part', 'UploadedFile', 'PushSubscription', 'Printer', 'ApiKeyPermission', 'ApiKey', 'RefreshToken', 'User',
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

async function createTestUser(overrides = {}) {
  const user = await db.User.create({
    googleID: overrides.googleID || 'google-test-' + Date.now(),
    displayName: overrides.displayName || 'Test User',
    email: overrides.email || `test-${Date.now()}@example.com`,
    activeFlag: true,
    ...overrides,
  });
  return user;
}

module.exports = { generateToken, createTestUser };
