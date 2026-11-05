import { describe, it, expect } from 'vitest';
import { fitFrame, FIT_PAD } from './fitFrame';

// REQ 993 — zoom-to-fit frames the model as seen, for any viewport shape.
// A 100 × 10 × 10 bar from (0,0,0) to (100,10,10).
const bar = (visit: (x: number, y: number, z: number) => void) => {
  for (const x of [0, 100]) for (const y of [0, 10]) for (const z of [0, 10]) visit(x, y, z);
};
const FRONT = { x: 0, y: -1, z: 0 };
const Z = { x: 0, y: 0, z: 1 };
const SQ = { width: 400, height: 400 };
const WIDE = { width: 800, height: 400 };
const TALL = { width: 400, height: 800 };

describe('fitFrame', () => {
  it('centers on the model', () => {
    const f = fitFrame(bar, FRONT, Z, SQ)!;
    expect(f.center.x).toBeCloseTo(50);
    expect(f.center.y).toBeCloseTo(5);
    expect(f.center.z).toBeCloseTo(5);
  });

  it('a wide model on a wide canvas is limited by width / aspect', () => {
    expect(fitFrame(bar, FRONT, Z, WIDE)!.halfHeight).toBeCloseTo(25 * FIT_PAD);
  });

  it('a wide model on a portrait canvas zooms out until the width fits', () => {
    expect(fitFrame(bar, FRONT, Z, TALL)!.halfHeight).toBeCloseTo(100 * FIT_PAD);
  });

  it('frames the projected extent, not the largest world dimension', () => {
    // End-on, the 100-long bar is a 10 × 10 square.
    expect(fitFrame(bar, { x: 1, y: 0, z: 0 }, Z, SQ)!.halfHeight).toBeCloseTo(5 * FIT_PAD);
  });

  it('a tall model is limited by height on a wide canvas', () => {
    const tall = (visit: (x: number, y: number, z: number) => void) => { visit(0, 0, 0); visit(10, 0, 80); };
    expect(fitFrame(tall, FRONT, Z, WIDE)!.halfHeight).toBeCloseTo(40 * FIT_PAD);
  });

  it('survives an up hint parallel to the view direction', () => {
    const f = fitFrame(bar, Z, Z, SQ)!;
    expect(Number.isFinite(f.halfHeight)).toBe(true);
    expect(f.halfHeight).toBeCloseTo(50 * FIT_PAD);
  });

  it('insets shrink the usable area and shift the model into it', () => {
    // 100 px bottom band + 100 px right band on a 400 × 400 canvas.
    const f = fitFrame(bar, FRONT, Z, { ...SQ, right: 100, bottom: 100 })!;
    expect(f.halfHeight).toBeCloseTo(50 / 0.75 * FIT_PAD);
    // The target moves right/up of the model so the model lands up-left.
    const wpp = 2 * f.halfHeight / 400;
    expect(f.center.x).toBeCloseTo(50 + 50 * wpp);
    expect(f.center.z).toBeCloseTo(5 - 50 * wpp);
  });

  it('returns null with nothing to frame', () => {
    expect(fitFrame(() => {}, FRONT, Z, SQ)).toBeNull();
  });
});
