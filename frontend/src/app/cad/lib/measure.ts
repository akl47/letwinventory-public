/** A picked entity for the Measure tool. The viewer/editor reduces each
 * raw pick (vertex / edge / face) to one of these shapes; the pure
 * compute function below produces a measurement result from them.
 *
 *   - 'vertex' carries the position alone.
 *   - 'edge' carries the two endpoints + the analytic length when
 *     known (kernel-emitted for curves; otherwise omitted and the
 *     endpoint chord distance is used).
 *   - 'face' is a placeholder for later expansion (area / centroid /
 *     plane); reserved by id-only so the compute can no-op until the
 *     face computations land. */
/** Circle/arc fit data for a curved edge — populated by `fitCircle`
 * on the polyline samples. When present, the edge is treated as a
 * circular curve in the compute (full circle if `closed`, arc otherwise). */
export interface EdgeCircleFit {
  center: [number, number, number];
  radius: number;
  normal: [number, number, number];
  /** True when the polyline endpoints coincide → full circle. */
  closed: boolean;
}

export type MeasureItem =
  | { kind: 'vertex'; id: string; position: [number, number, number] }
  | { kind: 'edge'; id: string; start: [number, number, number]; end: [number, number, number]; isStraight: boolean; length?: number; circle?: EdgeCircleFit }
  | {
      kind: 'face';
      id: string;
      /** Mesh-surface area, computed by summing triangle areas. */
      area?: number;
      /** Centroid (mean of mesh vertex positions). */
      centroid?: [number, number, number];
      /** Outward face normal for flat faces. Omit on curved faces;
       * the compute then skips plane-based distance / angle results. */
      normal?: [number, number, number];
      /** Whether the kernel marked this face flat. Drives the
       * compute's decision to emit plane-based results. */
      isFlat: boolean;
    };

/** Result rows the Measure sidebar renders. Multiple rows may appear
 * for a single pick combination (e.g. two parallel edges → both a
 * distance and an angle of 0). Order in the array is display order. */
export interface MeasureResultRow {
  label: string;
  value: string;
  unit?: string;
}

export interface MeasureResult {
  /** Human-readable summary of what's selected — drives the sidebar
   * status line. Empty when no items picked. */
  summary: string;
  /** Computed measurement rows. Empty for unsupported pick
   * combinations (the host can render a hint instead). */
  rows: MeasureResultRow[];
}

const fmt = (v: number, unit?: string): string => {
  if (!isFinite(v)) return 'undefined';
  // 3 significant digits min, max 6 — keeps small dimensions readable
  // without producing 12-decimal noise on round numbers.
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 3 : 4;
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
};

