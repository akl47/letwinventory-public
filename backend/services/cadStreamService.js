'use strict';

// WebSocket session manager for the CAD editor.
//
// Phase 1 v1 scope: connection lifecycle + JWT auth handshake + an
// announcement channel for regenerate progress events. Actual streaming of
// per-face mesh deltas (the Phase 1.5 incremental-edit path) lands once the
// frontend cutover can consume it.
//
// Modelled on `printAgentService.js`: a single WebSocket server attached to
// the shared HTTP server, per-connection state in a Map, heartbeat sweeper.
//
// Protocol (line-delimited JSON, no length prefix):
//
//   client → server:  { type: 'authenticate', token: '<jwt>' }
//   server → client:  { type: 'authenticated', userId, displayName }
//                  or { type: 'auth-failed', reason: '...' }
//
//   server → client:  { type: 'regenerate-started', modelId }
//                     { type: 'feature-result', featureId, faces }
//                     { type: 'regenerate-complete', modelId, errors }
//
// Binary frames are reserved for Phase 1.5 mesh deltas (header u32 quad +
// raw Float32Array payload), matching the plan.

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

class CadStreamService {
  constructor() {
    this.wss = null;
    this.sessions = new Map();  // ws -> { userId, displayName, modelId|null, lastHeartbeat }
    this.heartbeatInterval = null;
  }

  initialize(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws/cad' });
    this.wss.on('connection', (ws, req) => {
      console.log('[CadStream] new connection from:', req.socket.remoteAddress);
      this._handleConnection(ws);
    });
    this.heartbeatInterval = setInterval(() => this._sweepHeartbeats(), 60_000);
    console.log('[CadStream] WebSocket server initialized on /ws/cad');
  }

  shutdown() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.wss) {
      this.wss.clients.forEach(ws => { try { ws.close(1001, 'shutdown'); } catch (_) { /* noop */ } });
      this.wss.close();
    }
    this.sessions.clear();
  }

  /**
   * Push a JSON event to every session subscribed to `modelId`. Used by the
   * regenerate endpoint to fan progress + per-feature results out to any
   * connected editor tabs. Binary frames will land alongside this when
   * Phase 1.5 incremental editing arrives.
   */
  broadcastToModel(modelId, event) {
    if (!this.wss) return;
    const payload = JSON.stringify(event);
    for (const [ws, session] of this.sessions) {
      if (session.authenticated && session.modelId === modelId && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  // ─── connection lifecycle ─────────────────────────────────────────────

  _handleConnection(ws) {
    const session = {
      authenticated: false,
      userId: null,
      displayName: null,
      modelId: null,
      lastHeartbeat: Date.now(),
    };
    this.sessions.set(ws, session);

    const authTimeout = setTimeout(() => {
      if (!session.authenticated) {
        console.log('[CadStream] auth timeout — closing connection');
        try { ws.close(4001, 'authentication timeout'); } catch (_) { /* noop */ }
      }
    }, 10_000);

    ws.on('message', (data) => {
      session.lastHeartbeat = Date.now();
      let msg;
      try { msg = JSON.parse(data.toString()); }
      catch { return console.error('[CadStream] invalid JSON message'); }
      this._handleMessage(ws, session, msg, authTimeout).catch(err => {
        console.error('[CadStream] message handler error:', err);
      });
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      this.sessions.delete(ws);
      console.log('[CadStream] connection closed; sessions:', this.sessions.size);
    });

    ws.on('error', (err) => {
      console.error('[CadStream] socket error:', err.message);
    });
  }

  async _handleMessage(ws, session, msg, authTimeout) {
    if (msg.type === 'authenticate') {
      try {
        const decoded = jwt.verify(msg.token || '', process.env.JWT_SECRET);
        clearTimeout(authTimeout);
        session.authenticated = true;
        session.userId = decoded.id;
        session.displayName = decoded.displayName || decoded.email;
        ws.send(JSON.stringify({
          type: 'authenticated',
          userId: session.userId,
          displayName: session.displayName,
        }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'auth-failed', reason: err.message }));
        try { ws.close(4001, 'authentication failed'); } catch (_) { /* noop */ }
      }
      return;
    }
    if (!session.authenticated) {
      ws.send(JSON.stringify({ type: 'error', reason: 'not authenticated' }));
      return;
    }
    if (msg.type === 'subscribe-model') {
      session.modelId = Number(msg.modelId) || null;
      ws.send(JSON.stringify({ type: 'subscribed', modelId: session.modelId }));
      return;
    }
    if (msg.type === 'heartbeat') {
      ws.send(JSON.stringify({ type: 'heartbeat-ack' }));
      return;
    }
    // Unknown message types are dropped — Phase 1.5 will add edit-application
    // messages (`apply-edit`, `cancel-regen`, etc.) here.
  }

  _sweepHeartbeats() {
    const now = Date.now();
    const stale = 120_000;  // 2 min
    for (const [ws, session] of this.sessions) {
      if (now - session.lastHeartbeat > stale) {
        console.log('[CadStream] sweeping stale session');
        try { ws.terminate(); } catch (_) { /* noop */ }
        this.sessions.delete(ws);
      }
    }
  }
}

// Singleton — `backend/index.js` calls `.initialize(server)` once on startup.
const instance = new CadStreamService();
module.exports = instance;
