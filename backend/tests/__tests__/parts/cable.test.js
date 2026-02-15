const { authenticatedRequest, createTestCable, createTestPart, createTestFile } = require('../../helpers');

describe('Cable API', () => {
  describe('GET /api/parts/cable', () => {
    it('lists all cables', async () => {
      const auth = await authenticatedRequest();
      await createTestCable({ label: 'CABLE-1' });
      await createTestCable({ label: 'CABLE-2' });

      const res = await auth.get('/api/parts/cable');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });
  });

  describe('GET /api/parts/cable/by-part/:partId', () => {
    it('gets cable by part id', async () => {
      const auth = await authenticatedRequest();
      const part = await createTestPart({ name: 'CablePart' });
      await createTestCable({ label: 'C-Part', partID: part.id });

      const res = await auth.get(`/api/parts/cable/by-part/${part.id}`);
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('C-Part');
    });

    it('includes part imageFile in response', async () => {
      const auth = await authenticatedRequest();
      const file = await createTestFile({ filename: 'cable-img.png' });
      const part = await createTestPart({ name: 'CableImgPart', imageFileID: file.id });
      await createTestCable({ label: 'C-Img', partID: part.id });

      const res = await auth.get(`/api/parts/cable/by-part/${part.id}`);
      expect(res.status).toBe(200);
      expect(res.body.part).toBeDefined();
      expect(res.body.part.imageFile).toBeDefined();
      expect(res.body.part.imageFile.id).toBe(file.id);
      expect(res.body.part.imageFile.data).toBeDefined();
    });

    it('returns null for nonexistent part id', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/parts/cable/by-part/99999');
      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });
  });

  describe('GET /api/parts/cable/:id', () => {
    it('gets cable by id', async () => {
      const auth = await authenticatedRequest();
      const cable = await createTestCable({ label: 'C-Get' });
      const res = await auth.get(`/api/parts/cable/${cable.id}`);
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('C-Get');
    });

    it('returns 404 for nonexistent', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/parts/cable/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/parts/cable', () => {
    it('creates a cable', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/parts/cable')
        .send({
          label: 'C-NEW',
          wireCount: 3,
          wires: [
            { id: 1, color: 'Red', colorCode: 'RD' },
            { id: 2, color: 'Black', colorCode: 'BK' },
            { id: 3, color: 'Green', colorCode: 'GN' },
          ],
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.id).toBeDefined();
      expect(res.body.label).toBe('C-NEW');
      expect(res.body.wireCount).toBe(3);
    });
  });

  describe('PUT /api/parts/cable/:id', () => {
    it('updates a cable', async () => {
      const auth = await authenticatedRequest();
      const cable = await createTestCable({ label: 'C-UPD' });
      const res = await auth.put(`/api/parts/cable/${cable.id}`)
        .send({ gaugeAWG: '18' });
      expect(res.status).toBe(200);
      const updated = await db.Cable.findByPk(cable.id);
      expect(updated.gaugeAWG).toBe('18');
    });
  });

  describe('DELETE /api/parts/cable/:id', () => {
    it('soft deletes a cable', async () => {
      const auth = await authenticatedRequest();
      const cable = await createTestCable({ label: 'C-DEL' });
      const res = await auth.delete(`/api/parts/cable/${cable.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.Cable.findByPk(cable.id);
      expect(deleted.activeFlag).toBe(false);
    });
  });
});