const sub = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
  [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (v: [number, number, number]): number => Math.hypot(v[0], v[1], v[2]);
const dot3 = (a: [number, number, number], b: [number, number, number]): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (v: [number, number, number]): [number, number, number] => {
  const L = len3(v);
  return L < 1e-12 ? [0, 0, 0] : [v[0] / L, v[1] / L, v[2] / L];
};

/** Treat absolute dot product ≥ this as "parallel". Threshold cos 1° */
const PARALLEL_DOT_THRESHOLD = 0.99985;

/** Edge length: prefer the kernel-emitted analytic length when present,
 * fall back to the straight chord between endpoints. */
function edgeLength(e: Extract<MeasureItem, { kind: 'edge' }>): number {
  if (typeof e.length === 'number' && isFinite(e.length)) return e.length;
  return len3(sub(e.end, e.start));
}

const add3 = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
  [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a: [number, number, number], s: number): [number, number, number] =>
  [a[0] * s, a[1] * s, a[2] * s];

/** Fit a circle through three polyline samples (start, middle, end).
 * Returns the circumcircle center + radius + plane normal, plus a
 * `closed` flag set when the polyline's endpoints coincide (full
 * circle vs partial arc). Returns null when the points are collinear
 * or when the fitted radius doesn't match the rest of the polyline
 * within tolerance — those edges are splines/general curves, not
 * circular. */
export function fitCircle(polyline: Array<[number, number, number]>): EdgeCircleFit | null {
  if (polyline.length < 3) return null;
  const p0 = polyline[0];
  const p1 = polyline[Math.floor(polyline.length / 2)];
  const p2 = polyline[polyline.length - 1];
  // For closed polylines (p2 ≈ p0), use a quarter-way sample as the
  // third point so we have three distinct points.
  const closed = len3(sub(p2, p0)) < 1e-6;
  const p2eff = closed ? polyline[Math.floor(polyline.length * 3 / 4)] : p2;
  const A = sub(p1, p0);
  const B = sub(p2eff, p0);
  const N = cross3(A, B);
  const nLen2 = dot3(N, N);
  if (nLen2 < 1e-18) return null;
  // Circumcenter of triangle (p0, p1, p2eff) in 3D.
  // Reference: 3-point circumcenter formula.
  const denom = 2 * nLen2;
  const aDotA = dot3(A, A);
  const bDotB = dot3(B, B);
  const alpha = (bDotB * dot3(A, sub(A, B))) / denom;
  const beta  = (aDotA * dot3(B, sub(B, A))) / denom;
  const center = add3(p0, add3(scale3(A, alpha), scale3(B, beta)));
  const radius = len3(sub(p0, center));
  if (!isFinite(radius) || radius < 1e-9) return null;
  // Verify by checking EVERY polyline sample sits within tol of `radius`.
  const tol = Math.max(0.001, radius * 0.005);
  for (const p of polyline) {
    const d = len3(sub(p, center));
    if (Math.abs(d - radius) > tol) return null;
  }
  return { center, radius, normal: unit3(N), closed };
}

/** Treat two unit normals as defining the same plane (parallel or
 * anti-parallel). */
function planesAlignedOrAntialigned(n0: [number, number, number], n1: [number, number, number]): boolean {
  return Math.abs(dot3(unit3(n0), unit3(n1))) >= PARALLEL_DOT_THRESHOLD;
}

/** Perpendicular distance from a point to the infinite line through
 * `start` → `end`. Falls back to point-to-start when the line is
 * degenerate (zero-length). */
function pointLineDistance(
  p: [number, number, number],
  start: [number, number, number],
  end: [number, number, number],
): number {
  const d = sub(end, start);
  const dL = len3(d);
  if (dL < 1e-12) return len3(sub(p, start));
  const ap = sub(p, start);
  // |AP × d| / |d| — magnitude of the cross product divided by line length.
  return len3(cross3(ap, d)) / dL;
}

/** Angle in degrees between two direction vectors. Returns the value
 * in [0, 90] for line-vs-line (lines are undirected). */
function lineAngleDeg(d0: [number, number, number], d1: [number, number, number]): number {
  const u0 = unit3(d0);
  const u1 = unit3(d1);
  let c = Math.abs(dot3(u0, u1));
  if (c > 1) c = 1;
  return (Math.acos(c) * 180) / Math.PI;
}

/** Whether two edges are parallel (their direction vectors are
 * collinear within the threshold). Both edges must be straight. */
function edgesParallel(
  e0: Extract<MeasureItem, { kind: 'edge' }>,
  e1: Extract<MeasureItem, { kind: 'edge' }>,
): boolean {
  const d0 = unit3(sub(e0.end, e0.start));
  const d1 = unit3(sub(e1.end, e1.start));
  return Math.abs(dot3(d0, d1)) >= PARALLEL_DOT_THRESHOLD;
}

/** Format a number-only value (no unit suffix) for inclusion in
 * concatenated strings like "30.00°". */
const fmtNum = (v: number, digits = 3) => fmt(v, '').trim().replace(/[^\d.\-]/g, '').padEnd(digits, '0');

const angleDeg = (label: string, deg: number) => ({
  label,
  value: `${fmtNum(deg)}°`,
});

/** Perpendicular distance from point `p` to the infinite plane through
 * `origin` with normal `normal`. Always non-negative. */
function pointPlaneDistance(
  p: [number, number, number],
  origin: [number, number, number],
  normal: [number, number, number],
): number {
  const n = unit3(normal);
  return Math.abs(dot3(sub(p, origin), n));
}

/** Whether two unit-normal-bearing planes are parallel. Threshold is
 * the same cos-1° we use for line parallelism. */
function planesParallel(n0: [number, number, number], n1: [number, number, number]): boolean {
  return Math.abs(dot3(unit3(n0), unit3(n1))) >= PARALLEL_DOT_THRESHOLD;
}

/** Reduce a set of picked entities to a Measure result. Pure;
 * deterministic — every input maps to exactly one output. */
export function computeMeasure(items: MeasureItem[], unit: string = 'mm'): MeasureResult {
  if (items.length === 0) {
    return { summary: '', rows: [] };
  }

  // Single-pick cases.
  if (items.length === 1) {
    const it = items[0];
    if (it.kind === 'vertex') {
      const [x, y, z] = it.position;
      return {
        summary: 'Vertex',
        rows: [
          { label: 'X', value: fmt(x, unit) },
          { label: 'Y', value: fmt(y, unit) },
          { label: 'Z', value: fmt(z, unit) },
        ],
      };
    }
    if (it.kind === 'edge') {
      const L = edgeLength(it);
      const rows: MeasureResultRow[] = [{ label: 'Length', value: fmt(L, unit) }];
      if (it.circle) {
        const r = it.circle.radius;
        rows.push({ label: 'Radius', value: fmt(r, unit) });
        if (it.circle.closed) {
          rows.push({ label: 'Diameter', value: fmt(2 * r, unit) });
          rows.push({ label: 'Circumference', value: fmt(2 * Math.PI * r, unit) });
        }
        rows.push({ label: 'Center', value:
          `(${it.circle.center[0].toFixed(3)}, ${it.circle.center[1].toFixed(3)}, ${it.circle.center[2].toFixed(3)})` });
      }
      const summary = it.isStraight
        ? 'Line edge'
        : it.circle
          ? (it.circle.closed ? 'Full circle edge' : 'Arc edge')
          : 'Curved edge';
      return { summary, rows };
    }
    // Face.
    const rows: MeasureResultRow[] = [];
    if (typeof it.area === 'number') rows.push({ label: 'Area', value: `${fmtNum(it.area)} ${unit}²` });
    if (it.centroid) {
      rows.push({ label: 'Centroid X', value: fmt(it.centroid[0], unit) });
      rows.push({ label: 'Centroid Y', value: fmt(it.centroid[1], unit) });
      rows.push({ label: 'Centroid Z', value: fmt(it.centroid[2], unit) });
    }
    if (it.isFlat && it.normal) {
      const n = unit3(it.normal);
      rows.push({ label: 'Normal', value: `(${n[0].toFixed(3)}, ${n[1].toFixed(3)}, ${n[2].toFixed(3)})` });
    }
    return { summary: it.isFlat ? 'Flat face' : 'Curved face', rows };
  }

  // Two-pick cases — handle the supported combinations.
  if (items.length === 2) {
    const a = items[0];
    const b = items[1];
    const kinds = [a.kind, b.kind].sort().join('+');

    if (kinds === 'vertex+vertex' && a.kind === 'vertex' && b.kind === 'vertex') {
      const d = len3(sub(a.position, b.position));
      // Also useful: ΔX / ΔY / ΔZ components — common SW readout.
      const dx = b.position[0] - a.position[0];
      const dy = b.position[1] - a.position[1];
      const dz = b.position[2] - a.position[2];
      return {
        summary: 'Distance between two vertices',
        rows: [
          { label: 'Distance', value: fmt(d, unit) },
          { label: 'ΔX', value: fmt(dx, unit) },
          { label: 'ΔY', value: fmt(dy, unit) },
          { label: 'ΔZ', value: fmt(dz, unit) },
        ],
      };
    }

    if (kinds === 'edge+vertex') {
      const v = (a.kind === 'vertex' ? a : b) as Extract<MeasureItem, { kind: 'vertex' }>;
      const e = (a.kind === 'edge' ? a : b) as Extract<MeasureItem, { kind: 'edge' }>;
      const d = pointLineDistance(v.position, e.start, e.end);
      return {
        summary: 'Perpendicular distance from vertex to edge',
        rows: [{ label: 'Distance', value: fmt(d, unit) }],
      };
    }

    if (kinds === 'edge+edge' && a.kind === 'edge' && b.kind === 'edge') {
      // Two circular curves: report center-to-center distance plus
      // axial / radial decomposition when their normals are co-aligned
      // (so the user gets coaxial-hole separation directly).
      if (a.circle && b.circle) {
        const ca = a.circle.center;
        const cb = b.circle.center;
        const d = len3(sub(cb, ca));
        const rows: MeasureResultRow[] = [
          { label: 'Center distance', value: fmt(d, unit) },
        ];
        if (planesAlignedOrAntialigned(a.circle.normal, b.circle.normal)) {
          const n = unit3(a.circle.normal);
          const axial = Math.abs(dot3(sub(cb, ca), n));
          // Radial component = distance from cb to the line through ca
          // along n. Use the perpendicular vector length.
          const radial = Math.sqrt(Math.max(0, d * d - axial * axial));
          rows.push({ label: 'Axial', value: fmt(axial, unit) });
          rows.push({ label: 'Radial', value: fmt(radial, unit) });
          rows.push({ label: 'Δ Radius', value: fmt(Math.abs(b.circle.radius - a.circle.radius), unit) });
        }
        return { summary: 'Two circular curves', rows };
      }
      // One circular curve + one straight edge: perpendicular distance
      // from the line to the circle's center.
      if (a.circle && b.isStraight) {
        const d = pointLineDistance(a.circle.center, b.start, b.end);
        return { summary: 'Arc/circle to line', rows: [{ label: 'Distance', value: fmt(d, unit) }] };
      }
      if (b.circle && a.isStraight) {
        const d = pointLineDistance(b.circle.center, a.start, a.end);
        return { summary: 'Arc/circle to line', rows: [{ label: 'Distance', value: fmt(d, unit) }] };
      }
      if (!a.isStraight || !b.isStraight) {
        return {
          summary: 'Two edges (non-circular curves not yet supported)',
          rows: [],
        };
      }
      const parallel = edgesParallel(a, b);
      if (parallel) {
        const d = pointLineDistance(a.start, b.start, b.end);
        return {
          summary: 'Two parallel edges',
          rows: [
            { label: 'Distance', value: fmt(d, unit) },
            angleDeg('Angle', 0),
          ],
        };
      }
      const da = sub(a.end, a.start);
      const db = sub(b.end, b.start);
      const angle = lineAngleDeg(da, db);
      return {
        summary: 'Two edges',
        rows: [angleDeg('Angle', angle)],
      };
    }

    if (kinds === 'face+vertex') {
      const v = (a.kind === 'vertex' ? a : b) as Extract<MeasureItem, { kind: 'vertex' }>;
      const f = (a.kind === 'face' ? a : b) as Extract<MeasureItem, { kind: 'face' }>;
      if (!f.isFlat || !f.normal || !f.centroid) {
        return { summary: 'Vertex + curved face (perpendicular distance requires a flat face)', rows: [] };
      }
      const d = pointPlaneDistance(v.position, f.centroid, f.normal);
      return {
        summary: 'Perpendicular distance from vertex to face',
        rows: [{ label: 'Distance', value: fmt(d, unit) }],
      };
    }

    if (kinds === 'edge+face') {
      const e = (a.kind === 'edge' ? a : b) as Extract<MeasureItem, { kind: 'edge' }>;
      const f = (a.kind === 'face' ? a : b) as Extract<MeasureItem, { kind: 'face' }>;
      if (!e.isStraight) {
        return { summary: 'Curved edge + face (not yet supported)', rows: [] };
      }
      if (!f.isFlat || !f.normal || !f.centroid) {
        return { summary: 'Edge + curved face (not yet supported)', rows: [] };
      }
      // Angle between an edge and a plane = 90° − angle(edge, normal).
      const dir = sub(e.end, e.start);
      const angleToNormal = lineAngleDeg(dir, f.normal);
      const angleToPlane = 90 - angleToNormal;
      const rows: MeasureResultRow[] = [angleDeg('Angle', angleToPlane)];
      // If the edge is parallel to the plane (angle ≈ 0), the
      // perpendicular distance from the line to the plane is well-
      // defined; emit it alongside.
      if (Math.abs(angleToPlane) < 0.5) {
        const d = pointPlaneDistance(e.start, f.centroid, f.normal);
        rows.unshift({ label: 'Distance', value: fmt(d, unit) });
      }
      return { summary: 'Edge to face', rows };
    }

    if (kinds === 'face+face' && a.kind === 'face' && b.kind === 'face') {
      if (!a.isFlat || !a.normal || !a.centroid || !b.isFlat || !b.normal || !b.centroid) {
        return { summary: 'Two faces (one or both are curved — not yet supported)', rows: [] };
      }
      if (planesParallel(a.normal, b.normal)) {
        const d = pointPlaneDistance(b.centroid, a.centroid, a.normal);
        return {
          summary: 'Two parallel faces',
          rows: [
            { label: 'Distance', value: fmt(d, unit) },
            angleDeg('Angle', 0),
          ],
        };
      }
      const angle = lineAngleDeg(a.normal, b.normal);
      return {
        summary: 'Two faces',
        rows: [angleDeg('Angle', angle)],
      };
    }

    return {
      summary: `${items.length} items selected (combination not yet supported)`,
      rows: [],
    };
  }

  return {
    summary: `${items.length} items selected (3+ picks not yet supported)`,
    rows: [],
  };
}
