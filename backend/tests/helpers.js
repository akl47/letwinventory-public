const request = require('supertest');
const { generateToken, createTestUser } = require('./setup');

let _app;
function getApp() {
  if (!_app) {
    _app = require('./app');
  }
  return _app;
}

/**
 * Create authenticated supertest agent with Bearer token
 */
async function authenticatedRequest(user) {
  if (!user) {
    user = await createTestUser();
  }
  const token = generateToken(user);
  const app = getApp();
  return {
    agent: request(app),
    token,
    user,
    // Shorthand methods with auth header
    get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url) => request(app).post(url).set('Authorization', `Bearer ${token}`),
    put: (url) => request(app).put(url).set('Authorization', `Bearer ${token}`),
    delete: (url) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
  };
}

// --- Factories ---

async function createTestPart(overrides = {}) {
  return db.Part.create({
    name: `Test Part ${Date.now()}`,
    description: 'A test part',
    internalPart: false,
    vendor: 'Test Vendor',
    minimumOrderQuantity: 1,
    partCategoryID: 1,
    activeFlag: true,
    ...overrides,
  });
}

let _barcodeCounter = 0;
async function createTestBarcode(overrides = {}) {
  _barcodeCounter++;
  const catId = overrides.barcodeCategoryID || 1;
  const prefixMap = { 1: 'AKL', 2: 'LOC', 3: 'BOX', 4: 'EQP' };
  const prefix = prefixMap[catId] || 'TST';
  return db.Barcode.create({
    barcode: overrides.barcode || `${prefix}-T${_barcodeCounter.toString(16).padStart(6, '0').toUpperCase()}`,
    barcodeCategoryID: catId,
    parentBarcodeID: overrides.parentBarcodeID || 0,
    activeFlag: true,
    ...overrides,
  });
}

async function createTestLocation(overrides = {}) {
  const barcode = await createTestBarcode({ barcodeCategoryID: 2 });
  return db.Location.create({
    name: overrides.name || 'LOC-TEST',
    description: overrides.description || 'Test location',
    barcodeID: barcode.id,
    activeFlag: true,
    ...overrides,
  });
}

async function createTestOrder(overrides = {}) {
  return db.Order.create({
    description: 'Test Order',
    vendor: 'Test Vendor',
    orderStatusID: 1,
    activeFlag: true,
    ...overrides,
  });
}

async function createTestOrderItem(overrides = {}) {
  let orderId = overrides.orderID;
  if (!orderId) {
    const order = await createTestOrder();
    orderId = order.id;
  }
  let partId = overrides.partID;
  if (!partId) {
    const part = await createTestPart();
    partId = part.id;
  }
  return db.OrderItem.create({
    orderID: orderId,
    partID: partId,
    orderLineTypeID: 1,
    lineNumber: overrides.lineNumber || 1,
    quantity: overrides.quantity || 1,
    price: overrides.price || 10.00,
    activeFlag: true,
    ...overrides,
  });
}

async function createTestEquipment(overrides = {}) {
  const barcode = await createTestBarcode({ barcodeCategoryID: 4 });
  return db.Equipment.create({
    name: overrides.name || 'Test Equipment',
    barcodeID: barcode.id,
    activeFlag: true,
    ...overrides,
  });
}

async function createTestTaskList(overrides = {}) {
  return db.TaskList.create({
    name: overrides.name || 'Test List',
    order: overrides.order || 0,
    activeFlag: true,
    ...overrides,
  });
}

async function createTestProject(user, overrides = {}) {
  return db.Project.create({
    name: overrides.name || `Project ${Date.now()}`,
    shortName: overrides.shortName || 'TST',
    tagColorHex: overrides.tagColorHex || 'FF0000',
    ownerUserID: user.id,
    activeFlag: true,
    ...overrides,
  });
}

async function createTestTask(user, overrides = {}) {
  let taskListId = overrides.taskListID;
  if (!taskListId) {
    const list = await createTestTaskList();
    taskListId = list.id;
  }
  return db.Task.create({
    name: overrides.name || 'Test Task',
    ownerUserID: user.id,
    taskListID: taskListId,
    rank: overrides.rank || 1000,
    activeFlag: true,
    doneFlag: false,
    ...overrides,
  });
}

async function createTestFile(overrides = {}) {
  return db.UploadedFile.create({
    filename: overrides.filename || 'test-file.png',
    mimeType: overrides.mimeType || 'image/png',
    data: overrides.data || 'data:image/png;base64,iVBORw0KGgo=',
    activeFlag: true,
    ...overrides,
  });
}

async function createTestConnector(overrides = {}) {
  return db.ElectricalConnector.create({
    label: overrides.label || 'J1',
    type: overrides.type || 'male',
    pinCount: overrides.pinCount || 4,
    pins: overrides.pins || [
      { id: 1, number: 1, label: 'Pin 1' },
      { id: 2, number: 2, label: 'Pin 2' },
      { id: 3, number: 3, label: 'Pin 3' },
      { id: 4, number: 4, label: 'Pin 4' },
    ],
    activeFlag: true,
    ...overrides,
  });
}

async function createTestWire(overrides = {}) {
  return db.Wire.create({
    label: overrides.label || 'W1',
    color: overrides.color || 'Red',
    activeFlag: true,
    ...overrides,
  });
}

async function createTestCable(overrides = {}) {
  return db.Cable.create({
    label: overrides.label || 'CABLE-A',
    wireCount: overrides.wireCount || 2,
    wires: overrides.wires || [
      { id: 1, color: 'Red', colorCode: 'RD' },
      { id: 2, color: 'Black', colorCode: 'BK' },
    ],
    activeFlag: true,
    ...overrides,
  });
}

async function createTestComponent(overrides = {}) {
  return db.ElectricalComponent.create({
    label: overrides.label || 'U1',
    pinCount: overrides.pinCount || 2,
    pins: overrides.pins || [
      { id: 1, name: 'Group1', pins: [{ id: 1, number: 1, label: 'Pin 1' }] },
    ],
    activeFlag: true,
    ...overrides,
  });
}

async function createTestHarness(overrides = {}) {
  return db.WireHarness.create({
    name: overrides.name || `Harness ${Date.now()}`,
    revision: overrides.revision || 'A',
    harnessData: overrides.harnessData || {},
    releaseState: overrides.releaseState || 'draft',
    activeFlag: true,
    ...overrides,
  });
}

async function createTestWireEnd(overrides = {}) {
  return db.WireEnd.create({
    code: overrides.code || `te-${Date.now()}`,
    name: overrides.name || 'Test End',
    activeFlag: true,
    ...overrides,
  });
}

module.exports = {
  getApp,
  authenticatedRequest,
  createTestUser,
  createTestPart,
  createTestBarcode,
  createTestLocation,
  createTestOrder,
  createTestOrderItem,
  createTestEquipment,
  createTestTaskList,
  createTestProject,
  createTestTask,
  createTestFile,
  createTestConnector,
  createTestWire,
  createTestCable,
  createTestComponent,
  createTestHarness,
  createTestWireEnd,
};
