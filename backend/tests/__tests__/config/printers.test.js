const { authenticatedRequest } = require('../../helpers');

describe('Printers API', () => {
  describe('GET /api/config/printers', () => {
    it('returns empty array when no printers configured', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/config/printers');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('returns active printers', async () => {
      const auth = await authenticatedRequest();
      await db.Printer.create({
        name: 'Zebra 3x1',
        ipAddress: '10.50.20.91',
        description: 'Main printer',
        isDefault: true,
        activeFlag: true,
      });
      await db.Printer.create({
        name: 'Zebra 1.5x1',
        ipAddress: '10.50.20.92',
        description: 'Small labels',
        isDefault: false,
        activeFlag: true,
      });

      const res = await auth.get('/api/config/printers');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      // Default printer should be first (ordered by isDefault DESC)
      expect(res.body[0].isDefault).toBe(true);
    });

    it('excludes inactive printers', async () => {
      const auth = await authenticatedRequest();
      await db.Printer.create({
        name: 'Active Printer',
        ipAddress: '10.50.20.93',
        isDefault: false,
        activeFlag: true,
      });
      await db.Printer.create({
        name: 'Inactive Printer',
        ipAddress: '10.50.20.94',
        isDefault: false,
        activeFlag: false,
      });

      const res = await auth.get('/api/config/printers');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('Active Printer');
    });
  });
});
