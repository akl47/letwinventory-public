'use strict';

// Supervisor for the Rust CAD kernel sidecar.
//
// Opt-in: set `CAD_KERNEL_AUTOSPAWN=1` to have the Node server own the
// kernel's lifecycle. Default (off) preserves the manual `cargo run` dev
// workflow. Production deployments should turn this on.
//
// What it does:
//   - Spawns `cad-kernel` (compiled binary) as a child process.
//   - Pipes stdout/stderr through `console.log` / `console.error` so kernel
//     diagnostics show up in the same place as Node's.
//   - Restarts on crash with exponential backoff (1s → 2s → 4s → … capped
//     at 30s). Resets the backoff after a clean 60s of uptime.
//   - On process shutdown (SIGTERM, SIGINT) sends SIGTERM to the kernel and
//     waits up to 5s for it to drain in-flight requests, then SIGKILL.
//
// Binary location:
//   1. `CAD_KERNEL_BIN` if set (absolute path)
//   2. otherwise `<repo-root>/cad-kernel/target/release/cad-kernel`
//
// The kernel listens on TCP `127.0.0.1:9876` by default (override via
// `CAD_KERNEL_ADDR=0.0.0.0:9876` when the kernel must be reachable from a
// Docker-hosted backend). The existing cadKernelClient picks the address up
// from the same env var. No coordination here — the client just retries
// connecting on the next RPC.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DEFAULT_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const HEALTHY_UPTIME_MS = 60_000;
const SHUTDOWN_GRACE_MS = 5_000;

class CadKernelSupervisor {
  constructor() {
    this.child = null;
    this.shutdownRequested = false;
    this.backoffMs = DEFAULT_BACKOFF_MS;
    this.restartTimer = null;
    this.startedAt = 0;
  }

  initialize() {
    if (process.env.CAD_KERNEL_AUTOSPAWN !== '1') {
      console.log('[CadKernelSupervisor] disabled (set CAD_KERNEL_AUTOSPAWN=1 to enable)');
      return;
    }
    const bin = this._resolveBinary();
    if (!bin) {
      console.error('[CadKernelSupervisor] kernel binary not found — autospawn aborted');
      return;
    }
    this.binaryPath = bin;
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
    this._spawn();
  }

  shutdown() {
    if (this.shutdownRequested) return;
    this.shutdownRequested = true;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (!this.child) return;
    console.log('[CadKernelSupervisor] sending SIGTERM');
    try { this.child.kill('SIGTERM'); } catch (_) { /* ignore */ }
    const killTimer = setTimeout(() => {
      if (this.child) {
        console.warn('[CadKernelSupervisor] kernel did not exit within grace; SIGKILL');
        try { this.child.kill('SIGKILL'); } catch (_) { /* ignore */ }
      }
    }, SHUTDOWN_GRACE_MS);
    killTimer.unref();
  }

  // ─── internals ────────────────────────────────────────────────────────

  _resolveBinary() {
    if (process.env.CAD_KERNEL_BIN) {
      if (fs.existsSync(process.env.CAD_KERNEL_BIN)) return process.env.CAD_KERNEL_BIN;
      console.error('[CadKernelSupervisor] CAD_KERNEL_BIN=', process.env.CAD_KERNEL_BIN, 'does not exist');
      return null;
    }
    const candidate = path.resolve(__dirname, '..', '..', 'cad-kernel', 'target', 'release', 'cad-kernel');
    if (fs.existsSync(candidate)) return candidate;
    console.error('[CadKernelSupervisor] kernel binary not at', candidate, '— build it with `cargo build --release` from cad-kernel/');
    return null;
  }

  _spawn() {
    if (this.shutdownRequested) return;
    console.log('[CadKernelSupervisor] spawning', this.binaryPath);
    this.startedAt = Date.now();
    const child = spawn(this.binaryPath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    this.child = child;

    child.stdout.on('data', (chunk) => {
      process.stdout.write(`[cad-kernel] ${chunk}`);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(`[cad-kernel] ${chunk}`);
    });

    child.on('exit', (code, signal) => {
      this.child = null;
      const uptime = Date.now() - this.startedAt;
      console.warn(`[CadKernelSupervisor] kernel exited code=${code} signal=${signal} uptime=${uptime}ms`);
      if (this.shutdownRequested) return;
      // Reset backoff if the process ran healthily for a while.
      if (uptime > HEALTHY_UPTIME_MS) this.backoffMs = DEFAULT_BACKOFF_MS;
      const delay = this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      console.log(`[CadKernelSupervisor] restarting in ${delay}ms`);
      this.restartTimer = setTimeout(() => { this.restartTimer = null; this._spawn(); }, delay);
    });

    child.on('error', (err) => {
      console.error('[CadKernelSupervisor] spawn error:', err.message);
    });
  }
}

const instance = new CadKernelSupervisor();
module.exports = instance;
