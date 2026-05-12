const { authenticatedRequest, createTestPart } = require('../../helpers');

async function createDraft(auth, partID) {
  const res = await auth.post(`/api/design/cad-model/by-part/${partID}`).send({});
  return res.body;
}

describe('CAD Model release workflow (CAD-104, CAD-105)', () => {
  describe('POST /api/design/cad-model/:id/submit (CAD-104)', () => {
    it('transitions draft → review', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const model = await createDraft(auth, part.id);

      const res = await auth.post(`/api/design/cad-model/${model.id}/submit`);
      expect(res.status).toBe(200);
      expect(res.body.releaseState).toBe('review');
      expect(res.body.submittedAt).not.toBeNull();
    });

    it('rejects a second submit when state is already review', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const model = await createDraft(auth, part.id);

      await auth.post(`/api/design/cad-model/${model.id}/submit`);
      const res = await auth.post(`/api/design/cad-model/${model.id}/submit`);
      expect(res.status).toBe(400);
      expect(res.body.error || res.body.errorMessage).toMatch(/state|transition|review/i);
    });
  });

  describe('POST /api/design/cad-model/:id/release (CAD-104)', () => {
    it('transitions review → released and stamps releasedAt + releasedByUserID', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const model = await createDraft(auth, part.id);

      await auth.post(`/api/design/cad-model/${model.id}/submit`);
      const res = await auth.post(`/api/design/cad-model/${model.id}/release`);
      expect(res.status).toBe(200);
      expect(res.body.releaseState).toBe('released');
      expect(res.body.releasedAt).not.toBeNull();
      expect(res.body.releasedByUserID).toBe(auth.user.id);
    });

    it('rejects releasing a draft model (must submit first)', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const model = await createDraft(auth, part.id);

      const res = await auth.post(`/api/design/cad-model/${model.id}/release`);
      expect(res.status).toBe(400);
      expect(res.body.error || res.body.errorMessage).toMatch(/state|transition|review|draft/i);
    });
  });

  describe('Read-only enforcement on non-draft models (CAD-105)', () => {
    it('rejects PUT against a model in review state', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const model = await createDraft(auth, part.id);
      await auth.post(`/api/design/cad-model/${model.id}/submit`);

      const res = await auth.put(`/api/design/cad-model/${model.id}`)
        .send({ featureTree: { features: [] } });
      expect(res.status).toBe(400);
      expect(res.body.error || res.body.errorMessage).toMatch(/draft|state|read/i);
    });

    it('rejects PUT against a released model', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const model = await createDraft(auth, part.id);
      await auth.post(`/api/design/cad-model/${model.id}/submit`);
      await auth.post(`/api/design/cad-model/${model.id}/release`);

      const res = await auth.put(`/api/design/cad-model/${model.id}`)
        .send({ featureTree: { features: [] } });
      expect(res.status).toBe(400);
      expect(res.body.error || res.body.errorMessage).toMatch(/draft|state|released/i);
    });

    it('rejects DELETE against a model in review state (CAD-107)', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const model = await createDraft(auth, part.id);
      await auth.post(`/api/design/cad-model/${model.id}/submit`);

      const res = await auth.delete(`/api/design/cad-model/${model.id}`);
      expect(res.status).toBe(400);
    });

    it('rejects DELETE against a released model (CAD-107)', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const model = await createDraft(auth, part.id);
      await auth.post(`/api/design/cad-model/${model.id}/submit`);
      await auth.post(`/api/design/cad-model/${model.id}/release`);

      const res = await auth.delete(`/api/design/cad-model/${model.id}`);
      expect(res.status).toBe(400);
    });
  });

  describe('History recording', () => {
    it('records create, submit, and release events in DesignCADModelHistory', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const model = await createDraft(auth, part.id);
      await auth.post(`/api/design/cad-model/${model.id}/submit`);
      await auth.post(`/api/design/cad-model/${model.id}/release`);

      const res = await auth.get(`/api/design/cad-model/${model.id}/history`);
      expect(res.status).toBe(200);
      const changeTypes = res.body.map(h => h.changeType);
      expect(changeTypes).toEqual(expect.arrayContaining(['created', 'submitted', 'released']));
    });
  });
});
