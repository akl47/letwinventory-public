'use strict';

// Thin JSON-RPC 2.0 client to the Rust CAD kernel running as a sidecar
// process. Communicates over a TCP socket using line-delimited UTF-8 JSON —
// exactly what `cad-kernel/src/server.rs` accepts.
//
// Transport rationale: TCP over Unix domain socket because the typical dev
// setup has the Node backend in a Docker container while the kernel runs on
// the host (Rust + OCCT system deps are heavy for a container image). Unix
// sockets don't cross that boundary; TCP does. The localhost-loopback perf
// hit vs. Unix sockets is negligible for our payload size (per-feature mesh
// JSON, low-kHz call rate).
//
// One long-lived connection is shared across all callers; requests are
// multiplexed by their `id` and matched up via a pending-jobs map. The
// pattern mirrors `printAgentService.js`'s `pendingJobs` Map.
//
// Lifecycle:
//   const client = new CadKernelClient();
//   await client.call('buildExtrude', { ... });    // implicit connect
//   client.shutdown();                              // on process exit
//
// Reconnect: if the kernel dies or the socket closes, the next call() reopens
// the connection. In-flight calls reject with KernelDisconnected.

const net = require('net');

// CAD_KERNEL_ADDR is the canonical env var. Accept "host:port" or just
// "port" (assumes host = 127.0.0.1). Default `127.0.0.1:9876` is correct
// for non-Docker dev; Docker setups MUST set CAD_KERNEL_ADDR to
// `host.docker.internal:9876` in .env.development so the container can
// reach the kernel running on the host (the host-side kernel listens on
// 0.0.0.0 by default; see cad-kernel/src/main.rs).
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9876;
function parseAddr(raw) {
  if (!raw) return { host: DEFAULT_HOST, port: DEFAULT_PORT };
  if (/^\d+$/.test(raw)) return { host: DEFAULT_HOST, port: Number(raw) };
  const idx = raw.lastIndexOf(':');
  if (idx === -1) return { host: raw, port: DEFAULT_PORT };
  return { host: raw.slice(0, idx) || DEFAULT_HOST, port: Number(raw.slice(idx + 1)) };
}
const DEFAULT_ADDR = parseAddr(process.env.CAD_KERNEL_ADDR);
// MUST exceed the kernel's per-op timeout (CAD_KERNEL_OP_TIMEOUT_MS, default
// 60s) plus a margin (REQ 903): with a shorter client timeout, a slow op got a
// misleading client-side timeout while the kernel kept computing — and on a
// shared connection the late response was silently dropped while queued
// requests stalled behind the still-running op. 75s = 60s kernel enforcement
// (the kernel kills the op's worker child at its own deadline) + 15s margin.
const DEFAULT_TIMEOUT_MS = Number(process.env.CAD_KERNEL_CLIENT_TIMEOUT_MS) || 75_000;
// Kernel connections are SERIAL (one request processed at a time per
// connection), so cross-model concurrency comes from a pool of connections
// dispatched least-busy-first (REQ 903).
const DEFAULT_POOL_SIZE = Math.max(1, Number(process.env.CAD_KERNEL_POOL_SIZE) || 4);

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
  constructor({ host = DEFAULT_ADDR.host, port = DEFAULT_ADDR.port, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.lineBuffer = '';
    this.pending = new Map();           // id -> { resolve, reject, timeoutHandle }
    this.nextId = 1;
    this.connecting = null;             // Promise while a connect is in flight
    this.shuttingDown = false;
    this.inFlight = 0;                  // synchronous counter for pool dispatch
  }

  // Public RPC entry point. Resolves to the `result` payload from the
  // kernel; throws KernelRpcError on remote errors and KernelDisconnected on
  // socket errors. `inFlight` is bumped SYNCHRONOUSLY so the pool's
  // least-busy pick sees calls that are still awaiting their connection.
  call(method, params = {}, opts = {}) {
    this.inFlight += 1;
    return this._callInner(method, params, opts).finally(() => { this.inFlight -= 1; });
  }

  async _callInner(method, params = {}, { timeoutMs } = {}) {
    if (this.shuttingDown) throw new KernelDisconnected('client is shut down');
    await this._ensureConnected();
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    // Per-call override lets cheap probes (e.g. the `ping` health check) fail
    // fast instead of hanging on the 30 s default when the kernel is wedged.
    const t = timeoutMs || this.timeoutMs;
    // Diagnostic logging: every kernel RPC is logged with its id, payload size,
    // and a featureId hint (when present) on send, and its duration + outcome
    // (ok / rpc-error / timeout / disconnect) on settle. Makes a wedged or slow
    // kernel call visible from the backend side without guesswork. `ping` is
    // skipped to avoid spamming the log with the status-poll probe.
    const log = method !== 'ping';
    const featureHint = params && (params.featureId || params.feature_id) ? ` feature=${params.featureId || params.feature_id}` : '';
    const startedAt = Date.now();
    if (log) console.log(`[kernel-rpc] → #${id} ${method}${featureHint} payloadBytes=${payload.length} timeoutMs=${t}`);
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(id);
        if (log) console.error(`[kernel-rpc] ✗ #${id} ${method}${featureHint} TIMEOUT after ${Date.now() - startedAt}ms (limit ${t}ms) — kernel did not respond`);
        reject(new Error(`CAD kernel ${method} timed out after ${t}ms`));
      }, t);
      this.pending.set(id, {
        resolve: (v) => { if (log) console.log(`[kernel-rpc] ✓ #${id} ${method}${featureHint} ok in ${Date.now() - startedAt}ms`); resolve(v); },
        reject: (e) => { if (log) console.error(`[kernel-rpc] ✗ #${id} ${method}${featureHint} ${e && e.name || 'error'} in ${Date.now() - startedAt}ms: ${e && e.message}`); reject(e); },
        timeoutHandle,
        method,
      });
      this.socket.write(payload, (err) => {
        if (err) {
          clearTimeout(timeoutHandle);
          this.pending.delete(id);
          if (log) console.error(`[kernel-rpc] ✗ #${id} ${method}${featureHint} write failed in ${Date.now() - startedAt}ms: ${err.message}`);
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
      const sock = net.createConnection({ host: this.host, port: this.port }, () => {
        this.socket = sock;
        this.connecting = null;
        resolve();
      });
      // setNoDelay matches the kernel's TCP_NODELAY — JSON-RPC requests are
      // small so Nagle batching would add latency without benefit.
      sock.setNoDelay(true);
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

// Pool of single-connection clients (REQ 903). The kernel is thread-per-
// connection but SERIAL within a connection, so one shared socket meant every
// user's regen queued behind whatever op was in flight — a multi-user
// head-of-line block. The pool dispatches each call to the connection with
// the fewest in-flight requests; connections are created lazily on first use.
// Exposes the same `{ call, shutdown }` surface as CadKernelClient so all
// existing callers and test stubs keep working.
class CadKernelPool {
  constructor({ size = DEFAULT_POOL_SIZE, ...clientOpts } = {}) {
    this.size = size;
    this.clientOpts = clientOpts;
    this.clients = [];
  }

  _pick() {
    // Reuse the least-busy existing connection; open a new one only when all
    // existing connections are busy and the pool has room. `inFlight` is
    // maintained synchronously, so back-to-back calls in one tick fan out.
    let best = null;
    for (const c of this.clients) {
      if (!best || c.inFlight < best.inFlight) best = c;
    }
    if ((!best || best.inFlight > 0) && this.clients.length < this.size) {
      const fresh = new CadKernelClient(this.clientOpts);
      this.clients.push(fresh);
      return fresh;
    }
    return best;
  }

  call(method, params = {}, opts = {}) {
    return this._pick().call(method, params, opts);
  }

  shutdown() {
    for (const c of this.clients) c.shutdown();
    this.clients = [];
  }
}

// Singleton — the Node API server keeps one pool for its lifetime. Tests
// can construct their own instances for isolation.
let _default = null;
function getDefaultClient() {
  if (!_default) _default = new CadKernelPool();
  return _default;
}

// Dedicated client for the health probe (`kernelStatus`) ONLY, kept on its own
// TCP connection. The kernel processes requests on a single connection
// SERIALLY and runs OCCT ops synchronously inline, so a long build (e.g. a
// slow UnifySameDomain `clean()`) parks the default client's connection read
// loop — a ping queued behind it never gets read, times out, and the editor
// falsely shows "kernel offline." Since the kernel's runtime is multi-threaded,
// a ping arriving on a SEPARATE connection is answered by another worker thread
// while the build still churns, so the heartbeat correctly reports the kernel
// as up (just busy). This connection only ever carries `ping`, so it can never
// be wedged by a build.
let _heartbeat = null;
function getHeartbeatClient() {
  if (!_heartbeat) _heartbeat = new CadKernelClient();
  return _heartbeat;
}

module.exports = {
  CadKernelClient,
  CadKernelPool,
  KernelDisconnected,
  KernelRpcError,
  getDefaultClient,
  getHeartbeatClient,
  DEFAULT_ADDR,
};
