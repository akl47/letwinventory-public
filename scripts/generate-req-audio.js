#!/usr/bin/env node
/**
 * Pre-generates TTS audio files for each requirement field.
 * Reads requirements-data.json, generates WAV files in scripts/audio/
 *
 * Output structure:
 *   scripts/audio/req-{id}-full.wav      (all fields combined)
 *   scripts/audio/req-{id}-description.wav
 *   scripts/audio/req-{id}-rationale.wav
 *   scripts/audio/req-{id}-verification.wav
 *   scripts/audio/req-{id}-validation.wav
 *   scripts/audio/req-{id}-parameter.wav
 *
 * Usage: node scripts/generate-req-audio.js [--force]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const TTS_BASE = 'http://10.50.10.25:4123';
const AUDIO_DIR = path.join(__dirname, 'audio');
const DATA_FILE = path.join(__dirname, 'requirements-data.json');
const FIELDS = ['description', 'rationale', 'verification', 'validation', 'parameter'];

const force = process.argv.includes('--force');

function tts(text) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${TTS_BASE}/v1/audio/speech`);
    const body = JSON.stringify({ input: text });
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          const body = Buffer.concat(chunks).toString('utf8').slice(0, 500);
          reject(new Error(`TTS returned ${res.statusCode}: ${body}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error('requirements-data.json not found. Run: node scripts/req.js list first.');
    process.exit(1);
  }

  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);

  const reqs = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  let generated = 0;
  let skipped = 0;
  const total = reqs.length;

  for (let i = 0; i < reqs.length; i++) {
    const req = reqs[i];
    const prefix = `req-${req.id}`;
    process.stdout.write(`[${i + 1}/${total}] REQ ${req.id}...`);

    // Generate per-field audio
    for (const field of FIELDS) {
      if (!req[field]) continue;
      const outFile = path.join(AUDIO_DIR, `${prefix}-${field}.wav`);
      if (!force && fs.existsSync(outFile)) { skipped++; continue; }

      const label = field.charAt(0).toUpperCase() + field.slice(1);
      const text = `${label}. ${req[field]}`;
      try {
        const wav = await tts(text);
        fs.writeFileSync(outFile, wav);
        generated++;
        await sleep(50); // small delay to not overwhelm server
      } catch (e) {
        console.error(` ERROR on ${field}: ${e.message}`);
      }
    }

    // Generate full combined audio
    const fullFile = path.join(AUDIO_DIR, `${prefix}-full.wav`);
    if (!force && fs.existsSync(fullFile)) {
      skipped++;
      console.log(' done');
      continue;
    }

    const parts = [`Requirement ${req.id}.`];
    for (const field of FIELDS) {
      if (req[field]) {
        const label = field.charAt(0).toUpperCase() + field.slice(1);
        parts.push(`${label}: ${req[field]}`);
      }
    }
    try {
      const wav = await tts(parts.join(' ... '));
      fs.writeFileSync(fullFile, wav);
      generated++;
      await sleep(50);
    } catch (e) {
      console.error(` ERROR on full: ${e.message}`);
    }

    console.log(' done');
  }

  console.log(`\nComplete: ${generated} generated, ${skipped} skipped (already exist)`);
  if (!force && skipped > 0) console.log('Use --force to regenerate all files');
}

main().catch(e => { console.error(e); process.exit(1); });
