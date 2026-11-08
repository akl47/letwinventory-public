// Datum geometry for the assembly viewer (CAD-784/785). Two sources:
//   - the assembly's own origin (origin point + 3 planes + 3 axes at world 0), and
//   - each inserted component's origin datums, transformed into assembly space by
//     the component's solved placement and namespaced so ids don't collide.
// The viewer's addDatum() renders canonical-id datums (no sidecar) at the world
// origin with X/Y/Z colors, and sidecar-carrying datums at their placed frame in
// the "user datum" amber style — so component datums read as added references
// distinct from the assembly origin.

import type { DatumElement, FeatureTree, DatumPlaneFeature, DatumPointFeature, Plane3, PlaneRef } from './types';
import { ASSEMBLY_REF_ID, type AssemblyRegenResponse, type Placement } from './assembly.types';

const IDENTITY_PLACEMENT: Placement = { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] };
import { buildOriginDatums, planeForDatum, originPlaneLabel, computeDatumPlane, computeDatumPoint } from './datum';
import { transformPoint, transformDir } from './placementMath';
import { qMul, qRotate, type Quat } from './insertOrientation';

// A datum plus the optional sidecars the viewer reads to place it off-origin.
export type PlacedDatum = DatumElement & {
  /** Display name for the corner label (e.g. "Bracket-01 - XY plane"). */
  name?: string;
  position?: [number, number, number];
  axis?: { origin: [number, number, number]; direction: [number, number, number] };
  plane?: {
    origin: [number, number, number];
    xAxis: [number, number, number];
    yAxis: [number, number, number];
    normal: [number, number, number];
  };
  /** REQ 1006 — coordinate-system triad axis: drawn X/Y/Z-coloured from its origin. */
  triad?: 'x' | 'y' | 'z';
  /** REQ 1006 — a reference point's coordinate-system orientation (world). */
  quaternion?: [number, number, number, number];
};

/** Display descriptors for the seven origin datums — id, label, Material icon and
 * colour class — mirroring the part feature tree's Origin children so the
 * assembly Origin node renders identically. */
export const ORIGIN_DATUM_DESCRIPTORS: ReadonlyArray<{ id: string; label: string; icon: string; iconClass: string }> = [
  { id: 'origin', label: 'Origin point', icon: 'fiber_manual_record', iconClass: 'datum-point' },
  { id: 'x_axis', label: 'X axis', icon: 'east', iconClass: 'datum-axis-x' },
  { id: 'y_axis', label: 'Y axis', icon: 'north', iconClass: 'datum-axis-y' },
  { id: 'z_axis', label: 'Z axis', icon: 'open_in_new', iconClass: 'datum-axis-z' },
  { id: 'xy_plane', label: originPlaneLabel('xy_plane')!, icon: 'rectangle', iconClass: 'datum-plane-xy' },
  { id: 'yz_plane', label: originPlaneLabel('yz_plane')!, icon: 'rectangle', iconClass: 'datum-plane-yz' },
  { id: 'xz_plane', label: originPlaneLabel('xz_plane')!, icon: 'rectangle', iconClass: 'datum-plane-xz' },
];

/** The assembly's own origin datums at the world origin (canonical ids → rendered
 * at 0 with X/Y/Z colors), filtered by a per-datum visibility map (missing key =
 * visible), matching the part OriginFeature.visibility semantics. */
export function assemblyOriginDatums(visibility: Record<string, boolean>): DatumElement[] {
  return buildOriginDatums().filter((d) => visibility[d.id] !== false);
}

/** A component's seven origin datums transformed into assembly space by its
 * placement, ids prefixed (e.g. `inst:<id>:xy_plane`). Carry sidecars so the
 * viewer draws them at the placed position/orientation. */
