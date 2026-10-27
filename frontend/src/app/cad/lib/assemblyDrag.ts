// Pure helpers for interactive component drag in the assembly editor (CAD-782/783).
// Kept free of Three.js / DOM so the math is unit-testable; the viewer supplies
// the camera basis + units-per-pixel, the controller composes the new placement.

import type { AssemblyInstance, Placement } from './assembly.types';

export type Vec3 = [number, number, number];

/** Pixels a press must move before it counts as a drag rather than a select click. */
export const DRAG_THRESHOLD_PX = 4;

/** True once a press has moved more than `threshold` pixels from where it started. */
export function exceedsDragThreshold(dx: number, dy: number, threshold = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(dx, dy) > threshold;
}

/** Only un-grounded, un-suppressed components may be dragged. */
export function canDragInstance(
  inst: Pick<AssemblyInstance, 'grounded' | 'suppressed'> | null | undefined,
): boolean {
  return !!inst && !inst.grounded && !inst.suppressed;
}

/**
 * Convert a screen-pixel delta into a world-space translation in the camera's
 * view plane. `camRight`/`camUp` are the camera's world-space basis vectors and
 * `unitsPerPixel` converts screen pixels to world units at the current orbit
 * distance. Cursor right (+dx) moves along +camRight; cursor down (+dy, since
 * screen-y grows downward) moves along -camUp.
 */
export function screenDeltaToWorld(
  dx: number,
  dy: number,
  camRight: Vec3,
  camUp: Vec3,
  unitsPerPixel: number,
): Vec3 {
  const wx = dx * unitsPerPixel;
  const wy = -dy * unitsPerPixel;
  return [
    camRight[0] * wx + camUp[0] * wy,
    camRight[1] * wx + camUp[1] * wy,
    camRight[2] * wx + camUp[2] * wy,
  ];
}

/** Apply a world translation to a placement, leaving orientation unchanged. */
export function translatedPlacement(placement: Placement, worldDelta: Vec3): Placement {
  return {
    translate: [
      placement.translate[0] + worldDelta[0],
      placement.translate[1] + worldDelta[1],
      placement.translate[2] + worldDelta[2],
    ],
    quaternion: [...placement.quaternion],
  };
}
