// REQ 1033 — model-scaled zoom limits + clip depth.
import { describe, it, expect } from 'vitest';
import { zoomLimits, clampZoom, clipDepth, MIN_HALF_HEIGHT, BASE_MAX_HALF_HEIGHT, BASE_CLIP_DEPTH } from './zoomLimits';

describe('zoomLimits', () => {
  it('falls back to the base range with no geometry', () => {
    expect(zoomLimits(null)).toEqual({ min: MIN_HALF_HEIGHT, max: BASE_MAX_HALF_HEIGHT });
    expect(zoomLimits(0)).toEqual({ min: MIN_HALF_HEIGHT, max: BASE_MAX_HALF_HEIGHT });
  });

  it('lets a small part zoom far below the old 5 mm floor', () => {
    expect(zoomLimits(5).min).toBe(MIN_HALF_HEIGHT);
    expect(clampZoom(0.01, 5)).toBe(0.01);
  });

  it('scales both limits with a large assembly', () => {
    const { min, max } = zoomLimits(10_000);  // 20 m across
    expect(min).toBeCloseTo(0.2, 9);
    expect(max).toBe(1_000_000);
    expect(clampZoom(5_000_000, 10_000)).toBe(1_000_000);
  });

  it('never drops the zoom-out limit below the base', () => {
    expect(zoomLimits(1).max).toBe(BASE_MAX_HALF_HEIGHT);
  });
});

describe('clipDepth', () => {
  it('keeps the base depth for ordinary views', () => {
    expect(clipDepth(200, 50)).toBe(BASE_CLIP_DEPTH);
  });

  it('covers the whole bounding sphere when zoomed far out', () => {
    expect(clipDepth(500_000, 10_000)).toBeGreaterThanOrEqual(510_000);
  });
});