export function placedOriginDatums(placement: Placement, idPrefix: string, namePrefix?: string): PlacedDatum[] {
  const origin = transformPoint(placement, [0, 0, 0]);
  const out: PlacedDatum[] = [];
  for (const base of buildOriginDatums()) {
    const id = `${idPrefix}${base.id}`;
    // Corner label = "<part> - <datum>" (e.g. "Bracket-01 - XY plane") so a
    // component's planes are identifiable when shown in the assembly.
    const desc = ORIGIN_DATUM_DESCRIPTORS.find((d) => d.id === base.id);
    const name = namePrefix && desc ? `${namePrefix} - ${desc.label}` : undefined;
    if (base.kind === 'point') {
      out.push({ id, kind: 'point', name, position: origin });
    } else if (base.kind === 'axis' && base.direction) {
      const direction = transformDir(placement, base.direction);
      out.push({ id, kind: 'axis', name, direction, axis: { origin, direction } });
    } else if (base.kind === 'plane' && base.direction) {
      const p = planeForDatum(base.id);
      if (!p) continue;
      out.push({
        id,
        kind: 'plane',
        name,
        direction: transformDir(placement, base.direction),
        plane: {
          origin,
          xAxis: transformDir(placement, p.xAxis),
          yAxis: transformDir(placement, p.yAxis),
          normal: transformDir(placement, p.normal),
        },
      });
    }
  }
  return out;
}

/** Representative plane of a face mesh: vertex centroid + average normal.
 * Null for degenerate meshes. */
export function meshFacePlane(positions: ArrayLike<number>, normals: ArrayLike<number>): { origin: [number, number, number]; normal: [number, number, number] } | null {
  if (positions.length < 3 || normals.length < 3) return null;
  const n = positions.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += positions[i * 3]; cy += positions[i * 3 + 1]; cz += positions[i * 3 + 2]; }
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < normals.length / 3; i++) { nx += normals[i * 3]; ny += normals[i * 3 + 1]; nz += normals[i * 3 + 2]; }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return null;
  return { origin: [cx / n, cy / n, cz / n], normal: [nx / len, ny / len, nz / len] };
}

/** True when every vertex normal of the mesh matches `normal` (a flat face). */
export function meshIsFlat(normals: ArrayLike<number>, normal: [number, number, number]): boolean {
  for (let i = 0; i < normals.length; i += 3) {
    if (normals[i] * normal[0] + normals[i + 1] * normal[1] + normals[i + 2] * normal[2] < 0.999) return false;
  }
  return true;
}

/** Axis of a cylindrical face mesh — the line every vertex normal points
 * through — or null when the face isn't a cylinder (or cone/sphere). */
export function meshCylinderAxis(positions: ArrayLike<number>, normals: ArrayLike<number>): { origin: [number, number, number]; direction: [number, number, number] } | null {
  const n = Math.min(positions.length, normals.length) / 3;
  if (n < 3) return null;
  const N = (i: number): [number, number, number] => [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
  const P = (i: number): [number, number, number] => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const cross = (a: number[], b: number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // Direction: perpendicular to the two least-parallel normals.
  const n0 = N(0);
  let best: [number, number, number] = [0, 0, 0], bestMag = 0;
  for (let i = 1; i < n; i++) {
    const c = cross(n0, N(i)), m = Math.hypot(c[0], c[1], c[2]);
    if (m > bestMag) { best = c; bestMag = m; }
  }
  if (bestMag < 0.1) return null;
  const d: [number, number, number] = [best[0] / bestMag, best[1] / bestMag, best[2] / bestMag];
  for (let i = 0; i < n; i++) {
    const ni = N(i);
    if (Math.abs(ni[0] * d[0] + ni[1] * d[1] + ni[2] * d[2]) > 0.02) return null;
  }
  // Origin: least-squares meeting point of the normal lines, pinned along
  // the axis at the face centroid. Solve A c = b with A = Σ(I − nnᵀ) + ddᵀ.
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0], mean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const ni = N(i), pi = P(i);
    for (let r = 0; r < 3; r++) {
      mean[r] += pi[r] / n;
      for (let c = 0; c < 3; c++) {
        const m = (r === c ? 1 : 0) - ni[r] * ni[c];
        A[r][c] += m;
        b[r] += m * pi[c];
      }
    }
  }
  const dm = d[0] * mean[0] + d[1] * mean[1] + d[2] * mean[2];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) A[r][c] += d[r] * d[c];
    b[r] += d[r] * dm;
  }
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-12) return null;
  const col = (k: number) => A.map((row, r) => row.map((v, c) => (c === k ? b[r] : v)));
  return { origin: [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D], direction: d };
}

