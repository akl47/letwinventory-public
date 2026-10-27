// Datum geometry for the assembly viewer (CAD-784/785). Two sources:
//   - the assembly's own origin (origin point + 3 planes + 3 axes at world 0), and
//   - each inserted component's origin datums, transformed into assembly space by
//     the component's solved placement and namespaced so ids don't collide.
// The viewer's addDatum() renders canonical-id datums (no sidecar) at the world
// origin with X/Y/Z colors, and sidecar-carrying datums at their placed frame in
// the "user datum" amber style — so component datums read as added references
// distinct from the assembly origin.

import type { DatumElement, FeatureTree, DatumPlaneFeature } from './types';
import type { Placement } from './assembly.types';
import { buildOriginDatums, planeForDatum, originPlaneLabel, computeDatumPlane } from './datum';
import { transformPoint, transformDir } from './placementMath';

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

/** REQ 912 — assembly-level datum plane FEATURES (skeleton planes), computed
 * in feature order against the assembly's own datums (origin planes + earlier
 * skeleton planes). References resolve only against assembly-owned geometry —
 * no faces or topology, so a skeleton plane can never depend on a mate
 * solution. Hidden features are skipped (render-only; a hidden plane is still
 * a valid sketch host through the stored sketch plane snapshot). Returns
 * PlacedDatums with `plane` sidecars so the viewer renders them in the
 * user-datum style and sketches can host on them. */
export function computeSkeletonDatums(featureTree: FeatureTree | null | undefined): PlacedDatum[] {
  const out: PlacedDatum[] = [];
  if (!featureTree) return out;
  const seed = {
    datums: [...buildOriginDatums()] as DatumElement[],
    faces: [],
    topology: { vertices: [], edges: [] },
  };
  for (const f of featureTree.features || []) {
    if (f.type !== 'datumPlane') continue;
    const feat = f as DatumPlaneFeature;
    const res = computeDatumPlane(feat, seed as never);
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
