// In-context editing (CAD-790): when editing component A inside an assembly, the
// OTHER components are shown as read-only ghost geometry positioned around A.
// The assembly regen places every body in assembly WORLD space; to draw them in
// A's local editor frame we apply the inverse of A's solved placement. Each
// overlay face/edge keeps its source instanceId + scoped id so a cross-part pick
// (Phase 2) can report which component + which geometry was clicked.

import type { AssemblyRegenResponse, Placement } from './assembly.types';
import { inverseTransform, transformPoint, transformDir, IDENTITY_PLACEMENT } from './placementMath';

export type Vec3 = [number, number, number];

export interface OverlayFace {
  instanceId: string;
  /** Scoped composed id `instanceId::localFaceId`. */
  faceId: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}
export interface OverlayEdge {
  instanceId: string;
  id: string;
  polyline: Vec3[];
  isStraight: boolean;
  /** Source part id — the part this instance is an occurrence of. Needed to
   * build a cross-part on-edge ExternalRef when a sketch point snaps here. */
  partID: number;
  /** The edge's endpoints in the SOURCE part's local frame. This is the
   * `fallback` geometry the backend resolver matches against (the source edge
   * id isn't carried through the composed regen). */
  sourceStart: Vec3;
  sourceEnd: Vec3;
  /** Deterministic, order-independent id derived from the instance + source
   * endpoints. Stable across regens (same source edge → same id), used to key
   * this edge's live 2D projection for the solver / determinacy. */
  stableId: string;
}

function round3(n: number): number { return Math.round(n * 1000) / 1000; }
function fmtPt(p: Vec3): string { return `${round3(p[0])},${round3(p[1])},${round3(p[2])}`; }

/** Order-independent stable id for a cross-part edge: the two endpoints are
 * sorted canonically so a flipped polyline yields the same id. */
export function cpEdgeStableId(instanceId: string, a: Vec3, b: Vec3): string {
  const sa = fmtPt(a), sb = fmtPt(b);
  const [lo, hi] = sa <= sb ? [sa, sb] : [sb, sa];
  return `cpe:${instanceId}:${lo}|${hi}`;
}

/** Stable id for a cross-part vertex: instance + its source-frame position. */
export function cpVertexStableId(instanceId: string, p: Vec3): string {
  return `cpv:${instanceId}:${fmtPt(p)}`;
}
export interface OverlayVertex {
  instanceId: string;
  /** Vertex position in the host's local frame. */
  position: Vec3;
  /** Source part id (for the cross-part ref). */
  partID: number;
  /** Position in the SOURCE part's local frame — the resolver's fallback. */
  sourcePosition: Vec3;
  /** Deterministic id from instance + source position; stable across regens. */
  stableId: string;
}
export interface InContextOverlay {
  faces: OverlayFace[];
  edges: OverlayEdge[];
  vertices: OverlayVertex[];
}

function mapPoints(arr: number[], fn: (p: Vec3) => Vec3): Float32Array {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i += 3) {
    const r = fn([arr[i], arr[i + 1], arr[i + 2]]);
    out[i] = r[0]; out[i + 1] = r[1]; out[i + 2] = r[2];
  }
  return out;
}

/** Build ghost reference geometry for every component EXCEPT `hostInstanceId`,
 * expressed in the host's local frame. */
export function buildInContextOverlay(regen: AssemblyRegenResponse, hostInstanceId: string): InContextOverlay {
  const hostPose: Placement = regen.instances.find((i) => i.instanceId === hostInstanceId)?.placement
    ?? IDENTITY_PLACEMENT;
  const inv = inverseTransform(hostPose);
  const faces: OverlayFace[] = [];
  const edges: OverlayEdge[] = [];
  const vertices: OverlayVertex[] = [];
  let ei = 0;
  for (const body of regen.bodies || []) {
    if (body.instanceId === hostInstanceId) continue;
    for (const f of body.faces || []) {
      faces.push({
        instanceId: body.instanceId,
        faceId: f.faceId || f.persistentName,
        positions: mapPoints(f.positions, (p) => transformPoint(inv, p)),
        normals: mapPoints(f.normals, (d) => transformDir(inv, d)),
        indices: new Uint32Array(f.indices),
      });
    }
    // World→source-local maps a world-space point back into the source part's
    // own frame (for the fallback geometry the resolver matches on).
    const toSource = inverseTransform(body.placement ?? IDENTITY_PLACEMENT);
    for (const e of body.edges || []) {
      const world = e.polyline as number[][];
      const poly = world.map((p) => transformPoint(inv, [p[0], p[1], p[2]]));
      if (poly.length < 2) continue;
      const w0 = world[0], w1 = world[world.length - 1];
      const sourceStart = transformPoint(toSource, [w0[0], w0[1], w0[2]]);
      const sourceEnd = transformPoint(toSource, [w1[0], w1[1], w1[2]]);
      edges.push({
        instanceId: body.instanceId,
        id: `ovl:${body.instanceId}:e${ei++}`,
        polyline: poly,
        isStraight: poly.length === 2,
        partID: body.partID,
        sourceStart, sourceEnd,
        stableId: cpEdgeStableId(body.instanceId, sourceStart, sourceEnd),
      });
    }
    for (const v of body.vertices || []) {
      const world: Vec3 = [v[0], v[1], v[2]];
      const position = transformPoint(inv, world);
      const sourcePosition = transformPoint(toSource, world);
      vertices.push({
        instanceId: body.instanceId,
        position,
        partID: body.partID,
        sourcePosition,
        stableId: cpVertexStableId(body.instanceId, sourcePosition),
      });
    }
  }
  return { faces, edges, vertices };
}
