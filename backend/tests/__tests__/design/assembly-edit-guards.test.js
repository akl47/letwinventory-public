'use strict';

// REQ 942 — every mutating assembly endpoint enforces the REQ 914 guards
// (main protected, caller's unexpired checkout, releaseLocked, DOC_CONFLICT)
// and bumps lastContentSavedAt. REQ 961 — instance placements are validated.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const { createTestUser } = require('../../setup');
const db = require('../../../models');

const A = (id, p = '') => `/api/design/assembly/${id}${p}`;
const C = (id, p = '') => `/api/design/cad-model/${id}${p}`;

async function setup() {
  const auth = await authenticatedRequest();
  const comp = await createTestPart();
  await auth.post(`/api/design/cad-model/by-part/${comp.id}`).send({});
  const asmPart = await createTestPart({ partCategoryID: 4 });
  const asm = (await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({})).body;
  return { auth, comp, id: asm.id };
}

// Every mutating route, given an assembly holding instance i1 (and mate m1 /
// pattern p1 / display state ds1 where the route needs one).
const ROUTES = [
  ['PUT doc', (r, id) => r.put(A(id)).send({ name: 'renamed' })],
  ['insert instance', (r, id, comp) => r.post(A(id, '/instances')).send({ partID: comp.id })],
  ['update instance', (r, id) => r.put(A(id, '/instances/i1')).send({ visible: false })],
  ['remove instance', (r, id) => r.delete(A(id, '/instances/i1'))],
  ['replace instance', (r, id, comp) => r.put(A(id, '/instances/i1/replace')).send({ partID: comp.id })],
  ['add pattern', (r, id) => r.post(A(id, '/patterns')).send({ kind: 'linear', seedInstanceId: 'i1', count: 2 })],
  ['remove pattern', (r, id) => r.delete(A(id, '/patterns/p1'))],
  ['add mate', (r, id) => r.post(A(id, '/mates')).send({ type: 'origin', a: { instanceId: 'i1' } })],
  ['update mate', (r, id) => r.put(A(id, '/mates/m1')).send({ value: 3 })],
  ['remove mate', (r, id) => r.delete(A(id, '/mates/m1'))],
  ['auto explode', (r, id) => r.post(A(id, '/explode/auto')).send({})],
  ['set explode', (r, id) => r.put(A(id, '/explode')).send({ factor: 0.5 })],
  ['save display state', (r, id) => r.post(A(id, '/display-states')).send({ name: 'S' })],
  ['apply display state', (r, id) => r.post(A(id, '/display-states/ds1/apply')).send({})],
  ['delete display state', (r, id) => r.delete(A(id, '/display-states/ds1'))],
];

// Seed an assembly doc with one of everything, directly (bypassing the guards).
async function seedDoc(id, compId) {
  const row = await db.DesignCADModel.findByPk(id);
  await row.update({
    assemblyDoc: {
      ...row.assemblyDoc,
      instances: [{ instanceId: 'i1', partID: compId, ref: { kind: 'cad' }, grounded: true, placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] }, suppressed: false, visible: true }],
      mates: [{ mateId: 'm1', id: 'm1', type: 'distance', a: { instanceId: 'i1', faceId: 'f' }, b: { instanceId: 'i1', faceId: 'g' }, value: 1 }],
      patterns: [{ patternId: 'p1', kind: 'linear', seedInstanceId: 'i1', count: 2, spacing: [10, 0, 0] }],
      displayStates: [{ id: 'ds1', name: 'S', hidden: [] }],
      nextInstanceSeq: 2, nextMateSeq: 2, nextPatternSeq: 2, nextDisplayStateSeq: 2,
    },
  });
}

