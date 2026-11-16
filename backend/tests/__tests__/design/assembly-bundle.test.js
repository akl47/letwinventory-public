// REQ 1077/1079 — copy an assembly with every component it uses, and paste it
// as an independent set of new parts.

const { authenticatedRequest, createTestPart, createTestUser } = require('../../helpers');
const db = require('../../../models');

const PLACEMENT = { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] };
const inst = (instanceId, partID, extra = {}) => ({ instanceId, partID, ref: { kind: 'cad' }, placement: PLACEMENT, ...extra });

/** A part with a CAD model whose working copy holds `marker` as an equation. */
async function partWithCad(auth, marker, extra = {}) {
  const part = await createTestPart({ description: `desc ${marker}` });
  const res = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
  await db.DesignCADModel.update(
    { equations: { entries: { marker: { expression: String(marker) } } }, ...extra },
    { where: { id: res.body.id } },
  );
  return { part, modelId: res.body.id };
}

async function assemblyWith(auth, instances, extra = {}) {
  const part = await createTestPart({ partCategoryID: 4, description: 'an assembly' });
  const res = await auth.post(`/api/design/assembly/by-part/${part.id}`).send({});
  const row = await db.DesignCADModel.findByPk(res.body.id);
  await row.update({ assemblyDoc: { ...row.assemblyDoc, instances, nextInstanceSeq: instances.length + 1 }, ...extra });
  return { part, modelId: row.id };
}

const markerOf = (c) => c.model.equations.entries.marker.expression;

describe('GET /api/design/assembly/:id/bundle (REQ 1077)', () => {
  it('carries the assembly and each distinct component once', async () => {
    const auth = await authenticatedRequest();
    const a = await partWithCad(auth, 11);
    const b = await partWithCad(auth, 22);
    const asm = await assemblyWith(auth, [inst('i1', a.part.id), inst('i2', a.part.id), inst('i3', b.part.id)]);

    const res = await auth.get(`/api/design/assembly/${asm.modelId}/bundle`);
    expect(res.status).toBe(200);
    const bundle = res.body;
    expect(bundle).toMatchObject({ kind: 'letwinventory-cad', schema: 1, scope: 'assembly' });
    expect(typeof bundle.namingVersion).toBe('number');
    expect(bundle.source).toMatchObject({ modelId: asm.modelId, partID: asm.part.id, partName: asm.part.name, description: 'an assembly' });
    expect(bundle.assembly.assemblyDoc.instances).toHaveLength(3);
    expect(bundle.assembly.sketchDoc).toBeTruthy();
    expect(bundle.components.map((c) => c.partID)).toEqual([a.part.id, b.part.id]);
    expect(bundle.components[0]).toMatchObject({ partName: a.part.name, description: 'desc 11', isAssembly: false, modelId: a.modelId });
    expect(bundle.components.map(markerOf)).toEqual(['11', '22']);
    expect(bundle.components[0].model.featureTree.features[0].type).toBe('origin');
  });

  it('includes the components of sub-assemblies', async () => {
    const auth = await authenticatedRequest();
    const leaf = await partWithCad(auth, 5);
    const sub = await assemblyWith(auth, [inst('s1', leaf.part.id)]);
    const top = await assemblyWith(auth, [inst('i1', sub.part.id, { ref: { kind: 'assembly' } }), inst('i2', leaf.part.id)]);

    const { body } = await auth.get(`/api/design/assembly/${top.modelId}/bundle`);
    expect(body.components.map((c) => [c.partID, c.isAssembly])).toEqual([[sub.part.id, true], [leaf.part.id, false]]);
    expect(body.components[0].assembly.assemblyDoc.instances[0].partID).toBe(leaf.part.id);
  });

  it('copies the state the instance resolves: a tracked branch head, not the working copy', async () => {
    const auth = await authenticatedRequest();
    const a = await partWithCad(auth, 99); // marker lives only in the draft working copy
    const asm = await assemblyWith(auth, [inst('i1', a.part.id, { ref: { kind: 'cad', branch: 'main' } })]);
    const { body } = await auth.get(`/api/design/assembly/${asm.modelId}/bundle`);
    expect(body.components[0].model.equations.entries.marker).toBeUndefined();
  });

  it('refuses a component with no design, naming it', async () => {
    const auth = await authenticatedRequest();
    const bare = await createTestPart();
    const asm = await assemblyWith(auth, [inst('i1', bare.id)]);
    const res = await auth.get(`/api/design/assembly/${asm.modelId}/bundle`);
    expect(res.status).toBe(422);
    expect(res.body.error).toContain(bare.name);
  });
});

