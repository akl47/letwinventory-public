import type { DatumElement, Plane3 } from './types';

export function buildOriginDatums(): DatumElement[] {
  return [
    { id: 'origin', kind: 'point' },
    { id: 'x_axis', kind: 'axis', direction: [1, 0, 0] },
    { id: 'y_axis', kind: 'axis', direction: [0, 1, 0] },
    { id: 'z_axis', kind: 'axis', direction: [0, 0, 1] },
    { id: 'xy_plane', kind: 'plane', direction: [0, 0, 1] },
    { id: 'yz_plane', kind: 'plane', direction: [1, 0, 0] },
    { id: 'xz_plane', kind: 'plane', direction: [0, 1, 0] },
  ];
}

export function planeForDatum(id: string): Plane3 | null {
  const O: [number, number, number] = [0, 0, 0];
  switch (id) {
    case 'xy_plane': return { origin: O, xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
    case 'yz_plane': return { origin: O, xAxis: [0, 1, 0], yAxis: [0, 0, 1], normal: [1, 0, 0] };
    case 'xz_plane': return { origin: O, xAxis: [1, 0, 0], yAxis: [0, 0, 1], normal: [0, 1, 0] };
    default: return null;
  }
}
