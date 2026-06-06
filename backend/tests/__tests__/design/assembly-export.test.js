const { authenticatedRequest, createTestPart } = require('../../helpers');

async function partWithCad(auth) {
  const part = await createTestPart();
  await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
  return part;
}

describe('Assembly export (REQ 754)', () => {
  it('returns 422 when the assembly has no body geometry to export', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});

    const res = await auth.get(`/api/design/assembly/${asm.body.id}/export/step`);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no body geometry/i);
  });

  it('degrades to a clear error (not 200) when the kernel is unavailable', async () => {
    const auth = await authenticatedRequest();
    const asmPart = await createTestPart({ partCategoryID: 4 });
    const comp = await partWithCad(auth);
    const asm = await auth.post(`/api/design/assembly/by-part/${asmPart.id}`).send({});
    await auth.post(`/api/design/assembly/${asm.body.id}/instances`).send({ partID: comp.id });

    // No CAD kernel runs in the test environment, so composing/exporting fails
    // with a clear 4xx/5xx error rather than producing a bogus file.
    const res = await auth.get(`/api/design/assembly/${asm.body.id}/export/step`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(200);
  });
});
