const { authenticatedRequest, createTestPart } = require('../../helpers');
const analysis = require('../../../services/assemblyAnalysisService');

// A box body spanning min..max, expressed as face positions (for the AABB).
function box(instanceId, min, max, brep) {
  const positions = [min[0], min[1], min[2], max[0], max[1], max[2], min[0], min[1], min[2]];
  return { instanceId, brep, placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] }, faces: [{ positions, normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }] };
}

describe('assembly mass properties (REQ 768)', () => {
  it('sums component volumes and computes the volume-weighted center of mass', () => {
    const composed = { bodies: [{ volume: 10, centroid: [0, 0, 0] }, { volume: 30, centroid: [4, 0, 0] }] };
    const mp = analysis.massProperties(composed);
    expect(mp.volume).toBe(40);
    expect(mp.centerOfMass[0]).toBeCloseTo(3, 6); // (10·0 + 30·4)/40
    expect(mp.bodiesWithMass).toBe(2);
  });

  it('returns null center of mass when no body has volume', () => {
    const mp = analysis.massProperties({ bodies: [{ faces: [] }] });
    expect(mp.volume).toBe(0);
    expect(mp.centerOfMass).toBeNull();
  });
});

describe('assembly interference (REQ 767)', () => {
  const stubKernel = { call: async () => ({ solids: [{}] }) }; // boolean common → nonempty

  it('flags AABB-overlapping components and confirms via the kernel', async () => {
    const composed = { bodies: [box('i1', [0, 0, 0], [2, 2, 2], 'A'), box('i2', [1, 1, 1], [3, 3, 3], 'B')] };
    const res = await analysis.interference(composed, { kernelClient: stubKernel });
    expect(res).toHaveLength(1);
    expect(res[0].interfering).toBe(true);
  });

  it('does not flag non-overlapping components', async () => {
    const composed = { bodies: [box('i1', [0, 0, 0], [1, 1, 1], 'A'), box('i2', [5, 5, 5], [6, 6, 6], 'B')] };
    const res = await analysis.interference(composed, { kernelClient: stubKernel });
    expect(res).toHaveLength(0);
  });

  it('reports AABB candidates as unconfirmed when no kernel is available', async () => {
    const composed = { bodies: [box('i1', [0, 0, 0], [2, 2, 2], 'A'), box('i2', [1, 1, 1], [3, 3, 3], 'B')] };
    const res = await analysis.interference(composed, {});
    expect(res).toHaveLength(1);
    expect(res[0].interfering).toBeNull();
  });

  it('ignores body pairs from the same instance', async () => {
    const composed = { bodies: [box('i1', [0, 0, 0], [2, 2, 2], 'A'), box('i1', [1, 1, 1], [3, 3, 3], 'B')] };
    const res = await analysis.interference(composed, { kernelClient: stubKernel });
    expect(res).toHaveLength(0);
  });
});

describe('Assembly BOM sync to inventory (REQ 769)', () => {
  async function partWithCad(auth) {
    const part = await createTestPart();
    await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
    return part;
  }

  it('writes one BillOfMaterialItem per distinct component part and replaces prior items', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const c1 = await partWithCad(auth);
    const c2 = await partWithCad(auth);
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    const id = asm.body.id;
    await auth.post(`/api/design/assembly/${id}/instances`).send({ partID: c1.id });
    await auth.post(`/api/design/assembly/${id}/instances`).send({ partID: c1.id });
    await auth.post(`/api/design/assembly/${id}/instances`).send({ partID: c2.id });

    const res = await auth.post(`/api/design/assembly/${id}/bom/sync`).send({});
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    const c1row = res.body.items.find((i) => i.componentPartID === c1.id);
    expect(c1row.quantity).toBe(2);

    // Re-sync replaces rather than duplicates.
    const again = await auth.post(`/api/design/assembly/${id}/bom/sync`).send({});
    expect(again.body.count).toBe(2);
  });
});
