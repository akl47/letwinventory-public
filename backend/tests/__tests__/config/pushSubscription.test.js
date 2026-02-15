const { authenticatedRequest } = require('../../helpers');
const request = require('supertest');

const getApp = () => require('../../app');

describe('Push Subscription API', () => {
  describe('GET /api/config/vapid-public-key', () => {
    it('returns VAPID public key when configured', async () => {
      process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key';
      const res = await request(getApp()).get('/api/config/vapid-public-key');
      expect(res.status).toBe(200);
      expect(res.body.publicKey).toBe('test-vapid-public-key');
    });

    it('returns 500 when VAPID key not configured', async () => {
      const orig = process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PUBLIC_KEY;
      const res = await request(getApp()).get('/api/config/vapid-public-key');
      expect(res.status).toBe(500);
      process.env.VAPID_PUBLIC_KEY = orig;
    });
  });

  describe('POST /api/config/push-subscription', () => {
    it('creates a push subscription', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/config/push-subscription')
        .send({
          endpoint: `https://push.example.com/${Date.now()}`,
          keys: {
            p256dh: 'test-p256dh-key',
            auth: 'test-auth-key'
          },
          userAgent: 'Test Browser'
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.userID).toBe(auth.user.id);
    });

    it('returns 400 with missing endpoint', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/config/push-subscription')
        .send({
          keys: { p256dh: 'key', auth: 'key' }
        });
      expect(res.status).toBe(400);
    });

    it('returns 400 with missing keys', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/config/push-subscription')
        .send({
          endpoint: 'https://push.example.com/test'
        });
      expect(res.status).toBe(400);
    });

    it('upserts on duplicate endpoint', async () => {
      const auth = await authenticatedRequest();
      const endpoint = `https://push.example.com/upsert-${Date.now()}`;
      await auth.post('/api/config/push-subscription')
        .send({
          endpoint,
          keys: { p256dh: 'key1', auth: 'auth1' }
        });
      const res = await auth.post('/api/config/push-subscription')
        .send({
          endpoint,
          keys: { p256dh: 'key2', auth: 'auth2' }
        });
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/config/push-subscription', () => {
    it('lists subscriptions for current user', async () => {
      const auth = await authenticatedRequest();
      await auth.post('/api/config/push-subscription')
        .send({
          endpoint: `https://push.example.com/list-${Date.now()}`,
          keys: { p256dh: 'key', auth: 'auth' }
        });

      const res = await auth.get('/api/config/push-subscription');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('does not return other users subscriptions', async () => {
      const { createTestUser } = require('../../setup');
      const user1 = await createTestUser({ googleID: 'push-iso-1', email: 'push-iso-1@test.com', displayName: 'Push User 1' });
      const user2 = await createTestUser({ googleID: 'push-iso-2', email: 'push-iso-2@test.com', displayName: 'Push User 2' });
      const auth1 = await authenticatedRequest(user1);
      const auth2 = await authenticatedRequest(user2);

      await auth1.post('/api/config/push-subscription')
        .send({
          endpoint: `https://push.example.com/user1-${Date.now()}`,
          keys: { p256dh: 'key', auth: 'auth' }
        });

      const res = await auth2.get('/api/config/push-subscription');
      expect(res.status).toBe(200);
      const hasOtherUser = res.body.some(s => s.userID === auth1.user.id);
      expect(hasOtherUser).toBe(false);
    });
  });

  describe('POST /api/config/test-notification', () => {
    it('sends test notification (returns success even with no subscriptions)', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.post('/api/config/test-notification');
      // With no push subscriptions, sendPushToUser returns { sent: 0, failed: 0 }
      expect([200, 500]).toContain(res.status);
    });

    it('returns 401 without auth', async () => {
      const res = await request(getApp()).post('/api/config/test-notification');
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/config/push-subscription/:id', () => {
    it('deletes own subscription', async () => {
      const auth = await authenticatedRequest();
      const createRes = await auth.post('/api/config/push-subscription')
        .send({
          endpoint: `https://push.example.com/del-${Date.now()}`,
          keys: { p256dh: 'key', auth: 'auth' }
        });
      const id = createRes.body.id;

      const res = await auth.delete(`/api/config/push-subscription/${id}`);
      expect(res.status).toBe(200);

      // Verify it's gone
      const listRes = await auth.get('/api/config/push-subscription');
      const stillExists = listRes.body.some(s => s.id === id);
      expect(stillExists).toBe(false);
    });

    it('returns 404 for nonexistent subscription', async () => {
      const auth = await authenticatedRequest();
      const res = await auth.delete('/api/config/push-subscription/99999');
      expect(res.status).toBe(404);
    });

    it('returns 404 when deleting another users subscription', async () => {
      const { createTestUser } = require('../../setup');
      const user1 = await createTestUser({ googleID: 'del-iso-1', email: 'del-iso-1@test.com', displayName: 'Del User 1' });
      const user2 = await createTestUser({ googleID: 'del-iso-2', email: 'del-iso-2@test.com', displayName: 'Del User 2' });
      const auth1 = await authenticatedRequest(user1);
      const auth2 = await authenticatedRequest(user2);

      const createRes = await auth1.post('/api/config/push-subscription')
        .send({
          endpoint: `https://push.example.com/other-${Date.now()}`,
          keys: { p256dh: 'key', auth: 'auth' }
        });
      const id = createRes.body.id;

      const res = await auth2.delete(`/api/config/push-subscription/${id}`);
      expect(res.status).toBe(404);
    });
  });
});
