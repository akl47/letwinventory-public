const { authenticatedRequest, createTestPart } = require('../../helpers');

describe('Assembly release (shared release/freeze parity)', () => {
  it('releases a draft branch onto main as the next numeric revision', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart({ partCategoryID: 4 }); // revision "00"
    const asm = await auth.post(`/api/design/assembly/by-part/${part.id}`).send({});
    const id = asm.body.id;

    await auth.post(`/api/design/cad-model/${id}/branches`).send({ name: 'draft/01' });
    await auth.post(`/api/design/cad-model/${id}/switch-branch`).send({ name: 'draft/01' });

    const rel = await auth.post(`/api/design/cad-model/${id}/release`).send({});
    expect(rel.status).toBe(200);
    expect(rel.body.revision).toBe('01');
    expect(rel.body.model.branchName).toBe('main');
    expect(rel.body.model.released).toBe(true);
    expect(rel.body.model.displayRevision).toBe('01');
  });

  it('rejects releasing on main (protected line)', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart({ partCategoryID: 4 });
    const asm = await auth.post(`/api/design/assembly/by-part/${part.id}`).send({});
    // Creation auto-lands on draft/01; switch back to the protected main line,
    // where self-service release is rejected (production-letter release there
    // is approval-gated, not available on a fresh unapproved assembly).
    await auth.post(`/api/design/cad-model/${asm.body.id}/switch-branch`).send({ name: 'main' });
    const rel = await auth.post(`/api/design/cad-model/${asm.body.id}/release`).send({});
    expect(rel.status).toBe(409);
  });

  it('404s a release-file download before the revision is released', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart({ partCategoryID: 4 });
    const asm = await auth.post(`/api/design/assembly/by-part/${part.id}`).send({});
    const res = await auth.get(`/api/design/cad-model/${asm.body.id}/release/step`);
    expect(res.status).toBe(409);
  });
});
