// Assembly module types (Phase 1). Mirrors the backend DesignAssembly +
// assemblyDoc + composite regenerate payloads.

export interface Placement {
  translate: [number, number, number];
  quaternion: [number, number, number, number]; // x, y, z, w
}

export interface AssemblyInstance {
  instanceId: string;
  partID: number;
  /** `branch` (REQ 788): which line of the part this instance tracks — resolution
   * uses the latest of that branch (live working copy when it's the part's
   * checked-out branch). Absent = legacy "live working copy" behavior. */
  ref?: { kind: 'cad' | 'assembly'; branch?: string };
  /** Set at assembly check-in (REQ 789): the tracked branch's head commit. */
  pinnedCommitHash?: string | null;
  /** Child-part configuration this instance resolves at. Absent = the
   * child's own active configuration. */
  configurationId?: string;
  grounded?: boolean;
  placement: Placement;
  /** REQ 1007 — insert time (ms) for the creation-ordered tree; absent on legacy instances. */
  createdAt?: number;
  suppressed?: boolean;
  visible?: boolean;
}

export type MateType =
  | 'coincident' | 'concentric' | 'parallel' | 'perpendicular'
  | 'distance' | 'angle' | 'tangent' | 'lock'
  // A single component fixed to the assembly origin (no faces / second instance).
  | 'origin';

export interface MateRef { instanceId: string; faceId: string; }

/** REQ 999 — instance id for references to the assembly's own (grounded) origin. */
export const ASSEMBLY_REF_ID = '__assembly__';

/** REQ 998 — a signed axis of mate side A's frame. */
export type FrameAxis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export const FRAME_AXES: FrameAxis[] = ['+x', '-x', '+y', '-y', '+z', '-z'];
/** Where side B's X and Y axes land on side A's frame (Z follows, right-handed). */
export interface MateFrame { x: FrameAxis; y: FrameAxis; }
/** Valid targets for B's Y once B's X is placed: any axis not parallel to X. */
export function frameYOptions(x: FrameAxis): FrameAxis[] {
  return FRAME_AXES.filter((a) => a[1] !== x[1]);
}
/** True for a scoped ref to a component origin or the assembly origin. */
export function isOriginRef(scopedId: string | null): boolean {
  return !!scopedId && (scopedId.endsWith('::origin') || /::csys:[^:]+:origin$/.test(scopedId));
}

/** REQ 1006 — mate-ref face id for a skeleton point's coordinate system:
 * `csys:<pointFeatureId>:<origin|x_axis|y_axis|z_axis>`. */
export function csysRefId(pointId: string, datum: 'origin' | 'x_axis' | 'y_axis' | 'z_axis'): string {
  return `csys:${pointId}:${datum}`;
}
/** The datum part of a csys ref face id (`origin`, `x_axis`, …), or the id itself. */
export function csysDatumOf(faceId: string): string {
  return faceId.startsWith('csys:') ? faceId.split(':')[2] : faceId;
}

export interface Mate {
  mateId: string;
  id?: string;
  type: MateType;
  a: MateRef;
  b: MateRef;
  value?: number;
  flip?: boolean;
  /** REQ 998 — origin-pair coincident only: also align the axes. Absent = points only. */
  frame?: MateFrame;
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
  displayStates?: DisplayState[];
  /** REQ 764 — exploded view: per-instance world offsets at factor 1, scaled
   * by `factor` (0 = assembled … 1 = fully exploded). Persisted server-side
   * via POST /:id/explode/auto and PUT /:id/explode. */
  explode?: { offsets: Record<string, [number, number, number]>; factor: number };
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
  /** REQ 915 — assembly skeleton sketch geometry (assembly WORLD frame), for
   * the in-context overlay + skeleton reference picking. */
  skeleton?: {
    partID: number;
    edges: Array<{
      sketchId: string; entityId: string;
      /** Overlay stableId AND backend resolver key: `asketch:<sid>/<eid>`. */
      key: string;
      polyline: [number, number, number][];
      isStraight: boolean;
      kind: 'line' | 'arc' | 'circle' | 'point';
    }>;
  };
}

/** Mate types valid for a pair of selected face surface kinds. */
export function validMateTypes(kindA: string | undefined, kindB: string | undefined): MateType[] {
  const planar = kindA === 'plane' && kindB === 'plane';
  const cyl = kindA === 'cylinder' && kindB === 'cylinder';
  const mixed = (kindA === 'cylinder' && kindB === 'plane') || (kindA === 'plane' && kindB === 'cylinder');
  const points = kindA === 'point' && kindB === 'point';
  const types: MateType[] = [];
  if (planar) types.push('coincident', 'parallel', 'perpendicular', 'distance', 'angle');
  if (cyl) types.push('concentric');
  if (mixed) types.push('tangent');
  if (points) types.push('coincident', 'distance'); // origin-point pairs
  types.push('lock'); // always available
  return types;
}

/** REQ 1000 — every user-creatable mate type, in sidebar order. */
export const MATE_TYPES: MateType[] = ['coincident', 'distance', 'parallel', 'perpendicular', 'angle', 'concentric', 'tangent', 'lock'];
const MATEABLE_KINDS = ['plane', 'cylinder', 'point'];

/** Mate types still completable given the picked reference kinds (null = slot
 * empty; any non-mateable surface kind only supports lock). */
export function availableMateTypes(a: string | null, b: string | null): MateType[] {
  if (a !== null && b !== null) {
    const ok = validMateTypes(a, b);
    return MATE_TYPES.filter((t) => ok.includes(t));
  }
  const k = a ?? b;
  if (k === null) return MATE_TYPES;
  return MATE_TYPES.filter((t) => MATEABLE_KINDS.some((o) => validMateTypes(k, o).includes(t)));
}

/** Whether a reference of `kind` may fill a slot for the chosen mate type,
 * given the other slot's kind (null = empty). No type / lock accepts anything. */
export function mateAllows(type: MateType | null, kind: string, otherKind: string | null): boolean {
  if (!type || type === 'lock') return true;
  if (otherKind !== null) return validMateTypes(kind, otherKind).includes(type);
  return MATEABLE_KINDS.some((o) => validMateTypes(kind, o).includes(type));
}

/** REQ 1001 — assembly-tree datum row key → scoped mate ref (null if not a datum row). */
export function datumRowMateRef(key: string): string | null {
  const parts = key.split(':');
  if (parts[0] === 'origin-datum') return `${ASSEMBLY_REF_ID}::${parts[1]}`;
  if (parts[0] === 'component-datum') return `${parts[1]}::${parts[2]}`;
  return null;
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
