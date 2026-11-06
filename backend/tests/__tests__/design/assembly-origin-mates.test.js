const svc = require('../../../services/assemblyRegenService');
const { authenticatedRequest, createTestPart } = require('../../helpers');

const tri = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] };
const stubPart = async () => ({
  faces: [], vertices: [], edges: [],
  bodies: [{ id: 'b0', name: null, brep: 'BREP', faces: [{ faceId: 'f0', persistentName: 'f0', ...tri }], vertices: [[0, 0, 0]], edges: [] }],
});

// Rotate v by quaternion q = [x, y, z, w].
function qRotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]); const ty = 2 * (z * v[0] - x * v[2]); const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
const expectVec = (v, e) => e.forEach((c, i) => expect(v[i]).toBeCloseTo(c, 3));

// A tilted, offset start pose so the solve has real work to do.
const START = { translate: [5, 6, 7], quaternion: [0.2, 0.1, 0.3, 0.927] };
const ORIGIN = (instanceId) => ({ instanceId, faceId: 'origin' });

async function solve(instances, mates) {
  return svc.regenerateAssembly({ partID: 1, assemblyDoc: { instances, mates } }, { resolveChild: stubPart });
}

describe('origin-to-origin coincident mates (REQ 998)', () => {
  const grounded = { instanceId: 'i1', partID: 2, grounded: true, placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] } };
  const floating = { instanceId: 'i2', partID: 3, placement: START };

  it('aligns the origins and the X/Y/Z axes by default, fully constraining the component', async () => {
    const composed = await solve([grounded, floating], [
      { id: 'm1', mateId: 'm1', type: 'coincident', a: ORIGIN('i1'), b: ORIGIN('i2'), frame: { x: '+x', y: '+y' } },
    ]);
    const p = composed.instances.find((i) => i.instanceId === 'i2').placement;
    expectVec(p.translate, [0, 0, 0]);
    expectVec(qRotate(p.quaternion, [1, 0, 0]), [1, 0, 0]);
    expectVec(qRotate(p.quaternion, [0, 1, 0]), [0, 1, 0]);
    expect(composed.constraintState.dof).toBe(0);
    expect(composed.constraintState.state).toBe('fully');
  });

  it('remaps the axes: X onto -Y and Y onto +X', async () => {
    const composed = await solve([grounded, floating], [
      { id: 'm1', mateId: 'm1', type: 'coincident', a: ORIGIN('i1'), b: ORIGIN('i2'), frame: { x: '-y', y: '+x' } },
    ]);
    const q = composed.instances.find((i) => i.instanceId === 'i2').placement.quaternion;
    expectVec(qRotate(q, [1, 0, 0]), [0, -1, 0]);
    expectVec(qRotate(q, [0, 1, 0]), [1, 0, 0]);
    expectVec(qRotate(q, [0, 0, 1]), [0, 0, 1]);
  });

  it('without a frame only the points coincide (rotation stays free)', async () => {
    const composed = await solve([grounded, floating], [
      { id: 'm1', mateId: 'm1', type: 'coincident', a: ORIGIN('i1'), b: ORIGIN('i2') },
    ]);
    expectVec(composed.instances.find((i) => i.instanceId === 'i2').placement.translate, [0, 0, 0]);
    expect(composed.constraintState.dof).toBe(3);
  });
});

describe('assembly origin as a mate reference (REQ 999)', () => {
  it('mates a component origin to the assembly origin without auto-grounding the component', async () => {
    const composed = await solve(
      [{ instanceId: 'i1', partID: 2, placement: START }],
      [{ id: 'm1', mateId: 'm1', type: 'coincident', a: ORIGIN('__assembly__'), b: ORIGIN('i1'), frame: { x: '+z', y: '+x' } }],
    );
    const p = composed.instances.find((i) => i.instanceId === 'i1').placement;
    expectVec(p.translate, [0, 0, 0]);
    expectVec(qRotate(p.quaternion, [1, 0, 0]), [0, 0, 1]);
    expectVec(qRotate(p.quaternion, [0, 1, 0]), [1, 0, 0]);
    expect(composed.constraintState.state).toBe('fully');
  });
});

