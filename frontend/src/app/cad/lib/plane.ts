import type { Plane3 } from './types';

function scale(v: [number, number, number], s: number): [number, number, number] {
  return [v[0] * s, v[1] * s, v[2] * s];
}
function add(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function projectTo3D(plane: Plane3, x2d: number, y2d: number): [number, number, number] {
  return add(add(plane.origin, scale(plane.xAxis, x2d)), scale(plane.yAxis, y2d));
}

export function projectFrom3D(plane: Plane3, world: [number, number, number]): { x: number; y: number } {
  const rel = sub(world, plane.origin);
  return { x: dot(rel, plane.xAxis), y: dot(rel, plane.yAxis) };
}
