// REQ 664 — hardware spec table for the Hole Wizard.
//
// Single source of truth for hole dimensions, shared between the
// frontend sidebar (size dropdown) and the backend dispatch
// (geometry synthesis). All values are stored in millimeters; inch
// sizes are pre-converted at table-write time so the rest of the
// system sees a single unit.
//
// Sources:
//   ISO 273 (clearance), ISO 4762 (socket-head cap screw), ISO 7991
//   (flat countersunk head) for metric.
//   ANSI/ASME B18.3 (socket cap), B18.6.3 (flat countersunk) for inch.
//
// Counterbore depth = head height + 0.5mm (rule of thumb so the head
// sits flush). Countersink diameter = flat-head major Ø + 0.2mm
// clearance. Thread pitch is the standard coarse-thread pitch (mm)
// or TPI → mm conversion for inch.

export type HoleStandard = 'iso' | 'ansi';

export interface HoleSpec {
  /** Display label, e.g. "M4" or "1/4". */
  label: string;
  /** Clearance-drill Ø (mm). Used by Simple Drill / Counterbore / Countersink. */
  clearanceDrillDiameter: number;
  /** Tap-drill Ø (mm). Used by Tapped only. */
  tapDrillDiameter: number;
  /** Counterbore Ø (mm). Sized for the socket-head cap screw of this nominal. */
  counterboreDiameter: number;
  /** Counterbore depth (mm). Head height + small clearance. */
  counterboreDepth: number;
  /** Countersink Ø (mm). Sized for the flat-head screw of this nominal. */
  countersinkDiameter: number;
  /** Countersink included angle (degrees). ISO = 90°; ANSI = 82°. */
  countersinkAngleDeg: number;
  /** Thread pitch (mm). Coarse-series pitch for cosmetic thread display. */
  threadPitch: number;
  /** Major Ø of the thread itself (mm) — the nominal screw OD. Used for the
   * cosmetic thread sidecar in the Tapped hole type. */
  threadMajorDiameter: number;
}

/** ISO metric (M2–M12), 90° countersink. */
const ISO_TABLE: Record<string, HoleSpec> = {
  M2:   { label: 'M2',   clearanceDrillDiameter: 2.40, tapDrillDiameter: 1.60, counterboreDiameter: 3.80, counterboreDepth: 2.0, countersinkDiameter: 3.90, countersinkAngleDeg: 90, threadPitch: 0.40, threadMajorDiameter: 2.0 },
  M2_5: { label: 'M2.5', clearanceDrillDiameter: 2.90, tapDrillDiameter: 2.05, counterboreDiameter: 4.50, counterboreDepth: 2.5, countersinkDiameter: 4.85, countersinkAngleDeg: 90, threadPitch: 0.45, threadMajorDiameter: 2.5 },
  M3:   { label: 'M3',   clearanceDrillDiameter: 3.40, tapDrillDiameter: 2.50, counterboreDiameter: 5.50, counterboreDepth: 3.0, countersinkDiameter: 6.30, countersinkAngleDeg: 90, threadPitch: 0.50, threadMajorDiameter: 3.0 },
  M4:   { label: 'M4',   clearanceDrillDiameter: 4.50, tapDrillDiameter: 3.30, counterboreDiameter: 7.00, counterboreDepth: 4.0, countersinkDiameter: 8.00, countersinkAngleDeg: 90, threadPitch: 0.70, threadMajorDiameter: 4.0 },
  M5:   { label: 'M5',   clearanceDrillDiameter: 5.50, tapDrillDiameter: 4.20, counterboreDiameter: 8.50, counterboreDepth: 5.0, countersinkDiameter: 10.00, countersinkAngleDeg: 90, threadPitch: 0.80, threadMajorDiameter: 5.0 },
  M6:   { label: 'M6',   clearanceDrillDiameter: 6.60, tapDrillDiameter: 5.00, counterboreDiameter: 10.00, counterboreDepth: 6.0, countersinkDiameter: 11.00, countersinkAngleDeg: 90, threadPitch: 1.00, threadMajorDiameter: 6.0 },
  M8:   { label: 'M8',   clearanceDrillDiameter: 9.00, tapDrillDiameter: 6.80, counterboreDiameter: 13.00, counterboreDepth: 8.0, countersinkDiameter: 14.40, countersinkAngleDeg: 90, threadPitch: 1.25, threadMajorDiameter: 8.0 },
  M10:  { label: 'M10',  clearanceDrillDiameter: 11.00, tapDrillDiameter: 8.50, counterboreDiameter: 16.00, counterboreDepth: 10.0, countersinkDiameter: 17.70, countersinkAngleDeg: 90, threadPitch: 1.50, threadMajorDiameter: 10.0 },
  M12:  { label: 'M12',  clearanceDrillDiameter: 14.00, tapDrillDiameter: 10.20, counterboreDiameter: 18.00, counterboreDepth: 12.0, countersinkDiameter: 21.00, countersinkAngleDeg: 90, threadPitch: 1.75, threadMajorDiameter: 12.0 },
};