describe('Assembly edit guards (REQ 942)', () => {
  test.each(ROUTES)('%s requires a checkout (423 when not checked out)', async (_name, call) => {
    const { auth, comp, id } = await setup();
    await seedDoc(id, comp.id);
    const res = await call(auth, id, comp);
    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/Check out assembly/);
  });

  test.each(ROUTES)('%s is refused while another user holds the checkout', async (_name, call) => {
    const { auth, comp, id } = await setup();
    await seedDoc(id, comp.id);
    const other = await authenticatedRequest(await createTestUser({ displayName: 'Holder' }));
    expect((await other.post(C(id, '/checkout')).send({})).status).toBe(200);
    const res = await call(auth, id, comp);
    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/checked out by Holder/);
  });

  test.each(ROUTES)('%s is refused on the protected main branch', async (_name, call) => {
    const { auth, comp, id } = await setup();
    await seedDoc(id, comp.id);
    await auth.post(C(id, '/checkout')).send({});
    await db.DesignCADModel.update({ branchName: 'main' }, { where: { id } });
    const res = await call(auth, id, comp);
    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/main branch is protected/);
  });

  test('an expired checkout is refused with LOCK_EXPIRED', async () => {
    const { auth, comp, id } = await setup();
    await auth.post(C(id, '/checkout')).send({});
    await db.DesignCADModel.update({ lockExpiresAt: new Date(Date.now() - 1000) }, { where: { id } });
    const res = await auth.post(A(id, '/instances')).send({ partID: comp.id });
    expect(res.status).toBe(423);
    expect(res.body.code).toBe('LOCK_EXPIRED');
  });

  test('a release-locked assembly is read-only', async () => {
    const { auth, comp, id } = await setup();
    await auth.post(C(id, '/checkout')).send({});
    await db.DesignCADModel.update({ releaseLocked: true }, { where: { id } });
    const res = await auth.post(A(id, '/instances')).send({ partID: comp.id });
    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/released and read-only/);
  });

  test('a stale clientSavedAt is refused with DOC_CONFLICT', async () => {
    const { auth, comp, id } = await setup();
    await auth.post(C(id, '/checkout')).send({});
    const first = await auth.post(A(id, '/instances')).send({ partID: comp.id });
    expect(first.status).toBe(201);
    const stale = await auth.post(A(id, '/instances')).send({ partID: comp.id, clientSavedAt: null });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('DOC_CONFLICT');
  });

  test('a successful edit bumps lastContentSavedAt', async () => {
    const { auth, comp, id } = await setup();
    await auth.post(C(id, '/checkout')).send({});
    const before = (await db.DesignCADModel.findByPk(id)).lastContentSavedAt;
    const res = await auth.post(A(id, '/instances')).send({ partID: comp.id });
    expect(res.status).toBe(201);
    const after = res.body.assembly.lastContentSavedAt;
    expect(after).toBeTruthy();
    expect(after).not.toEqual(before ? new Date(before).toISOString() : null);
  });
});

describe('Instance placement validation (REQ 961)', () => {
  test.each([
    [{ translate: [1, 'x', 0], quaternion: [0, 0, 0, 1] }, /placement\.translate/],
    [{ translate: [1, 2], quaternion: [0, 0, 0, 1] }, /placement\.translate/],
    [{ translate: [0, 0, 0], quaternion: [0, 0, 0] }, /placement\.quaternion/],
    [{ translate: [0, 0, 0], quaternion: [0, 0, 0, 0] }, /all zeros/],
    ['nope', /placement must be an object/],
  ])('rejects %j with a 400 naming the field', async (placement, msg) => {
    const { auth, comp, id } = await setup();
    await auth.post(C(id, '/checkout')).send({});
    const res = await auth.post(A(id, '/instances')).send({ partID: comp.id, placement });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(msg);
  });

  test('normalizes a non-unit quaternion', async () => {
    const { auth, comp, id } = await setup();
    await auth.post(C(id, '/checkout')).send({});
    const res = await auth.post(A(id, '/instances')).send({ partID: comp.id, placement: { translate: [1, 2, 3], quaternion: [0, 0, 0, 2] } });
    expect(res.status).toBe(201);
    expect(res.body.instance.placement.quaternion).toEqual([0, 0, 0, 1]);
  });
});
