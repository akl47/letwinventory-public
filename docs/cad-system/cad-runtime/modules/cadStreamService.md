# cadStreamService — WebSocket Session Manager

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Regeneration Pipeline](../regen-pipeline.md) ▸ **cadStreamService**
> Related: [cadRegenService](./cadRegenService.md)

---

## Requirements

Requirements: governed by [Regeneration Pipeline](../regen-pipeline.md). There is no dedicated REQ for the WebSocket transport itself; the streaming behavior it enables is implied by the incremental-regen design described in the regen-pipeline doc.

---

## Succinct description

`cadStreamService.js` is a singleton WebSocket server attached to the `/ws/cad` path. It manages per-connection JWT authentication, per-connection model subscriptions, and a `broadcastToModel(modelId, event)` fan-out used by the regeneration endpoint to push per-feature geometry results to every subscribed editor tab in real time.

## How it works — for everyone (non-technical)

While the server is regenerating a model, it can send each finished piece of geometry to the browser as soon as it's ready — you don't have to wait for the whole model to finish before you see the first solid appear. This WebSocket service is the pipeline: it authenticates each browser connection, tracks which model each tab has open, and delivers geometry events the moment they come off the assembly line.

## How it works — in detail (technical)

### Export

```javascript
module.exports = instance;  // singleton CadStreamService
```

`backend/index.js` calls `instance.initialize(server)` once at startup.

### Protocol (line-delimited JSON)

```
client → server:
  { type: 'authenticate',    token: '<jwt>' }
  { type: 'subscribe-model', modelId: <number> }
  { type: 'heartbeat' }

server → client:
  { type: 'authenticated',       userId, displayName }
  { type: 'auth-failed',         reason }
  { type: 'subscribed',          modelId }
  { type: 'heartbeat-ack' }
  { type: 'regenerate-started',  modelId }
  { type: 'feature-result',      featureId, faces, ... }
  { type: 'regenerate-complete', modelId, errors }
  { type: 'error',               reason }
```

### Initialization

Uses `noServer: true` mode (no `server:` option on the `WebSocket.Server` constructor) because the shared HTTP server already has an upgrade listener dispatched from `backend/index.js`. Multiple `WebSocket.Server` instances each installing their own upgrade listener would race and destroy each other's sockets for non-matching paths. The supervisor instead calls `this.wss.handleUpgrade(req, socket, head, ws => ...)` after checking `pathname === '/ws/cad'`.

### Session lifecycle

Each accepted WebSocket gets a session object:

```javascript
{ authenticated: false, userId, displayName, modelId, lastHeartbeat }
```

A 10-second auth timeout fires `ws.close(4001)` if the client hasn't sent an `authenticate` message. Auth validates the JWT against `JWT_SECRET`, populates `userId` + `displayName`, and sends `{ type: 'authenticated' }`. Failed auth closes the socket immediately.

After auth the client sends `{ type: 'subscribe-model', modelId }` to bind to a model. Only messages for the subscribed model reach this session via `broadcastToModel`.

### `broadcastToModel(modelId, event)`

```javascript
broadcastToModel(modelId, event)
```

Serialises `event` to JSON and sends it to every session where `session.authenticated && session.modelId === modelId && ws.readyState === OPEN`. The regeneration controller calls this via the `onFeatureResult` callback passed to `cadRegenService.regenerateModel`.

### Heartbeat sweep

A `setInterval` runs every 60 seconds and terminates sessions whose `lastHeartbeat` is older than 120 seconds (any received message updates `lastHeartbeat`, including the explicit `heartbeat` type).

### Shutdown

`cadStreamService.shutdown()` clears the interval, sends `close(1001, 'shutdown')` to all clients, closes the WebSocket server, and clears the sessions map.

---

## Key files

- `backend/services/cadStreamService.js` — this module
- `backend/services/cadRegenService.js` — calls `cadStreamService.broadcastToModel` via `onFeatureResult`
- `backend/index.js` — calls `initialize(server)` and routes `/ws/cad` upgrade events
