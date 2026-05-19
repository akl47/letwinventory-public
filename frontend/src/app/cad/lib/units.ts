// ────────────────────────────────────────────────────────────────────────────
// Unit handling for dimensional constraints.
//
// Storage: every numeric value in the sketch (point coords, constraint
// values, etc.) is in MILLIMETERS — the canonical unit. Display + input
// happens in whatever unit the user wants: per-constraint override if set,
// otherwise the model's default.
//
// User input is parsed as "<number><optional unit>": "10", "10mm", "10 mm",
// "0.5in", "0.5 in", "0.5\"", "200 um", "200µm". Bare numbers fall back to
// the model's default unit.
// ────────────────────────────────────────────────────────────────────────────

export type Unit = 'mm' | 'um' | 'in';

export const UNITS: Unit[] = ['mm', 'um', 'in'];

/** How many millimeters 1 unit of `Unit` is. Multiply a display value by
 * this to get mm; divide a mm value by this to get the display value. */
const TO_MM: Record<Unit, number> = {
  mm: 1,
  um: 0.001,
  in: 25.4,
};

/** Convert a stored (mm) value into a display value in `unit`. */
export function fromMm(valueMm: number, unit: Unit): number {
  return valueMm / TO_MM[unit];
}

/** Convert a user-entered display value in `unit` into mm for storage. */
export function toMm(displayValue: number, unit: Unit): number {
  return displayValue * TO_MM[unit];
}

/** Strip trailing zeros + orphan decimal point from a fixed-decimal value.
 * Lives here (vs. dimensions.ts) so units.ts has zero cross-module deps. */
export function formatNumber(n: number, maxDecimals: number = 3): string {
  return n.toFixed(maxDecimals).replace(/\.?0+$/, '');
}

/**
 * Format a stored (mm) value for display.
 *
 * - `unit` controls the displayed magnitude (e.g. mm-stored 25.4 → "1" when
 *   unit is `in`).
 * - `showSuffix` controls whether the unit symbol is appended. Convention:
 *   only show the suffix when the dim's unit DIFFERS from the model's
 *   default — keeps dim labels tidy in mm-default models, surfaces unit
 *   only when the user explicitly opted into a non-default for that dim.
 */
export function formatWithUnit(valueMm: number, unit: Unit, showSuffix: boolean): string {
  const num = formatNumber(fromMm(valueMm, unit));
  return showSuffix ? `${num} ${unitSymbol(unit)}` : num;
}

/** The label rendered next to a value (e.g. "in", "mm", "µm"). */
export function unitSymbol(unit: Unit): string {
  return unit === 'um' ? 'µm' : unit;
}

export interface ParsedValue {
  /** Magnitude in mm — ready to store on the constraint. */
  valueMm: number;
  /** The unit the user actually typed. `null` when the input was a bare
   * number — caller falls back to the model default. */
  unit: Unit | null;
}

/**
 * Parse a user-entered string into a normalized {valueMm, unit}.
 *
 * Accepts:
 *   - plain numbers:    "10", "10.5", ".5"
 *   - mm:               "10mm", "10 mm"
 *   - micrometers:      "200um", "200 µm"
 *   - inches:           "0.5in", "0.5 in", "0.5\""
 *
 * Returns null on garbage input. Whitespace + case-insensitive on the
 * unit suffix.
 */
export function parseUserValue(raw: string, defaultUnit: Unit): ParsedValue | null {
  const m = raw.trim().match(/^([+-]?\d*\.?\d+)\s*(mm|um|µm|in|")?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  let unit: Unit | null = null;
  if (m[2]) {
    const u = m[2].toLowerCase();
    if (u === 'mm') unit = 'mm';
    else if (u === 'um' || u === 'µm') unit = 'um';
    else if (u === 'in' || u === '"') unit = 'in';
  }
  const effective: Unit = unit ?? defaultUnit;
  return { valueMm: toMm(n, effective), unit };
}
