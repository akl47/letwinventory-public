import { describe, it, expect } from 'vitest';
import { csysDatumOf, FRAME_AXES, MATE_TYPES, availableMateTypes, datumRowMateRef, frameYOptions, isOriginRef, mateAllows, validMateTypes } from './assembly.types';

describe('origin mate helpers (REQ 998/999)', () => {
  it('recognises component and assembly origin refs', () => {
    expect(isOriginRef('i1::origin')).toBe(true);
    expect(isOriginRef('__assembly__::origin')).toBe(true);
    expect(isOriginRef('i1::xy_plane')).toBe(false);
    expect(isOriginRef(null)).toBe(false);
  });

  it('offers coincident for an origin pair', () => {
    expect(validMateTypes('point', 'point')).toContain('coincident');
  });

  it('Y can map onto any signed axis except the one X uses (either sign)', () => {
    expect(FRAME_AXES).toHaveLength(6);
    expect(frameYOptions('+x')).toEqual(['+y', '-y', '+z', '-z']);
    expect(frameYOptions('-z')).toEqual(['+x', '-x', '+y', '-y']);
  });
});

describe('mate sidebar filtering (REQ 1000)', () => {
  it('lists every mate type before anything is picked', () => {
    expect(MATE_TYPES).toEqual(['coincident', 'distance', 'parallel', 'perpendicular', 'angle', 'concentric', 'tangent', 'lock']);
    expect(availableMateTypes(null, null)).toEqual(MATE_TYPES);
  });

  it('narrows to types still completable after one pick', () => {
    expect(availableMateTypes('plane', null)).toEqual(['coincident', 'distance', 'parallel', 'perpendicular', 'angle', 'tangent', 'lock']);
    expect(availableMateTypes(null, 'cylinder')).toEqual(['concentric', 'tangent', 'lock']);
    expect(availableMateTypes('point', null)).toEqual(['coincident', 'distance', 'lock']);
    expect(availableMateTypes('other', null)).toEqual(['lock']);
  });

  it('uses the exact pair once both are picked', () => {
    expect(availableMateTypes('plane', 'cylinder')).toEqual(['tangent', 'lock']);
  });

  it('limits picks to references valid for the chosen type', () => {
    expect(mateAllows(null, 'other', null)).toBe(true);
    expect(mateAllows('lock', 'other', 'plane')).toBe(true);
    expect(mateAllows('concentric', 'plane', null)).toBe(false);
    expect(mateAllows('concentric', 'cylinder', null)).toBe(true);
    expect(mateAllows('tangent', 'cylinder', 'cylinder')).toBe(false);
    expect(mateAllows('tangent', 'plane', 'cylinder')).toBe(true);
    expect(mateAllows('coincident', 'point', 'plane')).toBe(false);
  });
});

describe('tree datum rows as mate refs (REQ 1001)', () => {
  it('maps assembly and component datum rows to scoped mate refs', () => {
    expect(datumRowMateRef('origin-datum:xy_plane')).toBe('__assembly__::xy_plane');
    expect(datumRowMateRef('component-datum:i3:z_axis')).toBe('i3::z_axis');
    expect(datumRowMateRef('component:i3')).toBeNull();
  });
});

describe('point coordinate-system refs (REQ 1006)', () => {
  it('treats a point coordinate-system origin as an origin ref', () => {
    expect(isOriginRef('i1::csys:pt1:origin')).toBe(true);
    expect(isOriginRef('__assembly__::csys:pt1:x_axis')).toBe(false);
    expect(csysDatumOf('csys:pt1:z_axis')).toBe('z_axis');
    expect(csysDatumOf('xy_plane')).toBe('xy_plane');
  });
});
