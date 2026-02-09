const { authenticatedRequest, createTestOrder, createTestOrderItem, createTestPart } = require('../../helpers');

describe('OrderItem API', () => {
  describe('GET /api/inventory/orderitem/order/:orderID', () => {
    it('lists items for an order', async () => {
      const auth = await authenticatedRequest();
      const order = await createTestOrder();
      const part = await createTestPart({ name: 'OI-Part' });
      await createTestOrderItem({ orderID: order.id, partID: part.id, lineNumber: 1 });
      await createTestOrderItem({ orderID: order.id, partID: part.id, lineNumber: 2 });

      const res = await auth.get(`/api/inventory/orderitem/order/${order.id}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('returns empty array for order with no items', async () => {
      const auth = await authenticatedRequest();
      const order = await createTestOrder();
      const res = await auth.get(`/api/inventory/orderitem/order/${order.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('POST /api/inventory/orderitem', () => {
    it('creates an order item', async () => {
      const auth = await authenticatedRequest();
      const order = await createTestOrder();
      const part = await createTestPart({ name: 'NewOI-Part' });

      const res = await auth.post('/api/inventory/orderitem')
        .send({
          orderID: order.id,
          partID: part.id,
          orderLineTypeID: 1,
          lineNumber: 1,
          quantity: 10,
          price: 5.50,
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.quantity).toBe(10);
    });
  });

  describe('PUT /api/inventory/orderitem/:id', () => {
    it('updates an order item', async () => {
      const auth = await authenticatedRequest();
      const item = await createTestOrderItem();
      const res = await auth.put(`/api/inventory/orderitem/${item.id}`)
        .send({ quantity: 99 });
      expect(res.status).toBe(200);
      const updated = await db.OrderItem.findByPk(item.id);
      expect(updated.quantity).toBe(99);
    });
  });

  describe('DELETE /api/inventory/orderitem/:id', () => {
    it('soft deletes an order item', async () => {
      const auth = await authenticatedRequest();
      const item = await createTestOrderItem();
      const res = await auth.delete(`/api/inventory/orderitem/${item.id}`);
      expect(res.status).toBe(200);
      const deleted = await db.OrderItem.findByPk(item.id);
      expect(deleted.activeFlag).toBe(false);
    });
  });
});
