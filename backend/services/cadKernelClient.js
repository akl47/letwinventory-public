'use strict';

// Thin JSON-RPC 2.0 client to the Rust CAD kernel running as a sidecar
// process. Communicates over a Unix-domain socket using line-delimited UTF-8
// JSON — exactly what `cad-kernel/src/server.rs` accepts.
//
// One long-lived connection is shared across all callers; requests are
// multiplexed by their `id` and matched up via a pending-jobs map. The
// pattern mirrors `printAgentService.js`'s `pendingJobs` Map and the
// approach holds up for our throughput target (typical CAD model has
// dozens of features regenerated per edit).
//
// Lifecycle:
//   const client = new CadKernelClient();
//   await client.call('buildExtrude', { ... });    // implicit connect
//   client.shutdown();                              // on process exit
//
// Reconnect: if the kernel dies or the socket closes, the next call() reopens
// the connection. In-flight calls reject with KernelDisconnected.

const net = require('net');
const path = require('path');

const DEFAULT_SOCKET_PATH = process.env.CAD_KERNEL_SOCKET
  || '/tmp/letwinventory-cad-kernel.sock';
const DEFAULT_TIMEOUT_MS = 30_000;

class KernelDisconnected extends Error {
  constructor(detail) { super(`CAD kernel disconnected: ${detail}`); this.name = 'KernelDisconnected'; }
}

class KernelRpcError extends Error {
  constructor(method, code, message, data) {
    super(`CAD kernel ${method} failed (code ${code}): ${message}`);
    this.name = 'KernelRpcError';
    this.code = code;
    this.method = method;
    this.data = data;
  }
}

class CadKernelClient {
  constructor({ socketPath = DEFAULT_SOCKET_PATH, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.socketPath = socketPath;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.lineBuffer = '';
    this.pending = new Map();           // id -> { resolve, reject, timeoutHandle }
    this.nextId = 1;
    this.connecting = null;             // Promise while a connect is in flight
    this.shuttingDown = false;
  }

  // Public RPC entry point. Resolves to the `result` payload from the
  // kernel; throws KernelRpcError on remote errors and KernelDisconnected on
  // socket errors.
  async call(method, params = {}) {
    if (this.shuttingDown) throw new KernelDisconnected('client is shut down');
    await this._ensureConnected();
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CAD kernel ${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeoutHandle, method });
      this.socket.write(payload, (err) => {
        if (err) {
          clearTimeout(timeoutHandle);
          this.pending.delete(id);
          reject(new KernelDisconnected(err.message));
        }
      });
    });
  }

  shutdown() {
    this.shuttingDown = true;
    if (this.socket) {
      try { this.socket.destroy(); } catch (_) { /* ignore */ }
      this.socket = null;
    }
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timeoutHandle);
      entry.reject(new KernelDisconnected('client shutdown'));
    }
    this.pending.clear();
  }

  // ─── internals ────────────────────────────────────────────────────────

  async _ensureConnected() {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const sock = net.createConnection(this.socketPath, () => {
        this.socket = sock;
        this.connecting = null;
        resolve();
      });
      sock.setEncoding('utf8');
      sock.on('data', (chunk) => this._onData(chunk));
      sock.on('error', (err) => {
        this.connecting = null;
        this._onSocketError(err);
        reject(err);
      });
      sock.on('close', () => {
        this.connecting = null;
        if (this.socket === sock) this.socket = null;
        this._failPending(new KernelDisconnected('socket closed'));
      });
    });
    return this.connecting;
  }

  _onData(chunk) {
    this.lineBuffer += chunk;
    let newlineIdx;
    while ((newlineIdx = this.lineBuffer.indexOf('\n')) >= 0) {
      const line = this.lineBuffer.slice(0, newlineIdx).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1);
      if (!line) continue;
      this._dispatchResponse(line);
    }
  }

  _dispatchResponse(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      console.error('[CadKernelClient] invalid response line:', line.slice(0, 200));
      return;
    }
    const id = msg.id;
    const entry = this.pending.get(id);
    if (!entry) {
      // Either an unsolicited notification or a response to a request that
      // already timed out. Drop it.
      return;
    }
    this.pending.delete(id);
    clearTimeout(entry.timeoutHandle);
    if (msg.error) {
      entry.reject(new KernelRpcError(
        entry.method,
        msg.error.code,
        msg.error.message,
        msg.error.data,
      ));
    } else {
      entry.resolve(msg.result);
    }
  }

  _onSocketError(err) {
    console.error('[CadKernelClient] socket error:', err.message);
  }

  _failPending(err) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timeoutHandle);
      entry.reject(err);
    }
    this.pending.clear();
  }
}

// Singleton — the Node API server keeps one client for its lifetime. Tests
// can construct their own instances for isolation.
let _default = null;
function getDefaultClient() {
  if (!_default) _default = new CadKernelClient();
  return _default;
}

module.exports = {
  CadKernelClient,
  KernelDisconnected,
  KernelRpcError,
  getDefaultClient,
  DEFAULT_SOCKET_PATH,
};
