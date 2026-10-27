const { authenticatedRequest, createTestPart } = require('../../helpers');

const ORIGIN_TREE = { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 };
const EMPTY_DOC = { sketches: {}, nextSketchSeq: 1 };

describe('CAD Model CRUD (CAD-101, CAD-102, CAD-107)', () => {
  describe('POST /api/design/cad-model/by-part/:partID (CAD-102)', () => {
    it('creates a working copy for an existing part', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();

      const res = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'First CAD' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.partID).toBe(part.id);
      expect(res.body.createdByUserID).toBe(auth.user.id);
      expect(res.body.activeFlag).toBe(true);
    });

    it('initializes featureTree with a single origin feature and an empty sketch document', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();

      const res = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});

      expect(res.status).toBe(201);
      expect(res.body.featureTree).toBeDefined();
      expect(Array.isArray(res.body.featureTree.features)).toBe(true);
      expect(res.body.featureTree.features.length).toBe(1);
      expect(res.body.featureTree.features[0].type).toBe('origin');
      expect(res.body.sketchDoc).toBeDefined();
      expect(res.body.sketchDoc.sketches).toEqual({});
    });

    it('returns 404 with a human message when the part does not exist', async () => {
      const auth = await authenticatedRequest();

      const res = await auth.post('/api/design/cad-model/by-part/999999').send({ name: 'Orphan' });

      expect(res.status).toBe(404);
      expect(res.body.error || res.body.errorMessage).toMatch(/part/i);
    });

    it('rejects a second active model for the same part', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();

      const first = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
      expect(first.status).toBe(201);

      const second = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
      expect(second.status).toBe(409);
      expect(second.body.error || second.body.errorMessage).toMatch(/already|exist|revision/i);
    });
  });

  describe('GET /api/design/cad-model/by-part/:partID (CAD-102)', () => {
    it('lists only CAD models belonging to the given part', async () => {
      const auth = await authenticatedRequest();
      const partA = await createTestPart();
      const partB = await createTestPart();

      await auth.post(`/api/design/cad-model/by-part/${partA.id}`).send({});
      await auth.post(`/api/design/cad-model/by-part/${partB.id}`).send({});

      const res = await auth.get(`/api/design/cad-model/by-part/${partA.id}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].partID).toBe(partA.id);
    });

    it('omits inactive (soft-deleted) models', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();

      const created = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
      await auth.delete(`/api/design/cad-model/${created.body.id}`);

      const res = await auth.get(`/api/design/cad-model/by-part/${part.id}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(0);
    });
  });

  describe('GET /api/design/cad-model/by-part/:partID/active (CAD-102)', () => {
    it('returns the part\'s working copy', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();

      const a = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
      const res = await auth.get(`/api/design/cad-model/by-part/${part.id}/active`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(a.body.id);
    });

    it('returns 404 for a part with no CAD models', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const res = await auth.get(`/api/design/cad-model/by-part/${part.id}/active`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/design/cad-model/:id (CAD-101)', () => {
    it('returns the full payload including featureTree and sketchDoc', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const created = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});

      const res = await auth.get(`/api/design/cad-model/${created.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(created.body.id);
      expect(res.body.featureTree).toBeDefined();
      expect(res.body.sketchDoc).toBeDefined();
    });

    it('returns 404 when the model does not exist', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/design/cad-model/999999');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/design/cad-model/:id (CAD-101, CAD-105)', () => {
    it('updates featureTree and sketchDoc on a draft model and persists changes', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const created = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});

      const newTree = { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 }] };
      const newDoc = { sketches: { s1: { hostId: 'datum:xy_plane', primitives: [] } } };

      await auth.post(`/api/design/cad-model/${created.body.id}/checkout`).send({});
      const res = await auth.put(`/api/design/cad-model/${created.body.id}`)
        .send({ featureTree: newTree, sketchDoc: newDoc });
      expect(res.status).toBe(200);

      const reload = await auth.get(`/api/design/cad-model/${created.body.id}`);
      expect(reload.body.featureTree).toEqual(newTree);
      expect(reload.body.sketchDoc).toEqual(newDoc);
    });

    it('accepts a partial update with only featureTree (sketchDoc preserved)', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const created = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});

      const newTree = { features: [{ id: 'f1', type: 'origin' }] };
      await auth.post(`/api/design/cad-model/${created.body.id}/checkout`).send({});
      const res = await auth.put(`/api/design/cad-model/${created.body.id}`).send({ featureTree: newTree });
      expect(res.status).toBe(200);
      expect(res.body.sketchDoc).toEqual(EMPTY_DOC);
    });
  });

  describe('DELETE /api/design/cad-model/:id (CAD-107)', () => {
    it('soft-deletes a draft model (activeFlag=false) but the record persists', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();
      const created = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});

      const res = await auth.delete(`/api/design/cad-model/${created.body.id}`);
      expect([200, 204]).toContain(res.status);

      const get = await auth.get(`/api/design/cad-model/${created.body.id}`);
      expect(get.status).toBe(404);
    });

    it('allows creating a new model after the previous one is soft-deleted', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart();

      const first = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
      await auth.delete(`/api/design/cad-model/${first.body.id}`);

      const second = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({});
      expect(second.status).toBe(201);
      expect(second.body.partID).toBe(part.id);
    });
  });
});
