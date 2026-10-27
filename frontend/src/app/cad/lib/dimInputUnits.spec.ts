// REQ 940 — unit handling for the shared numeric field (app-dim-input).
//
// The component keeps values in canonical millimetres and uses these two
// units.ts primitives for display and entry. These tests pin the behaviour the
// component relies on, including the case that used to be silently wrong:
// `parseFloat('0.5in')` returns 0.5, which stored half a MILLIMETRE when the
// user asked for half an INCH.

import { describe, it, expect } from 'vitest';
import { formatNumber, fromMm, parseUserValue, resolveFieldEntry, unitSymbol, type Unit } from './units';

/** What the field commits for typed text, mirroring DimInputComponent.onCommit.
 * A bare number is interpreted in the MODEL unit, exactly as a sketch
 * dimension does — not in whatever unit the field is currently showing. */
const commit = (text: string, modelUnit: Unit): number | null =>
  parseUserValue(text.trim(), modelUnit)?.valueMm ?? null;

/** The unit override a commit leaves behind: an explicit suffix is remembered,
 * a bare number reverts the field to the model default (`null`). */
const overrideAfter = (text: string, modelUnit: Unit): Unit | null =>
  parseUserValue(text.trim(), modelUnit)?.unit ?? null;

/** Display precision per unit — mirrors DECIMALS in DimInputComponent. */
const DECIMALS: Record<Unit, number> = { mm: 3, um: 3, in: 5 };

/** Bare magnitude, for round-trip checks. */
const magnitude = (valueMm: number, fieldUnit: Unit): string =>
  formatNumber(fromMm(valueMm, fieldUnit), DECIMALS[fieldUnit]);

/** What the field displays: value + unit suffix, as a sketch dimension does. */
const display = (valueMm: number, fieldUnit: Unit): string =>
  `${magnitude(valueMm, fieldUnit)} ${unitSymbol(fieldUnit)}`;

describe('length field entry (REQ 940)', () => {
  it('interprets a bare number in the field\'s own unit', () => {
    expect(commit('10', 'mm')).toBe(10);
    expect(commit('2', 'in')).toBeCloseTo(50.8);
    expect(commit('500', 'um')).toBeCloseTo(0.5);
  });

  it('honours an explicit unit suffix that differs from the field unit', () => {
    // The whole point: an inch value typed into an mm-default field.
    expect(commit('0.5in', 'mm')).toBeCloseTo(12.7);
    expect(commit('0.5 in', 'mm')).toBeCloseTo(12.7);
    expect(commit('0.5"', 'mm')).toBeCloseTo(12.7);
    expect(commit('25.4mm', 'in')).toBeCloseTo(25.4);
    expect(commit('200um', 'mm')).toBeCloseTo(0.2);
    expect(commit('200µm', 'mm')).toBeCloseTo(0.2);
  });

  it('does NOT silently drop the suffix the way parseFloat did', () => {
    // Regression guard for the original bug.
    expect(parseFloat('0.5in')).toBe(0.5);        // what used to be stored (mm)
    expect(commit('0.5in', 'mm')).toBeCloseTo(12.7); // what is stored now
  });

  it('is case-insensitive and accepts leading-dot / signed numbers', () => {
    expect(commit('.5IN', 'mm')).toBeCloseTo(12.7);
    expect(commit('-2in', 'mm')).toBeCloseTo(-50.8);
  });

  it('rejects garbage so the field can restore its previous value', () => {
    for (const bad of ['', 'abc', '1 2', '10 furlongs', '--3']) {
      expect(commit(bad, 'mm')).toBeNull();
    }
  });

  it('round-trips display → entry without visible drift', () => {
    // The displayed text carries its own suffix, so re-committing it is
    // unit-safe regardless of the model default.
    for (const unit of ['mm', 'um', 'in'] as Unit[]) {
      for (const mm of [0.5, 10, 25.4, 123.456]) {
        expect(commit(display(mm, unit), 'mm')).toBeCloseTo(mm, 3);
      }
    }
  });

  it('an untouched field commits nothing (guards against display rounding)', () => {
    // DimInputComponent.onCommit returns early when the text is unchanged.
    // Without that guard a focus→blur on an inch field would store the
    // rounded display value back over the exact one.
    const stored = 0.5;                       // mm
    const shown = display(stored, 'in');      // what the user sees
    const unchanged = (typed: string) => typed.trim() === shown.trim();
    expect(unchanged(shown)).toBe(true);      // → early return, value untouched
    expect(unchanged('0.02 in')).toBe(false); // a real edit still commits
  });
});

