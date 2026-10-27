'use strict';

// REQ 945 — assembly regenerate (a cad.read route) persists refreshed
// cachedProjections onto child parts only for a cad.write requester, and only
// onto children the requester has checked out or that no one has checked out.

const { authenticatedRequest, createTestPart, assignUserPermission } = require('../../helpers');
const { createTestUser } = require('../../setup');
const db = require('../../../models');
const assemblyRegenService = require('../../../services/assemblyRegenService');

const POLY = [[0, 0, 0], [10, 0, 0]];

function childSketchDoc() {
  return {
    nextSketchSeq: 2,
    sketches: {
      s1: {
        id: 's1', hostId: 'datum:xy_plane',
        state: {
          entities: [],
          constraints: [{ id: 'c1', type: 'on-edge', targets: [], externalRef: { scope: 'cross-part', sourceInstanceId: '__skeleton__', sourceGeomRef: { edgeId: 'asketch:s9/l1' } } }],
        },
        candidates: [],
      },
    },
  };
}

async function setup() {
  const owner = await authenticatedRequest();
  const childPart = await createTestPart();
  const child = (await owner.post(`/api/design/cad-model/by-part/${childPart.id}`).send({})).body;
  await db.DesignCADModel.update({ sketchDoc: childSketchDoc() }, { where: { id: child.id } });
  const asmPart = await createTestPart({ partCategoryID: 4 });
  const asm = (await owner.post(`/api/design/assembly/by-part/${asmPart.id}`).send({})).body;
  jest.spyOn(assemblyRegenService, 'regenerateAssembly').mockResolvedValue({
    faces: [], vertices: [], edges: [], bodies: [], instances: [], errors: [], skeleton: [],
    refProjections: { x: { partID: childPart.id, refs: [{ constraintId: 'c1', polyline: POLY }] } },
  });
  return { owner, child, asm };
}

const projectionOf = async (id) => {
  const row = await db.DesignCADModel.findByPk(id);
  return row.sketchDoc.sketches.s1.state.constraints[0].externalRef.cachedProjection || null;
};

describe('Assembly regenerate persistence (REQ 945)', () => {
  afterEach(() => jest.restoreAllMocks());

  test('a cad.read-only requester modifies no rows', async () => {
    const { child, asm } = await setup();
    const reader = await authenticatedRequest(await createTestUser({ displayName: 'Reader' }), { grantPermissions: false });
    const read = await db.Permission.findOne({ where: { resource: 'cad', action: 'read' } });
    await assignUserPermission(reader.user.id, read.id);
    const before = (await db.DesignCADModel.findByPk(child.id)).updatedAt;

    const res = await reader.post(`/api/design/assembly/${asm.id}/regenerate`).send({});
    expect(res.status).toBe(200);
    expect(await projectionOf(child.id)).toBeNull();
    expect((await db.DesignCADModel.findByPk(child.id)).updatedAt).toEqual(before);
  });

  test('a cad.write requester refreshes an un-checked-out child', async () => {
    const { owner, child, asm } = await setup();
    const res = await owner.post(`/api/design/assembly/${asm.id}/regenerate`).send({});
    expect(res.status).toBe(200);
    expect((await projectionOf(child.id)).edges).toEqual([{ polyline: POLY }]);
  });

  test('a child checked out by someone else (even expired) is skipped', async () => {
    const { owner, child, asm } = await setup();
    const other = await createTestUser({ displayName: 'Other Holder' });
    await db.DesignCADModel.update(
      { lockedByUserID: other.id, lockExpiresAt: new Date(Date.now() - 60_000) },
      { where: { id: child.id } },
    );
    await owner.post(`/api/design/assembly/${asm.id}/regenerate`).send({});
    expect(await projectionOf(child.id)).toBeNull();
  });
});
