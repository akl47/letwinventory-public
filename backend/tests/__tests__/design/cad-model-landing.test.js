const { authenticatedRequest, createTestPart } = require('../../helpers');

describe('CAD landing endpoint (parts-with-cad)', () => {
  async function createDraft(auth, partID) {
    const r = await auth.post(`/api/design/cad-model/by-part/${partID}`).send({});
    return r.body;
  }

  it('returns an empty list when no CAD models exist', async () => {
    const auth = await authenticatedRequest();
    const res = await auth.get('/api/design/cad-model/parts-with-cad');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns one row per part with at least one active CAD model', async () => {
    const auth = await authenticatedRequest();
    const a = await createTestPart();
    const b = await createTestPart();
    await createDraft(auth, a.id);
    await createDraft(auth, b.id);
    const res = await auth.get('/api/design/cad-model/parts-with-cad');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    const ids = res.body.map(r => r.partID).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it('reports revisionCount and latest revision per part', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const a = await createDraft(auth, part.id);
    await auth.post(`/api/design/cad-model/${a.id}/submit`);
    await auth.post(`/api/design/cad-model/${a.id}/release`);
    const b = await auth.post(`/api/design/cad-model/${a.id}/new-revision`);
    expect(b.status).toBe(201);

    const res = await auth.get('/api/design/cad-model/parts-with-cad');
    const row = res.body.find(r => r.partID === part.id);
    expect(row.revisionCount).toBe(2);
    expect(row.latestRevision).toBe('B');
    expect(row.latestReleaseState).toBe('draft');
    expect(row.hasReleased).toBe(true);
    expect(row.releasedRevision).toBe('A');
  });

  it('omits soft-deleted CAD models', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const a = await createDraft(auth, part.id);
    await auth.delete(`/api/design/cad-model/${a.id}`);

    const res = await auth.get('/api/design/cad-model/parts-with-cad');
    expect(res.body.find(r => r.partID === part.id)).toBeUndefined();
  });

  it('includes part name and revision in the response', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart({ name: 'Widget A' });
    await createDraft(auth, part.id);
    const res = await auth.get('/api/design/cad-model/parts-with-cad');
    const row = res.body.find(r => r.partID === part.id);
    expect(row.part).toBeTruthy();
    expect(row.part.name).toBe('Widget A');
    expect(row.part.revision).toBeDefined();
  });
});
