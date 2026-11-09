// REQ 1033 — zoom limits and clip depth for the orthographic viewer, scaled
// to the model like SolidWorks / Onshape instead of a fixed millimetre range.
// "Half-height" is the visible half-height of the view (the viewer's
// orbitDistance); "radius" is the model's bounding-sphere radius, in mm.

export const MIN_HALF_HEIGHT = 0.001;
export const BASE_MAX_HALF_HEIGHT = 2000;
export const BASE_CLIP_DEPTH = 5000;

/** Zoom range for a model of bounding radius `radius` (null = no geometry). */
export function zoomLimits(radius: number | null): { min: number; max: number } {
  if (!radius || !(radius > 0)) return { min: MIN_HALF_HEIGHT, max: BASE_MAX_HALF_HEIGHT };
  const size = radius * 2;
  return {
    min: Math.max(MIN_HALF_HEIGHT, size / 1e5),
    max: Math.max(BASE_MAX_HALF_HEIGHT, size * 50),
  };
}

export function clampZoom(halfHeight: number, radius: number | null): number {
  const { min, max } = zoomLimits(radius);
  return Math.max(min, Math.min(max, halfHeight));
}

/** Symmetric clip half-depth for a camera `camToCenter` mm from the model's
 * bounding-sphere center — deep enough to hold the whole sphere. */
export function clipDepth(camToCenter: number, radius: number | null): number {
  return Math.max(BASE_CLIP_DEPTH, (camToCenter + (radius ?? 0)) * 1.1);
}
