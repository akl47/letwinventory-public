// Datum geometry for the assembly viewer (CAD-784/785). Two sources:
//   - the assembly's own origin (origin point + 3 planes + 3 axes at world 0), and
//   - each inserted component's origin datums, transformed into assembly space by
//     the component's solved placement and namespaced so ids don't collide.
// The viewer's addDatum() renders canonical-id datums (no sidecar) at the world
// origin with X/Y/Z colors, and sidecar-carrying datums at their placed frame in
// the "user datum" amber style — so component datums read as added references
// distinct from the assembly origin.

import type { DatumElement } from './types';
import type { Placement } from './assembly.types';
import { buildOriginDatums, planeForDatum } from './datum';
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
  { id: 'xy_plane', label: 'XY plane', icon: 'rectangle', iconClass: 'datum-plane-xy' },
  { id: 'yz_plane', label: 'YZ plane', icon: 'rectangle', iconClass: 'datum-plane-yz' },
  { id: 'xz_plane', label: 'XZ plane', icon: 'rectangle', iconClass: 'datum-plane-xz' },
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