describe('per-field unit override, mirroring a sketch dimension (REQ 940)', () => {
  it('remembers an explicitly typed unit', () => {
    expect(overrideAfter('0.5in', 'mm')).toBe('in');
    expect(overrideAfter('200um', 'mm')).toBe('um');
    // Explicit even when it matches the model default — same as a dimension.
    expect(overrideAfter('10mm', 'mm')).toBe('mm');
  });

  it('reverts to the model default when a bare number is typed', () => {
    expect(overrideAfter('10', 'mm')).toBeNull();
    expect(overrideAfter('10', 'in')).toBeNull();
  });

  it('interprets a bare number in the MODEL unit, not the displayed one', () => {
    // A field showing inches, retyped as a bare "1" with an mm model, commits
    // 1 mm and drops back to mm — exactly how a sketch dimension behaves.
    expect(commit('1', 'mm')).toBe(1);
    expect(overrideAfter('1', 'mm')).toBeNull();
  });

  it('shows the unit suffix so the displayed unit is never ambiguous', () => {
    expect(display(12.7, 'in')).toBe('0.5 in');
    expect(display(10, 'mm')).toBe('10 mm');
    expect(display(0.5, 'um')).toBe('500 µm');
  });
});

// resolveFieldEntry is the decision the FIELD actually runs. These exercise the
// real edit→blur flow, which the primitive-level tests above could not: an
// earlier version compared the typed text against the live edit buffer (i.e.
// against itself), so every commit was silently dropped and the field appeared
// to do nothing at all — including for plain numbers.
describe('resolveFieldEntry — the committed edit (REQ 940)', () => {
  const shown = display(10, 'mm');   // a field sitting at 10 mm

  it('commits a unit-suffixed entry typed over the displayed value', () => {
    for (const typed of ['0.5in', '0.5 in', '0.5"', '.5in', '0.5IN']) {
      expect(resolveFieldEntry(typed, shown, 'mm')).toEqual({
        kind: 'value', value: 12.7, unitOverride: 'in',
      });
    }
  });

  it('commits a plain number (the regression that made every field inert)', () => {
    expect(resolveFieldEntry('25', shown, 'mm')).toEqual({
      kind: 'value', value: 25, unitOverride: null,
    });
  });

  it('treats only genuinely unchanged text as a no-op', () => {
    expect(resolveFieldEntry(shown, shown, 'mm')).toEqual({ kind: 'noop' });
    expect(resolveFieldEntry(`  ${shown}  `, shown, 'mm')).toEqual({ kind: 'noop' });
    // Same magnitude, different unit → a real edit, not a no-op.
    expect(resolveFieldEntry('10 in', shown, 'mm').kind).toBe('value');
  });

  it('rejects garbage so the field restores its previous value', () => {
    for (const bad of ['', 'abc', '10 furlongs']) {
      expect(resolveFieldEntry(bad, shown, 'mm')).toEqual({ kind: 'reject' });
    }
  });

  it('leaves non-length fields (angles, counts) unconverted', () => {
    expect(resolveFieldEntry('45', '90', null)).toEqual({
      kind: 'value', value: 45, unitOverride: null,
    });
    // No unit parsing on an angle — a suffix is not silently honoured.
    expect(resolveFieldEntry('45in', '90', null).kind).toBe('value');
    expect(resolveFieldEntry('abc', '90', null)).toEqual({ kind: 'reject' });
  });
});

describe('length field display (REQ 940)', () => {
  it('converts the stored millimetre value into the field unit', () => {
    expect(magnitude(25.4, 'in')).toBe('1');
    expect(magnitude(12.7, 'in')).toBe('0.5');
    expect(magnitude(10, 'mm')).toBe('10');
    expect(magnitude(0.5, 'um')).toBe('500');
  });

  it('uses the µ symbol for micrometres', () => {
    expect(unitSymbol('um')).toBe('µm');
    expect(unitSymbol('in')).toBe('in');
  });
});
