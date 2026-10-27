'use strict';

// REQ 960 — assembly BOM sync is transactional, refuses a released (locked)
// Part, and replaces only rows it previously synced (manual rows survive).

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');

async function setup() {
  const auth = await authenticatedRequest();
  const comp = await createTestPart();
  await auth.post(`/api/design/cad-model/by-part/${comp.id}`).send({});
  const asmPart = await createTestPart({ partCategoryID: 4 });
  const asm = (await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({})).body;
  await auth.post(`/api/design/cad-model/${asm.id}/checkout`).send({});
  await auth.post(`/api/design/assembly/${asm.id}/instances`).send({ partID: comp.id });
  await auth.post(`/api/design/assembly/${asm.id}/instances`).send({ partID: comp.id });
  return { auth, comp, asmPart, id: asm.id };
}

describe('Assembly BOM sync (REQ 960)', () => {
  test('preserves manually entered rows and replaces its own on re-sync', async () => {
    const { auth, comp, asmPart, id } = await setup();
    const manualComp = await createTestPart();
    await db.BillOfMaterialItem.create({ partID: asmPart.id, componentPartID: manualComp.id, quantity: 4, activeFlag: true });

    const first = await auth.post(`/api/design/assembly/${id}/bom/sync`).send({});
    expect(first.status).toBe(200);
    expect(first.body.items).toEqual([{ componentPartID: comp.id, quantity: 2 }]);
    await auth.post(`/api/design/assembly/${id}/bom/sync`).send({});

    const rows = await db.BillOfMaterialItem.findAll({ where: { partID: asmPart.id } });
    expect(rows.filter((r) => r.componentPartID === manualComp.id)).toHaveLength(1); // manual row kept
    expect(rows.filter((r) => r.componentPartID === comp.id)).toHaveLength(1);       // no duplicate
    expect(rows.find((r) => r.componentPartID === comp.id).syncedFromAssemblyID).toBe(id);
  });

  test('refuses to change the BOM of a revision-locked (released) Part', async () => {
    const { auth, asmPart, id } = await setup();
    await asmPart.update({ revisionLocked: true });
    const res = await auth.post(`/api/design/assembly/${id}/bom/sync`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/is released, so its bill of materials cannot be changed/);
    expect(await db.BillOfMaterialItem.count({ where: { partID: asmPart.id } })).toBe(0);
  });

  test('a failure mid-sync leaves the previous BOM intact', async () => {
    const { auth, comp, asmPart, id } = await setup();
    await auth.post(`/api/design/assembly/${id}/bom/sync`).send({});
    jest.spyOn(db.BillOfMaterialItem, 'bulkCreate').mockRejectedValueOnce(new Error('boom'));
    const res = await auth.post(`/api/design/assembly/${id}/bom/sync`).send({});
    expect(res.status).toBe(500);
    const rows = await db.BillOfMaterialItem.findAll({ where: { partID: asmPart.id } });
    expect(rows.map((r) => r.componentPartID)).toEqual([comp.id]);
    jest.restoreAllMocks();
  });
});
