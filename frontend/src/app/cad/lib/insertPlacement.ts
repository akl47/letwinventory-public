// REQ 1081 — where the insert preview sits when the cursor is over empty
// space, and the placement an inserted component gets from a picked point.
import type { Placement } from './assembly.types';

type V3 = [number, number, number];

/** Point where a view ray meets the plane through `planePoint` with normal
 * `planeNormal`; null when the ray is parallel to it or points away. */
export function rayPlanePoint(origin: V3, dir: V3, planePoint: V3, planeNormal: V3): V3 | null {
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const denom = dot(dir, planeNormal);
  if (Math.abs(denom) < 1e-9) return null;
  const t = dot([planePoint[0] - origin[0], planePoint[1] - origin[1], planePoint[2] - origin[2]], planeNormal) / denom;
  if (t < 0) return null;
  return [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
}

/** A component dropped at `point` keeps the assembly's orientation. */
export function placementAt(point: V3): Placement {
  return { translate: [point[0], point[1], point[2]], quaternion: [0, 0, 0, 1] };
}
