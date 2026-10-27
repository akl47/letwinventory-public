'use strict';

// REQ 965 — CAD API errors are human-readable and never leak raw database or
// kernel internals; constraint failures name the entity and field.

const { cadError } = require('../../../services/cadErrors');
const { KernelDisconnected, KernelRpcError } = require('../../../services/cadKernelClient');
const RestError = require('../../../util/RestError');
const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');

describe('CAD error mapping (REQ 965)', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test('RestError keeps its status, message and payload', () => {
    const e = new RestError('Branch is behind main', 409);
    e.payload = { code: 'X' };
    expect(cadError(e)).toEqual({ status: 409, body: { error: 'Branch is behind main', code: 'X' } });
  });

  test('kernel offline → 503 without transport details', () => {
    const r = cadError(new KernelDisconnected('connect ECONNREFUSED 10.0.0.5:9876'));
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/kernel is offline/);
    expect(r.body.error).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });

  test('kernel op failure keeps the authored message but no RPC code', () => {
    const r = cadError(new KernelRpcError('buildShell', -32603, 'buildShell crashed inside the geometry kernel'));
    expect(r.body.error).toMatch(/could not complete this operation: buildShell crashed/);
    expect(r.body.error).not.toMatch(/-32603|code/);
  });

  test('a unique-constraint error names the entity and field', () => {
    const err = { name: 'SequelizeUniqueConstraintError', message: 'Validation error', table: 'VcsRefs', errors: [{ path: 'name', message: 'name must be unique' }] };
    const r = cadError(err);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('A vcs ref with that name already exists');
    expect(r.body.error).not.toMatch(/^Validation error$/);
  });

  test('a validation error lists field messages', () => {
    const r = cadError({ name: 'SequelizeValidationError', message: 'Validation error', errors: [{ path: 'name', message: 'cannot be empty' }] });
    expect(r).toEqual({ status: 400, body: { error: 'Invalid name: cannot be empty' } });
  });

  test('raw database and programmer errors are replaced by the fallback', () => {
    const db = cadError({ name: 'SequelizeDatabaseError', message: 'relation "DesignCADModels" does not exist' }, 'Failed to fetch CAD model history');
    expect(db.body.error).toMatch(/^Failed to fetch CAD model history — a database error occurred/);
    expect(db.body.error).not.toMatch(/relation/);
    const te = cadError(new TypeError("Cannot read properties of undefined (reading 'features')"), 'Failed to update CAD model');
    expect(te.body.error).not.toMatch(/Cannot read properties/);
  });

  test('a route surfaces the mapped message (history endpoint, simulated DB failure)', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;
    jest.spyOn(db.DesignCADModelHistory, 'findAndCountAll').mockRejectedValueOnce(Object.assign(new Error('relation "x" does not exist'), { name: 'SequelizeDatabaseError' }));
    const res = await auth.get(`/api/design/cad-model/${model.id}/history`);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to fetch CAD model history/);
    expect(res.body.error).not.toMatch(/relation/);
  });
});
