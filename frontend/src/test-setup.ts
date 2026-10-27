import { vi } from 'vitest';

// ── PlaneGCS WASM preload (unit-test runner only) ─────────────────────────────
// Angular's vitest-based unit-test builder serves modules over http, so the
// vendored Emscripten glue (planegcs.js) can't locate its `.wasm` on disk (it
// ends up fs-reading an `http:` path → ENOENT), and vitest's module isolation
// means monkeypatching node's `url`/`fs` from here doesn't reach planegcs's own
// `require(...)`. Instead, read the wasm bytes here and stash them on globalThis;
// `solver.ts` hands them to Emscripten as `Module.wasmBinary`, which bypasses ALL
// path/URL resolution. Uses `process.getBuiltinModule('fs')` — NO `node:` import,
// so the browser-target (e2e) build never has to resolve it. No-op off a Node
// runner or if the file is missing.
{
  const proc = (globalThis as {
    process?: { getBuiltinModule?: (m: string) => { readFileSync: (p: string) => Uint8Array }; cwd?: () => string };
  }).process;
  const getBuiltin = proc?.getBuiltinModule;
  if (getBuiltin && proc?.cwd) {
    try {
      const fs = getBuiltin('fs');
      const wasmPath = proc.cwd() + '/src/app/cad/vendor/planegcs/planegcs_dist/planegcs.wasm';
      (globalThis as { __PLANEGCS_WASM_BINARY__?: Uint8Array }).__PLANEGCS_WASM_BINARY__ =
        new Uint8Array(fs.readFileSync(wasmPath));
    } catch {
      // wasm not on disk — leave unset; solver.ts falls back to its normal loader.
    }
  }
}

// Mock ResizeObserver (not implemented in jsdom)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

// Mock HTMLCanvasElement.getContext globally to silence jsdom warnings:
// "Not implemented: HTMLCanvasElement's getContext() method"
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rotate: vi.fn(),
  transform: vi.fn(),
  setTransform: vi.fn(),
  resetTransform: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  bezierCurveTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  arc: vi.fn(),
  arcTo: vi.fn(),
  ellipse: vi.fn(),
  rect: vi.fn(),
  roundRect: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  clip: vi.fn(),
  isPointInPath: vi.fn(),
  isPointInStroke: vi.fn(),
  fillText: vi.fn(),
  strokeText: vi.fn(),
  measureText: vi.fn().mockReturnValue({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
  setLineDash: vi.fn(),
  getLineDash: vi.fn().mockReturnValue([]),
  drawImage: vi.fn(),
  createImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  putImageData: vi.fn(),
  createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
  createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
  createConicGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
  createPattern: vi.fn(),
  canvas: { width: 800, height: 600 },
  font: '10px sans-serif',
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  lineDashOffset: 0,
  textAlign: 'start',
  textBaseline: 'alphabetic',
  direction: 'ltr',
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'low',
  shadowBlur: 0,
  shadowColor: 'rgba(0, 0, 0, 0)',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  filter: 'none',
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;

HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,');
HTMLCanvasElement.prototype.toBlob = vi.fn().mockImplementation((cb: BlobCallback) => {
  cb(new Blob());
});
