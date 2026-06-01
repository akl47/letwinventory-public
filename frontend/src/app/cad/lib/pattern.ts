// Pattern transform compute — converts a Mirror / Linear / Circular
// pattern feature into the raw PatternTransform[] the kernel
// (`buildPattern`) consumes. REQ 658.
//
// Mirror → one Mirror transform (origin + normal of the plane).
// Linear → one Translate per non-source grid cell. For 1D: count − 1
//          copies along direction1. For 2D: count1 * count2 − 1 copies
//          covering the full grid except the (0,0) source cell.
// Circular → one Rotate per non-source step. equalSpacing distributes
//          `angleDeg` across `count` slots so a full revolution at
//          count=4 yields steps of 90°. specifiedAngle treats
//          `angleDeg` as the per-step delta.
//
// The kernel doesn't know which pattern kind it's serving — it just
// applies the transforms and fuses. All semantics live here.

import type {
  CircularPatternFeature,
  LinearPatternFeature,
  MirrorFeatureFeature,
} from './types';

/** Raw transform shape mirroring `protocol::PatternTransform` on the
 * kernel side. Keep the field names in sync with that enum's
 * #[serde(tag="kind", rename_all="lowercase")] variants. */
export type PatternTransform =
  | { kind: 'translate'; dx: number; dy: number; dz: number }
  | { kind: 'rotate'; origin: [number, number, number]; direction: [number, number, number]; angleRad: number }
  | { kind: 'mirror'; origin: [number, number, number]; normal: [number, number, number] };

/** Build the kernel transform list for a Mirror Feature. Always one
 * entry — mirror across the snapshot plane (origin + normal). */
export function mirrorTransforms(feature: MirrorFeatureFeature): PatternTransform[] {
  return [{
    kind: 'mirror',
    origin: feature.planeSnapshot.origin,
    normal: feature.planeSnapshot.normal,
  }];
}

/** Build the kernel transform list for a Linear Pattern. Emits every
 * cell in the grid EXCEPT the source seed at (0,0). For a 1D pattern
 * (no direction2) returns count1 − 1 entries; for 2D returns
 * count1 * count2 − 1. Throws on count < 1 or spacing == 0. */
export function linearTransforms(feature: LinearPatternFeature): PatternTransform[] {
  const d1 = feature.direction1;
  if (d1.count < 1) throw new Error('Linear pattern: direction 1 count must be ≥ 1.');
  if (d1.count >= 2 && d1.spacing === 0) {
    throw new Error('Linear pattern: direction 1 spacing must be non-zero when count ≥ 2.');
  }
  const d2 = feature.direction2;
  if (d2) {
    if (d2.count < 1) throw new Error('Linear pattern: direction 2 count must be ≥ 1.');
    if (d2.count >= 2 && d2.spacing === 0) {
      throw new Error('Linear pattern: direction 2 spacing must be non-zero when count ≥ 2.');
    }
  }

  const v1 = scaledStep(d1.axisSnapshot.direction, d1.spacing, d1.flipped === true);
  const v2 = d2 ? scaledStep(d2.axisSnapshot.direction, d2.spacing, d2.flipped === true) : null;

  const out: PatternTransform[] = [];
  for (let i = 0; i < d1.count; i++) {
    const jMax = d2 ? d2.count : 1;
    for (let j = 0; j < jMax; j++) {
      if (i === 0 && j === 0) continue;  // skip the source seed
      const dx = v1[0] * i + (v2 ? v2[0] * j : 0);
      const dy = v1[1] * i + (v2 ? v2[1] * j : 0);
      const dz = v1[2] * i + (v2 ? v2[2] * j : 0);
      out.push({ kind: 'translate', dx, dy, dz });
    }
  }
  return out;
}

/** Build the kernel transform list for a Circular Pattern. */
export function circularTransforms(feature: CircularPatternFeature): PatternTransform[] {
  if (feature.count < 2) {
    throw new Error('Circular pattern: count must be ≥ 2 (one of the slots is the source).');
  }
  // equalSpacing distributes the user-supplied total sweep across all
  // `count` slots — step = total / count. Matches SolidWorks's "Equal
  // spacing" with the default 360° sweep producing N evenly-spaced
  // copies. specifiedAngle uses the angle as the per-step delta.
  const stepDeg = feature.mode === 'equalSpacing'
    ? feature.angleDeg / feature.count
    : feature.angleDeg;
  const stepRad = (stepDeg * Math.PI) / 180;
  const sign = feature.flipped ? -1 : 1;

  const out: PatternTransform[] = [];
  for (let i = 1; i < feature.count; i++) {  // i=0 is the source seed
    out.push({
      kind: 'rotate',
      origin: feature.axisSnapshot.origin,
      direction: feature.axisSnapshot.direction,
      angleRad: sign * stepRad * i,
    });
  }
  return out;
}

function scaledStep(dir: [number, number, number], spacing: number, flipped: boolean): [number, number, number] {
  const sign = flipped ? -1 : 1;
  return [dir[0] * spacing * sign, dir[1] * spacing * sign, dir[2] * spacing * sign];
}
