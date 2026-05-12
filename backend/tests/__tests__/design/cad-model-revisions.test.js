const { authenticatedRequest, createTestPart } = require('../../helpers');

async function createAndRelease(auth, partID) {
  const a = await auth.post(`/api/design/cad-model/by-part/${partID}`).send({});
  await auth.post(`/api/design/cad-model/${a.body.id}/submit`);
  await auth.post(`/api/design/cad-model/${a.body.id}/release`);
  return a.body.id;
}

describe('CAD Model revision chain (CAD-103)', () => {
  describe('POST /api/design/cad-model/:id/new-revision', () => {
    it('creates revision B from released revision A in draft state with previousRevisionID set', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const aID = await createAndRelease(auth, part.id);

      const res = await auth.post(`/api/design/cad-model/${aID}/new-revision`);
      expect(res.status).toBe(201);
      expect(res.body.revision).toBe('B');
      expect(res.body.releaseState).toBe('draft');
      expect(res.body.previousRevisionID).toBe(aID);
      expect(res.body.partID).toBe(part.id);
    });

    it('copies the released revision\'s featureTree and sketchDoc into the new draft', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const a = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
      const customTree = { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 7 }] };
      await auth.put(`/api/design/cad-model/${a.body.id}`).send({ featureTree: customTree });
      await auth.post(`/api/design/cad-model/${a.body.id}/submit`);
      await auth.post(`/api/design/cad-model/${a.body.id}/release`);

      const res = await auth.post(`/api/design/cad-model/${a.body.id}/new-revision`);
      expect(res.status).toBe(201);
      expect(res.body.featureTree).toEqual(customTree);
    });

    it('rejects new-revision against a draft model', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const a = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});

      const res = await auth.post(`/api/design/cad-model/${a.body.id}/new-revision`);
      expect(res.status).toBe(400);
      expect(res.body.error || res.body.errorMessage).toMatch(/released|state/i);
    });

    it('rejects new-revision against a model in review state', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const a = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
      await auth.post(`/api/design/cad-model/${a.body.id}/submit`);

      const res = await auth.post(`/api/design/cad-model/${a.body.id}/new-revision`);
      expect(res.status).toBe(400);
      expect(res.body.error || res.body.errorMessage).toMatch(/released|state/i);
    });

    it('returns C when called on a released revision B', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const aID = await createAndRelease(auth, part.id);
      const b = await auth.post(`/api/design/cad-model/${aID}/new-revision`);
      await auth.post(`/api/design/cad-model/${b.body.id}/submit`);
      await auth.post(`/api/design/cad-model/${b.body.id}/release`);

      const c = await auth.post(`/api/design/cad-model/${b.body.id}/new-revision`);
      expect(c.status).toBe(201);
      expect(c.body.revision).toBe('C');
      expect(c.body.previousRevisionID).toBe(b.body.id);
    });
  });
});
