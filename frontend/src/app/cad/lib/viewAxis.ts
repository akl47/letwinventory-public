// View/camera axis convention for the 3D CAD viewer: **Z-up, right-handed**.
//
// This is a VIEW convention only — it does NOT define geometry. Datum planes,
// the kernel, and stored data keep their own axis definitions (the XY datum's
// normal is already +Z, so with Z as the camera up the XY plane reads as the
// horizontal ground). Pure math, no Three.js dependency, so it's unit-testable.

/** World up-axis for the view (Z-up). */
export const WORLD_UP: readonly [number, number, number] = [0, 0, 1];

/** Orbit (theta, phi) → unit camera-offset direction, Z-up: `phi` is the polar
 *  angle measured from +Z, `theta` the azimuth in the XY plane (right-handed
 *  about +Z). At phi=0 the direction is +Z (camera above → Top view). */
export function orbitDir(theta: number, phi: number): { x: number; y: number; z: number } {
  const s = Math.sin(phi);
  return { x: s * Math.cos(theta), y: s * Math.sin(theta), z: Math.cos(phi) };
}

/** Inverse of {@link orbitDir}: a (unit) direction → (theta, phi) for Z-up.
 *  theta is undefined at the poles (sin(phi)≈0) and returned as 0. */
export function dirToOrbit(x: number, y: number, z: number): { theta: number; phi: number } {
  const phi = Math.acos(Math.max(-1, Math.min(1, z)));
  const theta = Math.sin(phi) > 1e-6 ? Math.atan2(y, x) : 0;
  return { theta, phi };
}
