// REQ 993 — Zoom-to-fit for the orthographic CAD viewer. Frames the geometry
// as SEEN from the target view: every point is projected onto the camera's
// right/up axes, and the half-height is the larger of the vertical extent
// and the horizontal extent divided by the viewport aspect, so the model fits
// in both directions on any canvas shape. Pixel insets keep the model clear
// of overlays (footer, nav cube) by fitting it into the remaining rectangle.
// Pure math, no Three.js dependency.

export interface Vec3 { x: number; y: number; z: number }

/** Canvas size in px, plus the px bands along each edge the model must avoid. */
export interface FitViewport {
  width: number; height: number;
  top?: number; right?: number; bottom?: number; left?: number;
}

/** Margin around the fitted model (10% on the limiting side). */
export const FIT_PAD = 1.1;

const cross = (a: Vec3, b: Vec3): Vec3 =>
  ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/**
 * `eachPoint` visits every world-space point to frame. `dir` is the unit
 * direction from the orbit target to the camera, `up` the camera's up hint
 * (as for Three's lookAt). The orbit target is offset so the model sits in
 * the middle of the un-inset rectangle.
 * Returns the orbit target and ortho half-height, or null with no points.
 */
export function fitFrame(
  eachPoint: (visit: (x: number, y: number, z: number) => void) => void,
  dir: Vec3, up: Vec3, view: FitViewport, pad = FIT_PAD,
): { center: Vec3; halfHeight: number } | null {
  const d = norm(dir);
  let r = cross(up, d);
  // Up parallel to the view direction: any perpendicular axis will do.
  if (Math.hypot(r.x, r.y, r.z) < 1e-9) r = cross(Math.abs(d.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }, d);
  r = norm(r);
  const u = cross(d, r);
  let n = 0;
  let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity, d0 = Infinity, d1 = -Infinity;
  eachPoint((x, y, z) => {
    n++;
    const pr = x * r.x + y * r.y + z * r.z;
    const pu = x * u.x + y * u.y + z * u.z;
    const pd = x * d.x + y * d.y + z * d.z;
    if (pr < r0) r0 = pr; if (pr > r1) r1 = pr;
    if (pu < u0) u0 = pu; if (pu > u1) u1 = pu;
    if (pd < d0) d0 = pd; if (pd > d1) d1 = pd;
  });
  if (!n) return null;
  const { width: W, height: H, top = 0, right = 0, bottom = 0, left = 0 } = view;
  // Usable fraction of each canvas dimension (never below a quarter).
  const fw = Math.max(0.25, (W - left - right) / Math.max(W, 1));
  const fh = Math.max(0.25, (H - top - bottom) / Math.max(H, 1));
  const aspect = W / Math.max(H, 1);
  const half = Math.max(0.5,
    (u1 - u0) / 2 / fh,
    (r1 - r0) / 2 / Math.max(aspect, 1e-6) / fw) * pad;
  // World units per px, then shift the target so the model's middle lands on
  // the middle of the usable rectangle.
  const wpp = (2 * half) / Math.max(H, 1);
  const mr = (r0 + r1) / 2 - ((left - right) / 2) * wpp;
  const mu = (u0 + u1) / 2 - ((bottom - top) / 2) * wpp;
  const md = (d0 + d1) / 2;
  const center = {
    x: r.x * mr + u.x * mu + d.x * md,
    y: r.y * mr + u.y * mu + d.y * md,
    z: r.z * mr + u.z * mu + d.z * md,
  };
  return { center, halfHeight: half };
}