/** ANSI Unified inch (#4 – 1/2″), 82° countersink. */
const ANSI_TABLE: Record<string, HoleSpec> = {
  N4:   { label: '#4',   clearanceDrillDiameter: 3.05, tapDrillDiameter: 2.16, counterboreDiameter: 5.49, counterboreDepth: 2.84, countersinkDiameter: 5.49, countersinkAngleDeg: 82, threadPitch: 0.635, threadMajorDiameter: 2.845 },
  N6:   { label: '#6',   clearanceDrillDiameter: 3.66, tapDrillDiameter: 2.69, counterboreDiameter: 6.86, counterboreDepth: 3.51, countersinkDiameter: 6.86, countersinkAngleDeg: 82, threadPitch: 0.794, threadMajorDiameter: 3.505 },
  N8:   { label: '#8',   clearanceDrillDiameter: 4.50, tapDrillDiameter: 3.43, counterboreDiameter: 7.95, counterboreDepth: 4.17, countersinkDiameter: 7.95, countersinkAngleDeg: 82, threadPitch: 0.794, threadMajorDiameter: 4.166 },
  N10:  { label: '#10',  clearanceDrillDiameter: 5.16, tapDrillDiameter: 3.99, counterboreDiameter: 9.65, counterboreDepth: 4.83, countersinkDiameter: 9.65, countersinkAngleDeg: 82, threadPitch: 1.058, threadMajorDiameter: 4.826 },
  I1_4: { label: '1/4',  clearanceDrillDiameter: 6.78, tapDrillDiameter: 5.11, counterboreDiameter: 12.32, counterboreDepth: 6.35, countersinkDiameter: 12.32, countersinkAngleDeg: 82, threadPitch: 1.270, threadMajorDiameter: 6.35 },
  I5_16:{ label: '5/16', clearanceDrillDiameter: 8.43, tapDrillDiameter: 6.53, counterboreDiameter: 14.66, counterboreDepth: 7.92, countersinkDiameter: 14.66, countersinkAngleDeg: 82, threadPitch: 1.411, threadMajorDiameter: 7.938 },
  I3_8: { label: '3/8',  clearanceDrillDiameter: 10.31, tapDrillDiameter: 7.92, counterboreDiameter: 17.46, counterboreDepth: 9.53, countersinkDiameter: 17.46, countersinkAngleDeg: 82, threadPitch: 1.588, threadMajorDiameter: 9.525 },
  I7_16:{ label: '7/16', clearanceDrillDiameter: 12.07, tapDrillDiameter: 9.40, counterboreDiameter: 19.84, counterboreDepth: 11.10, countersinkDiameter: 19.84, countersinkAngleDeg: 82, threadPitch: 1.814, threadMajorDiameter: 11.113 },
  I1_2: { label: '1/2',  clearanceDrillDiameter: 13.49, tapDrillDiameter: 10.72, counterboreDiameter: 22.23, counterboreDepth: 12.70, countersinkDiameter: 22.23, countersinkAngleDeg: 82, threadPitch: 1.954, threadMajorDiameter: 12.7 },
};

/** Display order for size dropdowns — smallest first. */
export const ISO_SIZE_KEYS = ['M2', 'M2_5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12'] as const;
export const ANSI_SIZE_KEYS = ['N4', 'N6', 'N8', 'N10', 'I1_4', 'I5_16', 'I3_8', 'I7_16', 'I1_2'] as const;

export type IsoSizeKey = typeof ISO_SIZE_KEYS[number];
export type AnsiSizeKey = typeof ANSI_SIZE_KEYS[number];
export type HoleSizeKey = IsoSizeKey | AnsiSizeKey;

/** Look up a spec by (standard, sizeKey). Throws if the key is wrong
 * for the chosen standard — callers should always pair them. */
export function holeSpec(standard: HoleStandard, sizeKey: HoleSizeKey): HoleSpec {
  const table = standard === 'iso' ? ISO_TABLE : ANSI_TABLE;
  const spec = table[sizeKey];
  if (!spec) throw new Error(`Unknown hole size '${sizeKey}' for standard '${standard}'.`);
  return spec;
}

/** Ordered list of (key, label) tuples for rendering a size dropdown. */
export function sizeOptions(standard: HoleStandard): Array<{ key: HoleSizeKey; label: string }> {
  const keys = standard === 'iso' ? ISO_SIZE_KEYS : ANSI_SIZE_KEYS;
  return keys.map(k => ({ key: k as HoleSizeKey, label: holeSpec(standard, k as HoleSizeKey).label }));
}

/** First valid size when the standard switches, so the dropdown never
 * lands on an invalid value mid-switch. */
export function defaultSizeFor(standard: HoleStandard): HoleSizeKey {
  return standard === 'iso' ? 'M3' : 'I1_4';
}
