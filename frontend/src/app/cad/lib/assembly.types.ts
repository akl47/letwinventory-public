// Assembly module types (Phase 1). Mirrors the backend DesignAssembly +
// assemblyDoc + composite regenerate payloads.

export interface Placement {
  translate: [number, number, number];
  quaternion: [number, number, number, number]; // x, y, z, w
}

export interface AssemblyInstance {
  instanceId: string;
  partID: number;
  ref?: { kind: 'cad' | 'assembly' };
  pinnedCommitHash?: string | null;
  grounded?: boolean;
  placement: Placement;
  suppressed?: boolean;
  visible?: boolean;
}

export type MateType =
  | 'coincident' | 'concentric' | 'parallel' | 'perpendicular'
  | 'distance' | 'angle' | 'tangent' | 'lock';

export interface MateRef { instanceId: string; faceId: string; }

export interface Mate {
  mateId: string;
  id?: string;
  type: MateType;
  a: MateRef;
  b: MateRef;
  value?: number;
  flip?: boolean;
  suppressed?: boolean;
}

export interface ConstraintState {
  state: 'under' | 'fully' | 'over';
  dof: number;
  converged: boolean;
  residualNorm: number;
}

export type PatternKind = 'linear' | 'circular' | 'mirror';

export interface AssemblyPattern {
  patternId: string;
  kind: PatternKind;
  seedInstanceId: string;
  count?: number;
  spacing?: [number, number, number];
  axisOrigin?: [number, number, number];
  axisDir?: [number, number, number];
  angleStep?: number;
  planeOrigin?: [number, number, number];
  planeNormal?: [number, number, number];
  suppressed?: boolean;
}

export interface ExplodeConfig {
  offsets: Record<string, [number, number, number]>;
  factor: number;
}

export interface DisplayState {
  id: string;
  name: string;
  hidden: string[];
}

export interface AssemblyDoc {
  nextInstanceSeq: number;
  nextMateSeq: number;
  nextPatternSeq?: number;
  nextDisplayStateSeq?: number;
  instances: AssemblyInstance[];
  mates: Mate[];
  patterns?: AssemblyPattern[];
  explode?: ExplodeConfig;
  displayStates?: DisplayState[];
}

/** An assembly is a unified DesignCADModel row (isAssembly=true) whose content
 * lives in `assemblyDoc`. Type-only import avoids any runtime cycle. */
export type Assembly = import('../../models/cad-model.model').CadModel & { assemblyDoc: AssemblyDoc };

export interface EligiblePart {
  partID: number;
  part: { id: number; name: string; sku?: string; revision?: string };
  hasAssembly: boolean;
}

export interface ComposedFace {
  persistentName: string;
  faceId: string;
  positions: number[];
  normals: number[];
  indices: number[];
  surface?: { kind: string; origin: number[]; normal?: number[]; axis?: number[]; radius?: number };
}

export interface ComposedBody {
  id: string;
  name: string | null;
  instanceId: string;
  partID: number;
  placement: Placement;
  faces: ComposedFace[];
  vertices: number[][];
  edges: Array<{ polyline: number[][] }>;
}

export interface ComposedInstance {
  instanceId: string;
  partID: number;
  placement: Placement;
  bodyIds: string[];
}

export interface AssemblyRegenResponse {
  faces: ComposedFace[];
  vertices: number[][];
  edges: Array<{ polyline: number[][] }>;
  bodies: ComposedBody[];
  instances: ComposedInstance[];
  errors: string[];
  constraintState: ConstraintState | null;
}

/** Mate types valid for a pair of selected face surface kinds. */
export function validMateTypes(kindA: string | undefined, kindB: string | undefined): MateType[] {
  const planar = kindA === 'plane' && kindB === 'plane';
  const cyl = kindA === 'cylinder' && kindB === 'cylinder';
  const mixed = (kindA === 'cylinder' && kindB === 'plane') || (kindA === 'plane' && kindB === 'cylinder');
  const types: MateType[] = [];
  if (planar) types.push('coincident', 'parallel', 'perpendicular', 'distance', 'angle');
  if (cyl) types.push('concentric');
  if (mixed) types.push('tangent');
  types.push('lock'); // always available
  return types;
}

export interface MassProperties {
  volume: number;
  centerOfMass: [number, number, number] | null;
  bodyCount: number;
  bodiesWithMass: number;
  errors?: string[];
}

export interface InterferencePair {
  a: string;
  b: string;
  aabbOverlap: boolean;
  interfering: boolean | null;
}

export interface BomLine {
  item: number;
  partID: number;
  quantity: number;
  part: { id: number; name: string; sku?: string; revision?: string } | null;
}

export const IDENTITY_PLACEMENT: Placement = { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] };

// ── euler (ZYX, degrees) ↔ quaternion, for the placement editor UI ────────────
export function eulerToQuat(rxDeg: number, ryDeg: number, rzDeg: number): [number, number, number, number] {
  const hx = (rxDeg * Math.PI) / 360, hy = (ryDeg * Math.PI) / 360, hz = (rzDeg * Math.PI) / 360;
  const cx = Math.cos(hx), sx = Math.sin(hx);
  const cy = Math.cos(hy), sy = Math.sin(hy);
  const cz = Math.cos(hz), sz = Math.sin(hz);
  // ZYX intrinsic (yaw Z, pitch Y, roll X).
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

export function quatToEuler(q: [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinrCosp, cosrCosp);
  let pitch;
  const sinp = 2 * (w * y - z * x);
  if (Math.abs(sinp) >= 1) pitch = Math.sign(sinp) * (Math.PI / 2);
  else pitch = Math.asin(sinp);
  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(sinyCosp, cosyCosp);
  const deg = (r: number) => (r * 180) / Math.PI;
  return [deg(roll), deg(pitch), deg(yaw)];
}
