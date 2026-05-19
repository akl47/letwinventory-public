import { describe, it, expect } from 'vitest';
import { fromMm, toMm, parseUserValue, formatWithUnit, formatNumber } from './units';

describe('unit conversions', () => {
  it('mm is the identity', () => {
    expect(fromMm(10, 'mm')).toBe(10);
    expect(toMm(10, 'mm')).toBe(10);
  });
  it('inch is 25.4 mm', () => {
    expect(toMm(1, 'in')).toBeCloseTo(25.4, 5);
    expect(fromMm(25.4, 'in')).toBeCloseTo(1, 5);
  });
  it('um is 0.001 mm', () => {
    expect(toMm(1000, 'um')).toBeCloseTo(1, 5);
    expect(fromMm(1, 'um')).toBeCloseTo(1000, 5);
  });
});

describe('parseUserValue', () => {
  it('treats a bare number as the default unit', () => {
    expect(parseUserValue('10', 'mm')).toEqual({ valueMm: 10, unit: null });
    expect(parseUserValue('10', 'in')).toEqual({ valueMm: 254, unit: null });
  });
  it('recognizes an mm suffix', () => {
    expect(parseUserValue('10mm', 'in')).toEqual({ valueMm: 10, unit: 'mm' });
    expect(parseUserValue('10 mm', 'in')).toEqual({ valueMm: 10, unit: 'mm' });
  });
  it('recognizes an inch suffix and the double-quote shorthand', () => {
    const expected = { valueMm: 25.4, unit: 'in' as const };
    expect(parseUserValue('1in', 'mm')).toEqual(expected);
    expect(parseUserValue('1 in', 'mm')).toEqual(expected);
    expect(parseUserValue('1"', 'mm')).toEqual(expected);
  });
  it('recognizes µm and um for micrometers', () => {
    expect(parseUserValue('500um', 'mm')).toEqual({ valueMm: 0.5, unit: 'um' });
    expect(parseUserValue('500µm', 'mm')).toEqual({ valueMm: 0.5, unit: 'um' });
  });
  it('returns null on unparseable input', () => {
    expect(parseUserValue('abc', 'mm')).toBeNull();
    expect(parseUserValue('10 furlongs', 'mm')).toBeNull();
    expect(parseUserValue('', 'mm')).toBeNull();
  });
});

describe('formatWithUnit', () => {
  it('strips trailing zeros and omits the suffix when not requested', () => {
    expect(formatWithUnit(10, 'mm', false)).toBe('10');
    expect(formatWithUnit(25.4, 'in', false)).toBe('1');
  });
  it('appends the unit symbol when requested', () => {
    expect(formatWithUnit(25.4, 'in', true)).toBe('1 in');
    expect(formatWithUnit(0.5, 'um', true)).toBe('500 µm');
  });
});

describe('formatNumber', () => {
  it('strips trailing zeros', () => {
    expect(formatNumber(10)).toBe('10');
    expect(formatNumber(10.5)).toBe('10.5');
    expect(formatNumber(10.500)).toBe('10.5');
  });
  it('rounds to maxDecimals', () => {
    expect(formatNumber(1.2345, 2)).toBe('1.23');
    expect(formatNumber(1.235, 2)).toBe('1.24');
  });
});
