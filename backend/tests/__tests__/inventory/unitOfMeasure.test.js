const { authenticatedRequest } = require('../../helpers');

describe('UnitOfMeasure API', () => {
  describe('GET /api/inventory/unitofmeasure', () => {
    it('lists all units of measure', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/unitofmeasure');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      expect(res.body.find(u => u.name === 'Each')).toBeDefined();
      expect(res.body.find(u => u.name === 'Feet')).toBeDefined();
    });
  });
});
