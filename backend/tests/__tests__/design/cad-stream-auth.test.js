'use strict';

// REQ 944 — subscribing to a model on the CAD WebSocket stream requires an
// active user with cad.read (API-key scope applied); otherwise subscribe-denied
// and no events for that model.

const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const stream = require('../../../services/cadStreamService');
const { authenticatedRequest } = require('../../helpers');
const { createTestUser, generateToken } = require('../../setup');
const db = require('../../../models');

function fakeSocket() {
  return { readyState: WebSocket.OPEN, sent: [], send(m) { this.sent.push(JSON.parse(m)); }, close() {} };
}

async function subscribe(token, modelId = 42) {
  const ws = fakeSocket();
  const session = { authenticated: false, userId: null, modelId: null, lastHeartbeat: Date.now() };
  const timer = setTimeout(() => {}, 0);
  await stream._handleMessage(ws, session, { type: 'authenticate', token }, timer);
  await stream._handleMessage(ws, session, { type: 'subscribe-model', modelId }, timer);
  return { ws, session, last: ws.sent[ws.sent.length - 1] };
}

describe('CAD stream subscription authorization (REQ 944)', () => {
  test('a user with cad.read can subscribe', async () => {
    const auth = await authenticatedRequest();
    const { last, session } = await subscribe(auth.token);
    expect(last).toEqual({ type: 'subscribed', modelId: 42 });
    expect(session.modelId).toBe(42);
  });

  test('a user without cad.read is denied', async () => {
    const user = await createTestUser({ displayName: 'No Cad' });
    const { last, session } = await subscribe(generateToken(user));
    expect(last.type).toBe('subscribe-denied');
    expect(session.modelId).toBeNull();
  });

  test('a deactivated user with an unexpired token is denied', async () => {
    const auth = await authenticatedRequest();
    await db.User.update({ activeFlag: false }, { where: { id: auth.user.id } });
    const { last } = await subscribe(auth.token);
    expect(last.type).toBe('subscribe-denied');
  });

  test('an API key not scoped to cad.read is denied even if its owner has it', async () => {
    const auth = await authenticatedRequest();
    const perm = await db.Permission.findOne({ where: { resource: 'tasks', action: 'read' } });
    const key = await db.ApiKey.findOne({ where: { id: (await auth.post('/api/auth/api-key').send({ name: 'k', permissionIds: [perm.id] })).body.id } });
    const token = jwt.sign({ id: auth.user.id, email: auth.user.email, apiKeyId: key.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const { last } = await subscribe(token);
    expect(last.type).toBe('subscribe-denied');
  });

  test('a denied session receives no model broadcasts', async () => {
    const user = await createTestUser({ displayName: 'Snoop' });
    const { ws, session } = await subscribe(generateToken(user));
    stream.wss = stream.wss || { clients: new Set() };
    stream.sessions.set(ws, { ...session, authenticated: true });
    const before = ws.sent.length;
    stream.broadcastToModel(42, { type: 'feature-result', modelId: 42 });
    expect(ws.sent.length).toBe(before);
    stream.sessions.delete(ws);
  });
});
