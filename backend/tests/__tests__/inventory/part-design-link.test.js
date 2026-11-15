'use strict';

// REQ 1072 — the parts list reports the design each part has, for the
// catalog's quick link.

const { authenticatedRequest, createTestPart, createTestHarness } = require('../../helpers');
const db = require('../../../models');

async function listed(auth, part) {
  const res = await auth.get('/api/inventory/part');
  expect(res.status).toBe(200);
  return res.body.find((p) => p.id === part.id);
}

describe('Part design link', () => {
  it('reports no design for a plain part', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    expect((await listed(auth, part)).design).toBeNull();
  });

  it('reports a CAD model and an assembly by kind', async () => {
    const auth = await authenticatedRequest();
    const cadPart = await createTestPart();
    const asmPart = await createTestPart();
    const cad = await db.DesignCADModel.create({ partID: cadPart.id, createdByUserID: auth.user.id });
    const asm = await db.DesignCADModel.create({ partID: asmPart.id, createdByUserID: auth.user.id, isAssembly: true });
    expect((await listed(auth, cadPart)).design).toEqual({ kind: 'cad', id: cad.id });
    expect((await listed(auth, asmPart)).design).toEqual({ kind: 'assembly', id: asm.id });
  });

  it('ignores a deleted CAD model', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    await db.DesignCADModel.create({ partID: part.id, createdByUserID: auth.user.id, activeFlag: false });
    expect((await listed(auth, part)).design).toBeNull();
  });

  it('reports the most recently updated harness of a part', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const older = await createTestHarness({ name: 'Rev 01', partID: part.id });
    const newer = await createTestHarness({ name: 'Rev 02', partID: part.id });
    await db.WireHarness.update({ updatedAt: new Date(Date.now() - 60000) }, { where: { id: older.id }, silent: true });
    await createTestHarness({ name: 'Deleted', partID: part.id, activeFlag: false });
    expect((await listed(auth, part)).design).toEqual({ kind: 'harness', id: newer.id });
  });
});
