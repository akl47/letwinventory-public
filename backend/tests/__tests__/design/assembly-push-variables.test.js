// REQ 918 — assembly → child variable push (shared-push semantics): literal
// resolved values written into child equations docs, tagged fromAssembly,
// with a per-child skip report.
const { authenticatedRequest, createTestPart, createTestUser } = require('../../helpers');
const db = require('../../../models');

async function partWithCad(auth) {
  const part = await createTestPart();
  const res = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
  return { part, model: res.body };
}

/** Put a child's working copy on a draft branch (writable). New CAD models
 * are auto-created on draft/01 already; this asserts it. */
async function assertOnDraft(modelId) {
  const row = await db.DesignCADModel.findByPk(modelId);
  expect((row.branchName || 'main')).not.toBe('main');
  return row;
}

async function assemblyWithVars(auth, childPartIds, vars) {
  const asmPart = await createTestPart({ partCategoryID: 4 });
  const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
  const id = asm.body.id;
  await auth.post(`/api/design/cad-model/${id}/branches`).send({ name: 'draft/01' });
  await auth.post(`/api/design/cad-model/${id}/switch-branch`).send({ name: 'draft/01' });
  await auth.post(`/api/design/cad-model/${id}/checkout`).send({});
  for (const pid of childPartIds) {
    await auth.post(`/api/design/assembly/${id}/instances`).send({ partID: pid });
  }
  const row = await db.DesignCADModel.findByPk(id);
  await row.update({ equations: { entries: vars } });
  return id;
}

describe('POST /api/design/assembly/:id/push-variables (REQ 918)', () => {
  it('writes literal resolved values tagged fromAssembly into child equations', async () => {
    const auth = await authenticatedRequest();
    const { part, model } = await partWithCad(auth);
    await assertOnDraft(model.id);
    const asmId = await assemblyWithVars(auth, [part.id], {
      width: { expression: '50' },
      height: { expression: 'width / 2' },
    });
    const res = await auth.post(`/api/design/assembly/${asmId}/push-variables`).send({});
    expect(res.status).toBe(200);
    expect(res.body.names.sort()).toEqual(['height', 'width']);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].status).toBe('updated');

    const child = await db.DesignCADModel.findByPk(model.id);
    expect(child.equations.entries.width).toMatchObject({ expression: '50', lastValue: 50, fromAssembly: asmId });
    // Expressions push as LITERAL resolved values, not the expression text.
    expect(child.equations.entries.height).toMatchObject({ expression: '25', lastValue: 25, fromAssembly: asmId });
    expect(child.dirty).toBe(true);
  });

  it('supports a names filter and reports unresolved variables', async () => {
    const auth = await authenticatedRequest();
    const { part, model } = await partWithCad(auth);
    const asmId = await assemblyWithVars(auth, [part.id], {
      good: { expression: '10' },
      bad: { expression: 'nope + 1' },
    });
    const res = await auth.post(`/api/design/assembly/${asmId}/push-variables`).send({ names: ['good', 'bad'] });
    expect(res.status).toBe(200);
    expect(res.body.names).toEqual(['good']);
    expect(res.body.unresolved).toEqual(['bad']);
    const child = await db.DesignCADModel.findByPk(model.id);
    expect(child.equations.entries.good.expression).toBe('10');
    expect(child.equations.entries.bad).toBeUndefined();
  });

  it('is idempotent — a second identical push reports unchanged', async () => {
    const auth = await authenticatedRequest();
    const { part } = await partWithCad(auth);
    const asmId = await assemblyWithVars(auth, [part.id], { width: { expression: '50' } });
    await auth.post(`/api/design/assembly/${asmId}/push-variables`).send({});
    const second = await auth.post(`/api/design/assembly/${asmId}/push-variables`).send({});
    expect(second.body.results[0].status).toBe('unchanged');
  });

  it('skips a child on main (read-only working copy)', async () => {
    const auth = await authenticatedRequest();
    const { part, model } = await partWithCad(auth);
    const row = await db.DesignCADModel.findByPk(model.id);
    await row.update({ branchName: 'main' });
    const asmId = await assemblyWithVars(auth, [part.id], { width: { expression: '50' } });
    const res = await auth.post(`/api/design/assembly/${asmId}/push-variables`).send({});
    expect(res.body.results[0].status).toBe('skipped-main');
    const child = await db.DesignCADModel.findByPk(model.id);
    expect(child.equations.entries.width).toBeUndefined();
  });

  it('skips a child locked by another user, reporting the holder', async () => {
    const auth = await authenticatedRequest();
    const other = await createTestUser({ displayName: 'Push Lock Holder' });
    const { part, model } = await partWithCad(auth);
    const row = await db.DesignCADModel.findByPk(model.id);
    await row.update({
      lockedByUserID: other.id, lockedAt: new Date(),
      lockExpiresAt: new Date(Date.now() + 60_000),
    });
    const asmId = await assemblyWithVars(auth, [part.id], { width: { expression: '50' } });
    const res = await auth.post(`/api/design/assembly/${asmId}/push-variables`).send({});
    expect(res.body.results[0].status).toBe('skipped-locked');
    expect(res.body.results[0].lockedBy).toBe('Push Lock Holder');
  });

  it('skips a release-locked child and a child with no CAD model', async () => {
    const auth = await authenticatedRequest();
    const { part, model } = await partWithCad(auth);
    const row = await db.DesignCADModel.findByPk(model.id);
    await row.update({ releaseLocked: true });
    const bare = await createTestPart();
    const asmId = await assemblyWithVars(auth, [part.id, bare.id], { width: { expression: '50' } });
    const res = await auth.post(`/api/design/assembly/${asmId}/push-variables`).send({});
    const byPart = Object.fromEntries(res.body.results.map((r) => [r.partID, r.status]));
    expect(byPart[part.id]).toBe('skipped-released');
    expect(byPart[bare.id]).toBe('no-model');
  });

  it('422s when nothing is pushable', async () => {
    const auth = await authenticatedRequest();
    const { part } = await partWithCad(auth);
    const asmId = await assemblyWithVars(auth, [part.id], {});
    const res = await auth.post(`/api/design/assembly/${asmId}/push-variables`).send({});
    expect(res.status).toBe(422);
  });
});
