const createError = require('http-errors');

const FIELD_LABELS = {
  name: 'name',
  partID: 'part',
  partCategoryID: 'category',
  defaultUnitOfMeasureID: 'unit of measure',
  componentPartID: 'component part',
  parentRequirementID: 'parent requirement',
  imageFileID: 'image',
  engineeringMasterID: 'engineering master',
  workOrderID: 'work order',
  stepID: 'step',
  barcodeID: 'barcode',
  locationID: 'location',
  userID: 'user',
  groupID: 'group',
  permissionID: 'permission',
  unitOfMeasureID: 'unit of measure',
  previousRevisionID: 'previous revision',
};

function fieldLabel(path) {
  if (!path) return 'field';
  return FIELD_LABELS[path] || path.replace(/ID$/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();
}

function humanizeError(error, context) {
  if (!error) {
    return createError(500, context || 'Unknown error');
  }
  const prefix = context ? `${context}: ` : '';

  if (error.name === 'SequelizeUniqueConstraintError') {
    const errs = error.errors || [];
    if (errs.length > 0) {
      const parts = errs.map(e => `${fieldLabel(e.path)} "${e.value}"`);
      return createError(409, `${prefix}A record with this ${parts.join(' and ')} already exists.`);
    }
    return createError(409, `${prefix}A record with these values already exists.`);
  }

  if (error.name === 'SequelizeValidationError') {
    const errs = error.errors || [];
    const messages = errs.map(e => {
      if (e.type === 'notNull Violation' || e.validatorKey === 'is_null') {
        return `${fieldLabel(e.path)} is required.`;
      }
      if (e.validatorKey === 'len') {
        return `${fieldLabel(e.path)} length is invalid.`;
      }
      return `${fieldLabel(e.path)}: ${e.message}`;
    });
    return createError(400, `${prefix}${messages.join(' ') || error.message}`);
  }

  if (error.name === 'SequelizeForeignKeyConstraintError') {
    const field = error.fields ? Object.keys(error.fields)[0] : error.index;
    const label = field ? fieldLabel(field) : 'referenced record';
    return createError(400, `${prefix}The ${label} does not exist or is no longer available.`);
  }

  if (error.name === 'SequelizeDatabaseError') {
    return createError(400, `${prefix}${error.original?.message || error.message}`);
  }

  if (error.status && error.status >= 400 && error.status < 600) {
    return error;
  }

  return createError(500, `${prefix}${error.message || 'Unexpected error'}`);
}

module.exports = humanizeError;
