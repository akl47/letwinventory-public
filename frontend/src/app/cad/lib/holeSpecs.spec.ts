import { describe, it, expect } from 'vitest';
import {
  ANSI_SIZE_KEYS, ISO_SIZE_KEYS,
  defaultSizeFor, holeSpec, sizeOptions,
} from './holeSpecs';

describe('holeSpecs — REQ 664', () => {
  it('ISO table covers M2 through M12', () => {
    expect(ISO_SIZE_KEYS).toHaveLength(9);
    expect(ISO_SIZE_KEYS).toEqual(['M2', 'M2_5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12']);
  });

  it('ANSI table covers #4 through 1/2"', () => {
    expect(ANSI_SIZE_KEYS).toHaveLength(9);
    expect(ANSI_SIZE_KEYS).toEqual(['N4', 'N6', 'N8', 'N10', 'I1_4', 'I5_16', 'I3_8', 'I7_16', 'I1_2']);
  });

  it('every ISO entry has tap-drill < clearance-drill < counterbore Ø', () => {
    for (const key of ISO_SIZE_KEYS) {
      const s = holeSpec('iso', key);
      expect(s.tapDrillDiameter).toBeGreaterThan(0);
      expect(s.clearanceDrillDiameter).toBeGreaterThan(s.tapDrillDiameter);
      expect(s.counterboreDiameter).toBeGreaterThan(s.clearanceDrillDiameter);
    }
  });

  it('every ANSI entry has tap-drill < clearance-drill < counterbore Ø', () => {
    for (const key of ANSI_SIZE_KEYS) {
      const s = holeSpec('ansi', key);
      expect(s.tapDrillDiameter).toBeGreaterThan(0);
      expect(s.clearanceDrillDiameter).toBeGreaterThan(s.tapDrillDiameter);
      expect(s.counterboreDiameter).toBeGreaterThan(s.clearanceDrillDiameter);
    }
  });

  it('ISO countersink angle is 90°; ANSI is 82°', () => {
    for (const key of ISO_SIZE_KEYS) expect(holeSpec('iso', key).countersinkAngleDeg).toBe(90);
    for (const key of ANSI_SIZE_KEYS) expect(holeSpec('ansi', key).countersinkAngleDeg).toBe(82);
  });

  it('thread pitch and major Ø are positive everywhere', () => {
    for (const key of ISO_SIZE_KEYS) {
      const s = holeSpec('iso', key);
      expect(s.threadPitch).toBeGreaterThan(0);
      expect(s.threadMajorDiameter).toBeGreaterThan(s.tapDrillDiameter);
    }
    for (const key of ANSI_SIZE_KEYS) {
      const s = holeSpec('ansi', key);
      expect(s.threadPitch).toBeGreaterThan(0);
      expect(s.threadMajorDiameter).toBeGreaterThan(s.tapDrillDiameter);
    }
  });

  it('throws on unknown size key', () => {
    expect(() => holeSpec('iso', 'NOPE' as any)).toThrow(/Unknown hole size/);
    expect(() => holeSpec('ansi', 'M3' as any)).toThrow(/Unknown hole size/);
  });

  it('sizeOptions returns labeled entries in display order', () => {
    const iso = sizeOptions('iso');
    expect(iso.map(o => o.label)).toEqual(['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12']);
    const ansi = sizeOptions('ansi');
    expect(ansi[0].label).toBe('#4');
    expect(ansi.at(-1)?.label).toBe('1/2');
  });

  it('defaultSizeFor picks a valid mid-range key', () => {
    expect(holeSpec('iso', defaultSizeFor('iso'))).toBeDefined();
    expect(holeSpec('ansi', defaultSizeFor('ansi'))).toBeDefined();
  });
});
