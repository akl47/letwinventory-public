#!/usr/bin/env node
/**
 * Local server for the requirements review page.
 * Serves static files and provides a POST endpoint to save requirements-data.json.
 *
 * Usage: node scripts/review-server.js [--port 8080]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = __dirname;
const DATA_FILE = path.join(SCRIPTS_DIR, 'requirements-data.json');

const portArg = process.argv.indexOf('--port');
const PORT = portArg !== -1 ? parseInt(process.argv[portArg + 1], 10) : 8080;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);
  // Save endpoint
  if (req.method === 'POST' && req.url === '/save') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        const data = JSON.parse(body);
        // Strip internal fields and sort by id for clean output
        const clean = data.map(r => {
          const { _depth, ...rest } = r;
          return rest;
        }).sort((a, b) => a.id - b.id);
        fs.writeFileSync(DATA_FILE, JSON.stringify(clean, null, 2) + '\n');
        console.log(`Saved ${clean.length} requirements`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        console.error('Save error:', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Static file serving
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end();
    return;
  }

  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/review-requirements.html';
  const fullPath = path.join(SCRIPTS_DIR, filePath);

  // Prevent directory traversal
  if (!fullPath.startsWith(SCRIPTS_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Review server running at http://localhost:${PORT}`);
});
