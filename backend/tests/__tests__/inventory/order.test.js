const { authenticatedRequest, createTestOrder, createTestPart } = require('../../helpers');
const request = require('supertest');

const getApp = () => require('../../app');

describe('Order API', () => {
  describe('GET /api/inventory/order', () => {
    it('lists all orders', async () => {
      const auth = await authenticatedRequest();
      await createTestOrder({ description: 'Order A' });
      await createTestOrder({ description: 'Order B' });

      const res = await auth.get('/api/inventory/order');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('includes OrderStatus association', async () => {
      const auth = await authenticatedRequest();
      await createTestOrder();
      const res = await auth.get('/api/inventory/order');
      expect(res.status).toBe(200);
      expect(res.body[0].OrderStatus).toBeDefined();
      expect(res.body[0].OrderStatus.name).toBe('Draft');
    });

    it('returns 401 without auth', async () => {
      const res = await request(getApp()).get('/api/inventory/order');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/inventory/order/statuses', () => {
    it('lists order statuses', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/order/statuses');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(4);
      expect(res.body[0].name).toBe('Draft');
    });
  });

  describe('GET /api/inventory/order/line-types', () => {
    it('lists order line types', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/order/line-types');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /api/inventory/order/:id', () => {
    it('gets order by id with includes', async () => {
      const auth = await authenticatedRequest();
      const order = await createTestOrder({ description: 'Detail Order' });
      const res = await auth.get(`/api/inventory/order/${order.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(order.id);
      expect(res.body.description).toBe('Detail Order');
      expect(res.body.OrderStatus).toBeDefined();
    });

    it('returns 404 for nonexistent order', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.get('/api/inventory/order/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/inventory/order', () => {
    it('creates an order', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/inventory/order')
        .send({
          description: 'New Order',
          vendor: 'Test Vendor',
          orderStatusID: 1,
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.description).toBe('New Order');
    });
  });

  describe('PUT /api/inventory/order/:id', () => {
    it('updates an order', async () => {
      const auth = await authenticatedRequest();
      const order = await createTestOrder();
      const res = await auth.put(`/api/inventory/order/${order.id}`)
        .send({ description: 'Updated Order', orderStatusID: 1 });
      // SQLite doesn't support returning:true, but update still applies
      expect([200]).toContain(res.status);
      const updated = await db.Order.findByPk(order.id);
      expect(updated.description).toBe('Updated Order');
    });
  });

  describe('DELETE /api/inventory/order/:id', () => {
    it('soft deletes an order', async () => {
      const auth = await authenticatedRequest();
      const order = await createTestOrder();
      const res = await auth.delete(`/api/inventory/order/${order.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.Order.findByPk(order.id);
      expect(deleted.activeFlag).toBe(false);
    });

    it('returns 404 for nonexistent order', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.delete('/api/inventory/order/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/inventory/order/bulk-import', () => {
    it('previews CSV import with dryRun', async () => {
      const auth = await authenticatedRequest();
      const csvContent = [
        'name,vendor,qty,price',
        'New Bulk Part,BulkVendor,10,5.99',
      ].join('\n');

      const res = await auth.post('/api/inventory/order/bulk-import?dryRun=true')
        .send({ csvContent, vendor: 'BulkVendor' });
      expect(res.status).toBe(200);
      expect(res.body.dryRun).toBe(true);
      expect(res.body.partsToCreate.length).toBe(1);
      expect(res.body.orderItems.length).toBe(1);
      expect(res.body.orderTotal).toBeCloseTo(59.9);
    });

    it('executes CSV import', async () => {
      const auth = await authenticatedRequest();
      const csvContent = [
        'name,vendor,qty,price',
        'Import Part A,ImpVendor,5,10.00',
      ].join('\n');

      const res = await auth.post('/api/inventory/order/bulk-import')
        .send({ csvContent, vendor: 'ImpVendor' });
      expect(res.status).toBe(200);
      expect(res.body.dryRun).toBeFalsy();
      expect(res.body.order.id).toBeDefined();
      expect(res.body.partsToCreate.length).toBe(1);

      // Verify order was created in DB
      const order = await db.Order.findByPk(res.body.order.id);
      expect(order).not.toBeNull();
    });

    it('recognizes existing parts', async () => {
      const auth = await authenticatedRequest();
      await createTestPart({ name: 'Existing Part' });

      const csvContent = [
        'name,vendor,qty,price',
        'Existing Part,TestVendor,3,15.00',
      ].join('\n');

      const res = await auth.post('/api/inventory/order/bulk-import?dryRun=true')
        .send({ csvContent });
      expect(res.status).toBe(200);
      expect(res.body.partsExisting.length).toBe(1);
      expect(res.body.partsToCreate.length).toBe(0);
    });

    it('returns 400 with no content', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/inventory/order/bulk-import')
        .send({});
      expect(res.status).toBe(400);
    });
  });
});