describe('faceless lock mates for in-context child parts (REQ 1003)', () => {
  const placed = { translate: [3, 4, 5], quaternion: [0, 0, 0.7071068, 0.7071068] };

  it('a lock to the assembly holds the instance where it was placed', async () => {
    const composed = await solve(
      [{ instanceId: 'i1', partID: 2, placement: placed }],
      [{ id: 'm1', mateId: 'm1', type: 'lock', a: { instanceId: 'i1', faceId: '' }, b: { instanceId: '__assembly__', faceId: '' } }],
    );
    const p = composed.instances.find((i) => i.instanceId === 'i1').placement;
    expectVec(p.translate, [3, 4, 5]);
    expectVec(qRotate(p.quaternion, [1, 0, 0]), [0, 1, 0]);
    expect(composed.constraintState.state).toBe('fully');
    expect(composed.errors || []).toEqual([]);
  });

  it('a lock to a component makes the child follow it', async () => {
    const composed = await solve(
      [
        { instanceId: 'i1', partID: 2, grounded: true, placement: { translate: [1, 0, 0], quaternion: [0, 0, 0, 1] } },
        { instanceId: 'i2', partID: 3, placement: placed },
      ],
      [{ id: 'm1', mateId: 'm1', type: 'lock', a: { instanceId: 'i2', faceId: '' }, b: { instanceId: 'i1', faceId: '' } }],
    );
    expect(composed.constraintState.state).toBe('fully');
    expect(composed.errors || []).toEqual([]);
  });

  it('API accepts a faceless lock to the assembly', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const c1 = await createTestPart();
    await auth.post(`/api/design/cad-model/by-part/${c1.id}`).send({});
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    await auth.post(`/api/design/cad-model/${asm.body.id}/checkout`).send({});
    await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: c1.id, grounded: false });
    const res = await auth.post(`/api/design/assembly/${asm.body.id}/mates`).send({
      type: 'lock', a: { instanceId: 'i1' }, b: { instanceId: '__assembly__' },
    });
    expect(res.status).toBe(201);
  });
});

describe('mating to a reference point coordinate system (REQ 1006)', () => {
  it('aligns a part origin and axes to a point owned by another component', async () => {
    // Point pt1 sits at (1,2,3) in i1's frame with its Z turned onto i1's +X.
    const featureTree = { features: [{ id: 'pt1', type: 'datumPoint', method: { kind: 'onVertex', vertexRef: { vertexId: 'v', fallbackPosition: [0, 0, 0] } },
      anchor: { instanceId: 'i1', local: [1, 2, 3], quat: [0, 0.7071068, 0, 0.7071068] } }] };
    const composed = await svc.regenerateAssembly({
      partID: 1, featureTree,
      assemblyDoc: {
        instances: [
          { instanceId: 'i1', partID: 2, grounded: true, placement: { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] } },
          { instanceId: 'i2', partID: 3, placement: START },
        ],
        mates: [{ id: 'm1', mateId: 'm1', type: 'coincident', a: { instanceId: 'i1', faceId: 'csys:pt1:origin' }, b: ORIGIN('i2'), frame: { x: '+x', y: '+y' } }],
      },
    }, { resolveChild: stubPart });
    const p = composed.instances.find((i) => i.instanceId === 'i2').placement;
    expectVec(p.translate, [11, 2, 3]);
    expectVec(qRotate(p.quaternion, [0, 0, 1]), [1, 0, 0]);
    expect(composed.constraintState.state).toBe('fully');
  });
});

