'use strict';

// REQ 903 — kernel connection pool: concurrent calls dispatch across separate
// connections (least-busy-first) instead of head-of-line blocking on one
// socket, and the client default timeout exceeds the kernel op timeout.

const net = require('net');
const { CadKernelPool, CadKernelClient } = require('../../../services/cadKernelClient');

// Tiny in-process kernel double: serial per connection (reads one line,
// responds after `delayMs`, then reads the next) — mirrors the real kernel's
// per-connection behavior so pooling is what the test actually measures.
function startFakeKernel(delayMs) {
  const connections = { count: 0 };
  const server = net.createServer((sock) => {
    connections.count += 1;
    let buf = '';
    let busy = Promise.resolve();
    sock.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        const req = JSON.parse(line);
        busy = busy.then(() => new Promise((r) => setTimeout(r, delayMs)).then(() => {
          sock.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { echo: req.method } }) + '\n');
        }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, connections }));
  });
}

describe('CAD kernel connection pool (REQ 903)', () => {
  test('default client timeout exceeds the kernel op timeout (60s) plus margin', () => {
    const client = new CadKernelClient();
    expect(client.timeoutMs).toBeGreaterThanOrEqual(75_000);
  });

  test('concurrent calls fan out across pooled connections instead of serializing', async () => {
    const DELAY = 150;
    const { server, port, connections } = await startFakeKernel(DELAY);
    const pool = new CadKernelPool({ size: 4, host: '127.0.0.1', port });
    try {
      const started = Date.now();
      const results = await Promise.all([
        pool.call('opA'), pool.call('opB'), pool.call('opC'), pool.call('opD'),
      ]);
      const elapsed = Date.now() - started;
      expect(results.map((r) => r.echo).sort()).toEqual(['opA', 'opB', 'opC', 'opD']);
      // Serial on one connection would take >= 4 * DELAY; pooled should be
      // roughly one DELAY. Assert well under the serial floor.
      expect(elapsed).toBeLessThan(3 * DELAY);
      expect(connections.count).toBeGreaterThanOrEqual(2);
    } finally {
      pool.shutdown();
      server.close();
    }
  });

  test('pool reuses an idle connection instead of growing unboundedly', async () => {
    const { server, port, connections } = await startFakeKernel(5);
    const pool = new CadKernelPool({ size: 4, host: '127.0.0.1', port });
    try {
      await pool.call('one');
      await pool.call('two'); // sequential — the idle connection must be reused
      expect(connections.count).toBe(1);
    } finally {
      pool.shutdown();
      server.close();
    }
  });
});