/** REQ 912 — assembly-level datum plane FEATURES (skeleton planes), computed
 * in feature order against the assembly's own datums (origin planes + earlier
 * skeleton planes). REQ 1004 — with the composed regen, they may also
 * reference component faces (scoped ids, resolved live from the composed
 * meshes, else the pick-time snapshot) and component origin datums
 * (`inst:<id>:<datum>`, at the component's solved placement), so the plane
 * follows the component. Hidden features are skipped (render-only; a hidden
 * plane is still a valid sketch host through the stored sketch plane
 * snapshot). Returns PlacedDatums with `plane` sidecars so the viewer renders
 * them in the user-datum style and sketches can host on them. */
export function computeSkeletonDatums(
  featureTree: FeatureTree | null | undefined,
  regen?: Pick<AssemblyRegenResponse, 'bodies' | 'instances'> | null,
): PlacedDatum[] {
  const out: PlacedDatum[] = [];
  if (!featureTree) return out;
  const seed = {
    datums: [...buildOriginDatums()] as DatumElement[],
    faces: [],
    topology: { vertices: [], edges: [] },
  };
  const livePlanes = new Map<string, Plane3>();
  for (const inst of regen?.instances ?? []) seed.datums.push(...placedOriginDatums(inst.placement, `inst:${inst.instanceId}:`));
  for (const body of regen?.bodies ?? []) {
    for (const f of body.faces) {
      const p = meshFacePlane(f.positions, f.normals);
      if (p) livePlanes.set(f.faceId, { ...p, xAxis: [1, 0, 0], yAxis: [0, 1, 0] });
    }
  }
  const live = (ref: PlaneRef): PlaneRef =>
    ref?.kind === 'face' && livePlanes.has(ref.faceId) ? { ...ref, fallbackPlane: livePlanes.get(ref.faceId)! } : ref;
  const placements = new Map((regen?.instances ?? []).map((i) => [i.instanceId, i.placement]));
  for (const f of featureTree.features || []) {
    if (f.type === 'datumPoint') {
      // REQ 1005 — reference points: a live face center, else the component-
      // anchored position, else the pick-time snapshot.
      const pt = f as DatumPointFeature;
      const m = pt.method;
      const placement = pt.anchor && (pt.anchor.instanceId === ASSEMBLY_REF_ID ? IDENTITY_PLACEMENT : placements.get(pt.anchor.instanceId));
      let position: [number, number, number] | null = null;
      if (m.kind === 'centerOfFace' && livePlanes.has(m.faceId)) position = livePlanes.get(m.faceId)!.origin as [number, number, number];
      else if (placement) position = transformPoint(placement, pt.anchor!.local);
      else {
        const res = computeDatumPoint(pt, seed as never);
        if (res.ok) position = res.position as [number, number, number];
      }
      if (!position || pt.visible === false) continue;
      // REQ 1006 — the point is a coordinate system: owner axes ∘ its own orientation.
      const quaternion = qMul((placement?.quaternion ?? [0, 0, 0, 1]) as Quat, (pt.anchor?.quat ?? [0, 0, 0, 1]) as Quat);
      out.push({ id: pt.id, kind: 'point', name: pt.name, position, quaternion } as PlacedDatum);
      for (const [axis, v] of [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]] as const) {
        const direction = qRotate(quaternion, [...v]);
        out.push({ id: `${pt.id}:${axis}_axis`, kind: 'axis', direction, axis: { origin: position, direction }, triad: axis } as PlacedDatum);
      }
      continue;
    }
    if (f.type !== 'datumPlane') continue;
    const feat = f as DatumPlaneFeature;
    const m = feat.method as Record<string, unknown>;
    const method = { ...m };
    for (const k of ['planeRef', 'planeRefA', 'planeRefB']) if (m[k]) method[k] = live(m[k] as PlaneRef);
    const res = computeDatumPlane({ ...feat, method } as DatumPlaneFeature, seed as never);
    if (!res.ok) continue;
    const d: PlacedDatum = {
      id: feat.id,
      kind: 'plane',
      name: (feat as { name?: string }).name,
      direction: res.plane.normal,
      plane: res.plane,
    } as PlacedDatum;
    // Later skeleton planes may reference earlier ones.
    seed.datums.push(d);
    if ((feat as { visible?: boolean }).visible !== false) out.push(d);
  }
  return out;
}
