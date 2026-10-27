#!/usr/bin/env node
// CAD kernel Phase 0 spike — proves the end-to-end path:
//
//   1. Connect to the cad-kernel over TCP (default 127.0.0.1:9876)
//   2. Send a `buildExtrude` JSON-RPC request for a simple cylinder
//   3. Print the face count + bounding box of the result
//
// Run:
//   # Terminal 1
//   cd cad-kernel && cargo run --release
//
//   # Terminal 2
//   node backend/scripts/cad-spike.js
//
// You can also pass `--rectangle` to test a 4-line profile, or `--flipped`
// to verify the direction flag. Override the bind with `CAD_KERNEL_ADDR=...`.

'use strict';

const net = require('net');
const readline = require('readline');

const ADDR_RAW = process.env.CAD_KERNEL_ADDR || '127.0.0.1:9876';
const [HOST, PORT_STR] = ADDR_RAW.includes(':') ? ADDR_RAW.split(':') : ['127.0.0.1', ADDR_RAW];
const PORT = Number(PORT_STR);

const args = new Set(process.argv.slice(2));
const useRectangle = args.has('--rectangle');
const flipped = args.has('--flipped');

const profile = useRectangle
  ? [
      { kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: 'line', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
      { kind: 'line', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
      { kind: 'line', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
    ]
  : [{ kind: 'circle', center: { x: 0, y: 0 }, radius: 10 }];

const request = {
  jsonrpc: '2.0',
  id: 1,
  method: 'buildExtrude',
  params: {
    featureId: 'spike-test',
    profile,
    plane: {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    },
    distance: 20,
    flipped,
  },
};

const client = net.createConnection({ host: HOST, port: PORT }, () => {
  console.log(`[spike] connected to ${HOST}:${PORT}`);
  client.write(JSON.stringify(request) + '\n');
});

const rl = readline.createInterface({ input: client });

rl.on('line', (line) => {
  let response;
  try {
    response = JSON.parse(line);
  } catch (err) {
    console.error(`[spike] failed to parse response: ${err}`);
    process.exit(1);
  }
  if (response.error) {
    console.error('[spike] RPC error:', response.error);
    client.end();
    process.exit(1);
  }
  const result = response.result;
  if (!result) {
    console.error('[spike] empty result');
    client.end();
    process.exit(1);
  }
  summarize(result);
  client.end();
});

client.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(`[spike] no kernel listening at ${SOCKET_PATH}`);
    console.error('[spike] start it first: cd cad-kernel && python -m cad_kernel');
  } else {
    console.error('[spike] socket error:', err.message);
  }
  process.exit(1);
});

client.on('end', () => {
  process.exit(0);
});

function summarize(result) {
  const faces = result.faces || [];
  console.log(`[spike] received ${faces.length} face(s)`);
  for (const f of faces) {
    const tri = f.indices.length / 3;
    const verts = f.positions.length / 3;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < f.positions.length; i += 3) {
      const x = f.positions[i], y = f.positions[i + 1], z = f.positions[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    console.log(`  ${f.faceId}`);
    console.log(`    triangles=${tri} verts=${verts} isFlat=${f.isFlat}`);
    console.log(`    bbox: x=[${minX.toFixed(2)}, ${maxX.toFixed(2)}] ` +
                `y=[${minY.toFixed(2)}, ${maxY.toFixed(2)}] ` +
                `z=[${minZ.toFixed(2)}, ${maxZ.toFixed(2)}]`);
  }
  const brep = result.brepBytes || '';
  console.log(`[spike] BREP payload: ${brep.length} base64 chars`);
  const top = result.topology || {};
  console.log(`[spike] topology: ${(top.vertices || []).length} vertices, ` +
              `${(top.edges || []).length} edges`);
}