describe('POST /api/design/assembly/import-bundle (REQ 1079)', () => {
  async function copied(auth) {
    const leaf = await partWithCad(auth, 5);
    const other = await partWithCad(auth, 7);
    const sub = await assemblyWith(auth, [inst('s1', leaf.part.id)]);
    const top = await assemblyWith(auth, [
      inst('i1', sub.part.id, { ref: { kind: 'assembly' } }),
      inst('i2', leaf.part.id, { pinnedCommitHash: 'abc', placement: { translate: [1, 2, 3], quaternion: [0, 0, 0, 1] } }),
      inst('i3', other.part.id),
    ]);
    const { body } = await auth.get(`/api/design/assembly/${top.modelId}/bundle`);
    return { bundle: body, leaf, other, sub, top };
  }

  it('creates the assembly and one new part per component, re-pointing every instance', async () => {
    const auth = await authenticatedRequest();
    const { bundle, leaf, sub, other } = await copied(auth);

    const res = await auth.post('/api/design/assembly/import-bundle').send({ bundle, name: 'ASM-COPY', description: 'pasted' });
    expect(res.status).toBe(201);
    expect(res.body.components).toHaveLength(3);
    const newOf = (id) => res.body.components.find((c) => c.sourcePartID === id).partID;
    const sourceIds = [leaf.part.id, sub.part.id, other.part.id];
    for (const id of sourceIds) expect(sourceIds).not.toContain(newOf(id));

    const asmPart = await db.Part.findByPk(res.body.assembly.partID);
    expect(asmPart).toMatchObject({ name: 'ASM-COPY', description: 'pasted', revision: '01', partCategoryID: 4 });
    const asm = await db.DesignCADModel.findByPk(res.body.assembly.id);
    expect(asm.isAssembly).toBe(true);
    expect(asm.branchName).toBe('draft/01');
    expect(asm.lockedByUserID).toBeTruthy();
    const byId = Object.fromEntries(asm.assemblyDoc.instances.map((i) => [i.instanceId, i]));
    expect(byId.i1).toMatchObject({ partID: newOf(sub.part.id), ref: { kind: 'assembly', branch: 'draft/01' } });
    expect(byId.i2).toMatchObject({ partID: newOf(leaf.part.id), ref: { kind: 'cad', branch: 'draft/01' }, pinnedCommitHash: null });
    expect(byId.i2.placement.translate).toEqual([1, 2, 3]);
    expect(byId.i3.partID).toBe(newOf(other.part.id));

    // Components are checked in, unlocked, and carry the copied design.
    const leafRow = await db.DesignCADModel.findOne({ where: { partID: newOf(leaf.part.id), activeFlag: true } });
    expect(leafRow.equations.entries.marker.expression).toBe('5');
    expect(leafRow.dirty).toBe(false);
    expect(leafRow.lockedByUserID).toBeNull();
    const leafPart = await db.Part.findByPk(leafRow.partID);
    expect(leafPart.description).toBe('desc 5');
    expect(leafPart.name).not.toBe(leaf.part.name);

    // The sub-assembly copy points at the SAME new leaf part.
    const subRow = await db.DesignCADModel.findOne({ where: { partID: newOf(sub.part.id), activeFlag: true } });
    expect(subRow.isAssembly).toBe(true);
    expect(subRow.assemblyDoc.instances[0].partID).toBe(newOf(leaf.part.id));
  });

  it('re-points in-context references and pushed-variable tags', async () => {
    const auth = await authenticatedRequest();
    const child = await partWithCad(auth, 1);
    const sibling = await partWithCad(auth, 2);
    const asm = await assemblyWith(auth, [inst('i1', child.part.id), inst('i2', sibling.part.id)]);
    const ref = {
      scope: 'cross-part', definingAssemblyId: asm.modelId, definingAssemblyRepoId: String(asm.part.id),
      sourceInstanceId: 'i2', sourcePartId: sibling.part.id, sourceGeomRef: { featureId: '', edgeId: 'cpe:i2:a|b' },
      pinnedSourceCommit: 'deadbeef',
    };
    await db.DesignCADModel.update({
      sketchDoc: { nextSketchSeq: 2, sketches: { s1: { id: 's1', state: { entities: [], constraints: [{ id: 'c1', type: 'on-edge', targets: [], externalRef: ref }] } } } },
      equations: { entries: { w: { expression: '5', fromAssembly: asm.modelId } } },
    }, { where: { id: child.modelId } });

    const { body: bundle } = await auth.get(`/api/design/assembly/${asm.modelId}/bundle`);
    const res = await auth.post('/api/design/assembly/import-bundle').send({ bundle, name: 'ASM-REFS' });
    expect(res.status).toBe(201);
    const newOf = (id) => res.body.components.find((c) => c.sourcePartID === id).partID;
    const row = await db.DesignCADModel.findOne({ where: { partID: newOf(child.part.id), activeFlag: true } });
    const out = row.sketchDoc.sketches.s1.state.constraints[0].externalRef;
    expect(out).toMatchObject({
      definingAssemblyId: res.body.assembly.id, definingAssemblyRepoId: String(res.body.assembly.partID),
      sourceInstanceId: 'i2', sourcePartId: newOf(sibling.part.id),
    });
    // The source repo's pin is dropped; check-in re-pins against the NEW source part.
    expect(out.pinnedSourceCommit).not.toBe('deadbeef');
    expect(row.equations.entries.w.fromAssembly).toBe(res.body.assembly.id);
  });

  it('refuses a part number already in use and creates nothing', async () => {
    const auth = await authenticatedRequest();
    const { bundle } = await copied(auth);
    await createTestPart({ name: 'TAKEN', revision: '01' });
    const before = await db.Part.count();
    const res = await auth.post('/api/design/assembly/import-bundle').send({ bundle, name: 'TAKEN' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('TAKEN');
    expect(await db.Part.count()).toBe(before);
  });

  it('refuses an incomplete bundle and creates nothing', async () => {
    const auth = await authenticatedRequest();
    const { bundle } = await copied(auth);
    const before = await db.Part.count();
    const missing = { ...bundle, components: bundle.components.slice(1) };
    const res = await auth.post('/api/design/assembly/import-bundle').send({ bundle: missing, name: 'ASM-BAD' });
    expect(res.status).toBe(400);
    expect((await auth.post('/api/design/assembly/import-bundle').send({ bundle: { kind: 'nope' }, name: 'X' })).status).toBe(400);
    expect(await db.Part.count()).toBe(before);
  });

  it('needs parts write permission', async () => {
    const auth = await authenticatedRequest();
    const { bundle } = await copied(auth);
    const limited = await authenticatedRequest(await createTestUser({ displayName: 'No Parts User' }), { grantPermissions: false });
    const res = await limited.post('/api/design/assembly/import-bundle').send({ bundle, name: 'ASM-NOPE' });
    expect(res.status).toBe(403);
  });
});
