# cadKernelClient — JSON-RPC Kernel Transport

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Regeneration Pipeline](../regen-pipeline.md) ▸ **cadKernelClient**
> Related: [cadKernelSupervisor](./cadKernelSupervisor.md) · [cadRegenService](./cadRegenService.md) · [Kernel overview](../../kernel/00-overview.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 744 | unapproved | CAD-kernel availability via a dedicated health probe (lightweight ping) |

### REQ 744 — Kernel health probe

- **Description:** The CAD editor shall determine CAD-kernel availability via a dedicated health probe (a lightweight kernel ping with a short timeout), not by routing a regeneration request and treating a timeout as unavailable.
- **Rationale:** Using a real regen request as an availability check wastes a kernel slot and confuses error reporting. A dedicated ping separates liveness from correctness.
- **Verification:** Integration test — `backend/tests/__tests__/vcs/cad-kernel-status.test.js` verifies that a ping call succeeds and returns in under the configured timeout.
- **Validation:** The editor displays a clear "kernel unavailable" state when the kernel is unreachable, without timing out a real operation.

---

## Succinct description

`cadKernelClient.js` is a thin JSON-RPC 2.0 client that multiplexes request/response pairs over a single persistent TCP connection to the Rust/OCCT CAD kernel sidecar. All kernel calls in the backend go through a singleton `CadKernelClient` instance returned by `getDefaultClient()`.

## How it works — for everyone (non-technical)

The Rust geometry engine is a separate process that speaks a simple request/response language (JSON-RPC) over a TCP socket. This module is the translator: it packages each geometry request into a message, sends it down the socket, and delivers the response back to whichever piece of code made the request — even when several requests are in-flight at once. If the connection drops, the next request reconnects automatically.

## How it works — in detail (technical)

### Exports

```javascript
module.exports = { CadKernelClient, KernelDisconnected, KernelRpcError, getDefaultClient, DEFAULT_ADDR };
```

### Transport design

- **Protocol:** line-delimited UTF-8 JSON-RPC 2.0. Each request is `{ jsonrpc: '2.0', id, method, params }` followed by a newline; each response is the same format on a single line.
- **Address:** `CAD_KERNEL_ADDR` env var, defaulting to `127.0.0.1:9876`. Docker setups must set `host.docker.internal:9876` so the container can reach the host-side kernel. TCP is used instead of a Unix socket because the typical dev setup crosses a Docker boundary.
- **Multiplexing:** an auto-incrementing `nextId` is stamped on each outgoing message. Responses are matched back to their callers via a `pending` Map keyed by id. Multiple in-flight requests coexist safely.
- **Nagle disabled:** `sock.setNoDelay(true)` matches the kernel's `TCP_NODELAY` — JSON-RPC requests are small, so Nagle batching would add latency without benefit.

### `CadKernelClient` class

```javascript
class CadKernelClient {
  constructor({ host, port, timeoutMs = 30_000 } = {})
  async call(method, params = {}, { timeoutMs } = {}) → Promise<result>
  shutdown()
}
```

`call` lazily connects (`_ensureConnected` — idempotent; a single `connecting` promise prevents races). The promise resolves with `msg.result` on success or rejects with `KernelRpcError(method, code, message, data)` on a remote error, or `KernelDisconnected` on a socket failure or timeout.

Per-call `timeoutMs` override lets lightweight probes (e.g. `ping`) fail quickly on a wedged kernel without waiting 30 seconds. The default is intentionally generous — a heavy `buildBoolean` on a large mesh can take several seconds.

On socket close, all pending calls are immediately rejected with `KernelDisconnected('socket closed')`.

### Reconnect behaviour

No explicit reconnect logic: `_ensureConnected` checks `this.socket && !this.socket.destroyed`. If the socket was destroyed (closed, error), the next `call()` triggers a fresh `net.createConnection`. In-flight calls at the time of disconnection are failed immediately — callers (the regen service) must decide whether to retry the full regen.

### Error types

| Class | When thrown |
|---|---|
| `KernelDisconnected` | Socket error, timeout, or `shutdown()` called |
| `KernelRpcError` | Kernel returned a JSON-RPC `error` object |

### Singleton

```javascript
function getDefaultClient() {
  if (!_default) _default = new CadKernelClient();
  return _default;
}
```

The Node API server shares one `CadKernelClient` for its lifetime. Tests construct their own instances for isolation via `jest.spyOn(cadKernelClient, 'getDefaultClient')`.

---

## Key files

- `backend/services/cadKernelClient.js` — this module
- `cad-kernel/src/server.rs` — the Rust end of the TCP connection
- `cad-kernel/src/protocol.rs` — the RPC message schema