describe('origin mate API (REQ 998/999)', () => {
  async function assemblyWithOne() {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const c1 = await createTestPart();
    await auth.post(`/api/design/cad-model/by-part/${c1.id}`).send({});
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    await auth.post(`/api/design/cad-model/${asm.body.id}/checkout`).send({});
    await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: c1.id });
    return { auth, asmId: asm.body.id };
  }

  it('insert with originMate adds an origin-to-origin mate instead of grounding (REQ 1003)', async () => {
    const { auth, asmId } = await assemblyWithOne();
    const c2 = await createTestPart();
    await auth.post(`/api/design/cad-model/by-part/${c2.id}`).send({});
    const res = await auth.post(`/api/design/assembly/${asmId}/instances`).send({ partID: c2.id, originMate: true });
    expect(res.status).toBe(201);
    const doc = res.body.assembly.assemblyDoc;
    expect(doc.instances.find((i) => i.instanceId === 'i2').grounded).toBe(false);
    expect(doc.mates).toContainEqual(expect.objectContaining({
      type: 'coincident', a: { instanceId: '__assembly__', faceId: 'origin' }, b: { instanceId: 'i2', faceId: 'origin' }, frame: { x: '+x', y: '+y' },
    }));
  });

  it('records createdAt on inserted instances (REQ 1007)', async () => {
    const { auth, asmId } = await assemblyWithOne();
    const res = await auth.get(`/api/design/assembly/${asmId}`);
    expect(typeof res.body.assemblyDoc.instances[0].createdAt).toBe('number');
  });

  it('accepts the assembly origin as a reference and stores the frame', async () => {
    const { auth, asmId } = await assemblyWithOne();
    const res = await auth.post(`/api/design/assembly/${asmId}/mates`).send({
      type: 'coincident', a: ORIGIN('__assembly__'), b: ORIGIN('i1'), frame: { x: '-x', y: '+z' },
    });
    expect(res.status).toBe(201);
    expect(res.body.mate.frame).toEqual({ x: '-x', y: '+z' });
  });

  it('accepts an assembly datum plane as a reference', async () => {
    const { auth, asmId } = await assemblyWithOne();
    const res = await auth.post(`/api/design/assembly/${asmId}/mates`).send({
      type: 'coincident', a: { instanceId: '__assembly__', faceId: 'xy_plane' }, b: { instanceId: 'i1', faceId: 'xy_plane' },
    });
    expect(res.status).toBe(201);
  });

  it('only allows origin datums on the assembly reference', async () => {
    const { auth, asmId } = await assemblyWithOne();
    const res = await auth.post(`/api/design/assembly/${asmId}/mates`).send({
      type: 'coincident', a: { instanceId: '__assembly__', faceId: 'top' }, b: ORIGIN('i1'),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/assembly origin/i);
  });

  it('rejects a frame whose X and Y map onto the same axis', async () => {
    const { auth, asmId } = await assemblyWithOne();
    const res = await auth.post(`/api/design/assembly/${asmId}/mates`).send({
      type: 'coincident', a: ORIGIN('__assembly__'), b: ORIGIN('i1'), frame: { x: '+x', y: '-x' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/axis/i);
  });

  it('edits and clears the frame via PUT', async () => {
    const { auth, asmId } = await assemblyWithOne();
    await auth.post(`/api/design/assembly/${asmId}/mates`).send({
      type: 'coincident', a: ORIGIN('__assembly__'), b: ORIGIN('i1'), frame: { x: '+x', y: '+y' },
    });
    let res = await auth.put(`/api/design/assembly/${asmId}/mates/m1`).send({ frame: { x: '+y', y: '-x' } });
    expect(res.status).toBe(200);
    expect(res.body.assemblyDoc.mates[0].frame).toEqual({ x: '+y', y: '-x' });
    res = await auth.put(`/api/design/assembly/${asmId}/mates/m1`).send({ frame: null });
    expect(res.body.assemblyDoc.mates[0].frame).toBeUndefined();
  });
});
