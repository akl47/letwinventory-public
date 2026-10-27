'use strict';

// REQ 965 — human-readable CAD API errors. Raw database / kernel internals are
// never sent to the client; they are logged server-side instead.
//
//   RestError / plain Error  → its message (code-authored, user-facing text)
//   Sequelize unique / FK / validation → a message naming the entity + field
//   KernelDisconnected       → 503 "kernel offline"
//   KernelRpcError           → kernel's own (authored) message, no RPC codes
//   anything else (TypeError, DatabaseError, …) → `${fallback}` + generic text

const { KernelDisconnected, KernelRpcError } = require('./cadKernelClient');

const PROGRAMMER_ERRORS = new Set(['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError']);

function humanize(name) {
  return String(name || 'record')
    .replace(/^Design/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/s$/, '')
    .toLowerCase();
}

function describeSequelize(err) {
  if (err.name === 'SequelizeUniqueConstraintError') {
    const e = (err.errors && err.errors[0]) || {};
    const entity = humanize((e.instance && e.instance.constructor && e.instance.constructor.name) || err.table);
    const field = e.path || (err.fields && Object.keys(err.fields)[0]) || 'value';
    return { status: 409, error: `A ${entity} with that ${field} already exists` };
  }
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    const field = (Array.isArray(err.fields) ? err.fields[0] : err.fields && Object.keys(err.fields)[0]) || err.index || 'reference';
    return { status: 409, error: `The ${humanize(err.table)} ${field} refers to a record that does not exist or is still in use` };
  }
  if (err.name === 'SequelizeValidationError') {
    const parts = (err.errors || []).map((e) => `${e.path}: ${e.message}`);
    return { status: 400, error: parts.length ? `Invalid ${parts.join('; ')}` : 'The submitted data is invalid' };
  }
  return null;
}

/** → { status, body } for an error caught in a CAD handler. */
function cadError(err, fallback = 'The CAD operation failed', { kernelStatus = 500 } = {}) {
  if (err instanceof KernelDisconnected) {
    return { status: 503, body: { error: 'The CAD geometry kernel is offline — try again in a moment' } };
  }
  if (err instanceof KernelRpcError) {
    console.error('[cad] kernel error', err.code, err.message);
    return { status: kernelStatus, body: { error: `The geometry kernel could not complete this operation: ${err.kernelMessage || err.message}` } };
  }
  if (err && err.statusCode) {
    return { status: err.statusCode, body: { error: err.message, ...(err.payload || {}) } };
  }
  if (err && typeof err.name === 'string' && err.name.startsWith('Sequelize')) {
    const mapped = describeSequelize(err);
    console.error('[cad] database error', err.name, err.message);
    if (mapped) return { status: mapped.status, body: { error: mapped.error } };
    return { status: 500, body: { error: `${fallback} — a database error occurred; please try again` } };
  }
  if (!err || PROGRAMMER_ERRORS.has(err.name) || !err.message) {
    console.error('[cad] unexpected error', err);
    return { status: 500, body: { error: `${fallback} — an unexpected error occurred; please try again` } };
  }
  // Plain Error: thrown by our own services with user-facing wording.
  return { status: 500, body: { error: fallback === 'The CAD operation failed' ? err.message : `${fallback}: ${err.message}` } };
}

function sendCadError(res, err, fallback, opts) {
  const { status, body } = cadError(err, fallback, opts);
  return res.status(status).json(body);
}

module.exports = { cadError, sendCadError };
