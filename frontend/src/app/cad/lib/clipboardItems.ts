// ────────────────────────────────────────────────────────────────────────────
// REQ 1100–1103 — copy / paste of feature-tree items (sketches + features).
//
// Pure: `buildItemsBundle` captures the selected items with what they consume,
// `pasteBundle` adds independent copies to a document and reports references
// it could not carry over, `applyPasteChoices` applies the user's answers from
// the Copy Confirmation dialog. The editor only orchestrates.
//
// Every id-bearing field of every feature type is visited by ONE walker per
// type (`FEATURE_WALKERS`), so listing references, remapping ids, moving
// world-space data and deleting a reference all share the same knowledge of
// the feature shapes. A new feature type must add its walker.
// ────────────────────────────────────────────────────────────────────────────
import type {
  AxisRef, AxisSnapshot, DatumAxisFeature, DatumPlaneFeature, DatumPointFeature, EdgeRef3D,
  ExtrudeDirection, ExtrudeEndCondition, ExtrudeStartCondition, Feature, FeatureTree, Plane3,
  PlaneRef, Sketch, SketchDocument, SketchEntity, VertexRef,
} from './types';
import type { EquationDoc, EquationEntry } from './equations';
import type { ClipboardBundle } from './clipboard';
import { newFeatureId, newSketchId } from './ids';
import { defaultFeatureName } from './featureTree';

type V3 = [number, number, number];
export type RefKind = 'face' | 'vertex' | 'body' | 'feature';

/** What a walker calls for each reference / world-space value on a feature. */
export interface RefVisitor {
  sketch(id: string): string;
  /** A face / vertex / body / feature id. Null deletes the reference; a
   * `required` one cannot be deleted (the walker keeps the old id). */
  ref(kind: RefKind, id: string, label: string, required?: boolean): string | null;
  /** An edge (identified by geometry). Null deletes it. */
  edge(e: EdgeRef3D, label: string, required?: boolean): EdgeRef3D | null;
  /** True when world-space data tied to `id` moves with the paste. */
  moves(id: string): boolean;
  pt(p: V3): V3;
  dir(d: V3): V3;
}

// ── walker helpers ───────────────────────────────────────────────────────────

type FallbackPlane = { origin: V3; normal: V3 };

function movedFallback(v: RefVisitor, oldId: string, fp: FallbackPlane | undefined): FallbackPlane | undefined {
  return fp && v.moves(oldId) ? { origin: v.pt(fp.origin), normal: v.dir(fp.normal) } : fp;
}

function movedPlane(v: RefVisitor, p: Plane3): Plane3 {
  return { origin: v.pt(p.origin), xAxis: v.dir(p.xAxis), yAxis: v.dir(p.yAxis), normal: v.dir(p.normal) };
}

function endCond(v: RefVisitor, c: ExtrudeEndCondition | undefined, label: string): ExtrudeEndCondition | undefined {
  if (!c) return c;
  if (c.kind === 'upToVertex') {
    const id = v.ref('vertex', c.vertexId, `${label} "up to vertex"`);
    return id === null ? { kind: 'blind' } : { ...c, vertexId: id };
  }
  if (c.kind === 'upToSurface' || c.kind === 'offsetFromSurface') {
    const id = v.ref('face', c.faceId, `${label} "${c.kind === 'upToSurface' ? 'up to surface' : 'offset from surface'}"`);
    return id === null ? { kind: 'blind' } : { ...c, faceId: id, fallbackPlane: movedFallback(v, c.faceId, c.fallbackPlane) };
  }
  if (c.kind === 'upToBody') {
    const id = v.ref('body', c.bodyId, `${label} "up to body"`);
    if (id === null) return { kind: 'blind' };
    const faceId = c.faceId === undefined ? undefined : (v.ref('face', c.faceId, `${label} "up to body" face`) ?? undefined);
    return { ...c, bodyId: id, faceId };
  }
  return c;
}

function startCond(v: RefVisitor, c: ExtrudeStartCondition | undefined): ExtrudeStartCondition | undefined {
  if (!c) return c;
  if (c.kind === 'upToVertex') {
    const id = v.ref('vertex', c.vertexId, 'start condition "from vertex"');
    return id === null ? { kind: 'sketchPlane' } : { ...c, vertexId: id };
  }
  if (c.kind === 'upToSurface' || c.kind === 'offsetFromSurface') {
    const id = v.ref('face', c.faceId, 'start condition "from surface"');
    return id === null ? { kind: 'sketchPlane' } : { ...c, faceId: id, fallbackPlane: movedFallback(v, c.faceId, c.fallbackPlane) };
  }
  return c;
}

function dir2(v: RefVisitor, d: ExtrudeDirection | undefined): ExtrudeDirection | undefined {
  return d ? { ...d, endCondition: endCond(v, d.endCondition, 'direction 2 end condition')! } : d;
}

/** Optional id list: deleted entries drop out; an emptied list becomes absent. */
function idList(v: RefVisitor, kind: RefKind, ids: string[] | undefined, label: string): string[] | undefined {
  if (!ids) return ids;
  const out = ids.map(id => v.ref(kind, id, label)).filter((x): x is string => x !== null);
  return out.length ? out : undefined;
}

function planeRef(v: RefVisitor, r: PlaneRef, label: string): PlaneRef {
  if (r.kind === 'datum') {
    // A user datum plane is a feature; origin planes exist in every part.
    return { ...r, datumId: v.ref('feature', r.datumId, label, true) ?? r.datumId };
  }
  const id = v.ref('face', r.faceId, label, true) ?? r.faceId;
  return { ...r, faceId: id, fallbackPlane: v.moves(r.faceId) ? movedPlane(v, r.fallbackPlane) : r.fallbackPlane };
}

function vertexRef(v: RefVisitor, r: VertexRef, label: string): VertexRef {
  const id = v.ref('vertex', r.vertexId, label, true) ?? r.vertexId;
  return { vertexId: id, fallbackPosition: v.moves(r.vertexId) ? v.pt(r.fallbackPosition) : r.fallbackPosition };
}

const edgeReq = (v: RefVisitor, e: EdgeRef3D, label: string): EdgeRef3D => v.edge(e, label, true) ?? e;

function axisRef(v: RefVisitor, r: AxisRef, snap: AxisSnapshot, label: string): { axisRef: AxisRef; axisSnapshot: AxisSnapshot } {
  if (r.kind === 'originAxis') return { axisRef: r, axisSnapshot: snap };
  const e = edgeReq(v, r.edgeRef, label);
  // The visitor moved the edge iff its endpoints changed.
  const moved = e.start !== r.edgeRef.start;
  return {
    axisRef: { kind: 'edge', edgeRef: e },
    axisSnapshot: moved ? { origin: v.pt(snap.origin), direction: v.dir(snap.direction) } : snap,
  };
}

function datumPlane(f: DatumPlaneFeature, v: RefVisitor): DatumPlaneFeature {
  const m = f.method;
  switch (m.kind) {
    case 'offset': return { ...f, method: { ...m, planeRef: planeRef(v, m.planeRef, 'reference plane') } };
    case 'parallelThroughPoint': return { ...f, method: { ...m, planeRef: planeRef(v, m.planeRef, 'reference plane'), vertexRef: vertexRef(v, m.vertexRef, 'through point') } };
    case 'angleThroughEdge': return { ...f, method: { ...m, planeRef: planeRef(v, m.planeRef, 'reference plane'), edgeRef: edgeReq(v, m.edgeRef, 'hinge edge') } };
    case 'threePoints': return { ...f, method: { ...m, vertexRefs: m.vertexRefs.map((r, i) => vertexRef(v, r, `point ${i + 1}`)) as [VertexRef, VertexRef, VertexRef] } };
    case 'midPlane': return { ...f, method: { ...m, planeRefA: planeRef(v, m.planeRefA, 'first plane'), planeRefB: planeRef(v, m.planeRefB, 'second plane') } };
    case 'lineAndPerpFace': return { ...f, method: { ...m, edgeRef: edgeReq(v, m.edgeRef, 'edge'), planeRef: planeRef(v, m.planeRef, 'perpendicular face') } };
    case 'pointAndPerpEdge': return { ...f, method: { ...m, vertexRef: vertexRef(v, m.vertexRef, 'point'), edgeRef: edgeReq(v, m.edgeRef, 'perpendicular edge') } };
    case 'tangentCylinder': return { ...f, method: { ...m, cylinderFaceId: v.ref('face', m.cylinderFaceId, 'cylinder face', true) ?? m.cylinderFaceId, planeRef: planeRef(v, m.planeRef, 'reference plane') } };
  }
}

function datumAxis(f: DatumAxisFeature, v: RefVisitor): DatumAxisFeature {
  const m = f.method;
  switch (m.kind) {
    case 'twoPoints': return { ...f, method: { ...m, vertexRefA: vertexRef(v, m.vertexRefA, 'first point'), vertexRefB: vertexRef(v, m.vertexRefB, 'second point') } };
    case 'alongEdge': return { ...f, method: { ...m, edgeRef: edgeReq(v, m.edgeRef, 'edge') } };
    case 'twoPlanesIntersection': return { ...f, method: { ...m, planeRefA: planeRef(v, m.planeRefA, 'first plane'), planeRefB: planeRef(v, m.planeRefB, 'second plane') } };
    case 'cylindricalFaceAxis': {
      const moved = v.moves(m.cylinderFaceId);
      return { ...f, method: {
        ...m, cylinderFaceId: v.ref('face', m.cylinderFaceId, 'cylinder face', true) ?? m.cylinderFaceId,
        fallbackAxis: moved ? { origin: v.pt(m.fallbackAxis.origin), direction: v.dir(m.fallbackAxis.direction) } : m.fallbackAxis,
      } };
    }
    case 'pointAndPerpFace': return { ...f, method: { ...m, vertexRef: vertexRef(v, m.vertexRef, 'point'), planeRef: planeRef(v, m.planeRef, 'perpendicular face') } };
  }
}

function datumPoint(f: DatumPointFeature, v: RefVisitor): DatumPointFeature {
  const m = f.method;
  switch (m.kind) {
    case 'onVertex': return { ...f, method: { ...m, vertexRef: vertexRef(v, m.vertexRef, 'vertex') } };
    case 'centerOfFace': return { ...f, method: {
      ...m, faceId: v.ref('face', m.faceId, 'face', true) ?? m.faceId,
      fallbackPosition: v.moves(m.faceId) ? v.pt(m.fallbackPosition) : m.fallbackPosition,
    } };
    case 'centerOfCircularEdge': return { ...f, method: { ...m, edgeRef: edgeReq(v, m.edgeRef, 'circular edge') } };
    case 'centerOfMass': return { ...f, method: {
      ...m, bodyId: v.ref('body', m.bodyId, 'body', true) ?? m.bodyId,
      fallbackPosition: v.moves(m.bodyId) ? v.pt(m.fallbackPosition) : m.fallbackPosition,
    } };
    case 'alongEdge': return { ...f, method: { ...m, edgeRef: edgeReq(v, m.edgeRef, 'edge') } };
    case 'threePlanes': return { ...f, method: { ...m, planeRefs: m.planeRefs.map((r, i) => planeRef(v, r, `plane ${i + 1}`)) as [PlaneRef, PlaneRef, PlaneRef] } };
  }
}

/** Mirror plane: reference + its world snapshot. */
function mirrorPlane<T extends { planeRef: PlaneRef; planeSnapshot: Plane3 }>(f: T, v: RefVisitor): Pick<T, 'planeRef' | 'planeSnapshot'> {
  const moved = f.planeRef.kind === 'face' ? v.moves(f.planeRef.faceId) : v.moves(f.planeRef.datumId);
  return { planeRef: planeRef(v, f.planeRef, 'mirror plane'), planeSnapshot: moved ? movedPlane(v, f.planeSnapshot) : f.planeSnapshot };
}

type Walker<T extends Feature> = (f: T, v: RefVisitor) => T;

/** One walker per feature type — the completeness of this record is what
 * guarantees a new feature type cannot be copied with unvisited references. */
export const FEATURE_WALKERS: { [K in Feature['type']]: Walker<Extract<Feature, { type: K }>> } = {
  origin: f => f,
  extrude: (f, v) => ({
    ...f, sketchId: v.sketch(f.sketchId), endCondition: endCond(v, f.endCondition, 'end condition'),
    startCondition: startCond(v, f.startCondition), direction2: dir2(v, f.direction2), bodyIds: idList(v, 'body', f.bodyIds, 'merge target body'),
  }),
  cutExtrude: (f, v) => ({
    ...f, sketchId: v.sketch(f.sketchId), endCondition: endCond(v, f.endCondition, 'end condition'),
    startCondition: startCond(v, f.startCondition), direction2: dir2(v, f.direction2), bodyIds: idList(v, 'body', f.bodyIds, 'cut target body'),
  }),
  revolve: (f, v) => ({ ...f, sketchId: v.sketch(f.sketchId), bodyIds: idList(v, 'body', f.bodyIds, 'merge target body') }),
  cutRevolve: (f, v) => ({ ...f, sketchId: v.sketch(f.sketchId), bodyIds: idList(v, 'body', f.bodyIds, 'cut target body') }),
  sweep: (f, v) => ({ ...f, profileSketchId: v.sketch(f.profileSketchId), pathSketchId: v.sketch(f.pathSketchId), bodyIds: idList(v, 'body', f.bodyIds, 'merge target body') }),
  cutSweep: (f, v) => ({ ...f, profileSketchId: v.sketch(f.profileSketchId), pathSketchId: v.sketch(f.pathSketchId), bodyIds: idList(v, 'body', f.bodyIds, 'cut target body') }),
  loft: (f, v) => ({ ...f, sketchIds: f.sketchIds.map(id => v.sketch(id)), bodyIds: idList(v, 'body', f.bodyIds, 'merge target body') }),
  fillet: (f, v) => ({ ...f, edges: f.edges.map((e, i) => v.edge(e, `edge ${i + 1}`)).filter((e): e is EdgeRef3D => e !== null) }),
  chamfer: (f, v) => ({ ...f, edges: f.edges.map((e, i) => v.edge(e, `edge ${i + 1}`)).filter((e): e is EdgeRef3D => e !== null) }),
  datumPlane,
  datumAxis,
  datumPoint,
  combine: (f, v) => ({
    ...f, targetBodyId: v.ref('body', f.targetBodyId, 'target body', true) ?? f.targetBodyId,
    toolBodyIds: f.toolBodyIds.map(id => v.ref('body', id, 'tool body')).filter((x): x is string => x !== null),
  }),
  mirror: (f, v) => ({ ...f, ...mirrorPlane(f, v), seedFeatureIds: idList(v, 'feature', f.seedFeatureIds, 'seed feature') }),
  linearPattern: (f, v) => ({
    ...f,
    direction1: { ...f.direction1, ...axisRef(v, f.direction1.axisRef, f.direction1.axisSnapshot, 'direction 1') },
    direction2: f.direction2 ? { ...f.direction2, ...axisRef(v, f.direction2.axisRef, f.direction2.axisSnapshot, 'direction 2') } : f.direction2,
    seedFeatureIds: idList(v, 'feature', f.seedFeatureIds, 'seed feature'),
  }),
  circularPattern: (f, v) => ({ ...f, ...axisRef(v, f.axisRef, f.axisSnapshot, 'pattern axis'), seedFeatureIds: idList(v, 'feature', f.seedFeatureIds, 'seed feature') }),
  shell: (f, v) => ({
    ...f,
    faces: f.faces.map((s, i) => {
      const id = v.ref('face', s.faceId, `removed face ${i + 1}`);
      return id === null ? null : { ...s, faceId: id, fallbackPlane: movedFallback(v, s.faceId, s.fallbackPlane)! };
    }).filter((s): s is NonNullable<typeof s> => s !== null),
  }),
  hole: (f, v) => ({
    ...f, bodyIds: idList(v, 'body', f.bodyIds, 'target body'),
    placements: f.placements.map((p, i) => {
      const id = v.ref('face', p.faceId, `placement ${i + 1}`);
      if (id === null) return null;
      return v.moves(p.faceId)
        ? { faceId: id, position: v.pt(p.position), faceCentroid: v.pt(p.faceCentroid), faceNormal: v.dir(p.faceNormal) }
        : { ...p, faceId: id };
    }).filter((p): p is NonNullable<typeof p> => p !== null),
  }),
  mirrorBody: (f, v) => ({ ...f, ...mirrorPlane(f, v), bodyIds: f.bodyIds.map(id => v.ref('body', id, 'body')).filter((x): x is string => x !== null) }),
  moveCopyBody: (f, v) => ({
    ...f, bodyIds: f.bodyIds.map(id => v.ref('body', id, 'body')).filter((x): x is string => x !== null),
    rotate: f.rotate ? { ...f.rotate, ...axisRef(v, f.rotate.axisRef, f.rotate.axisSnapshot, 'rotation axis') } : f.rotate,
  }),
};

export function walkFeature(f: Feature, v: RefVisitor): Feature {
  return (FEATURE_WALKERS[f.type] as Walker<Feature>)(f, v);
}

/** Sketches a feature consumes (closure of a copy). */
export function sketchesOf(f: Feature): string[] {
  const out: string[] = [];
  walkFeature(f, { sketch: id => (out.push(id), id), ref: (_k, id) => id, edge: e => e, moves: () => false, pt: p => p, dir: d => d });
  return out;
}

// ── bundle ───────────────────────────────────────────────────────────────────

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;

/** Equation entries driving the copied items, plus the globals they reference. */
function variablesFor(eq: EquationDoc | null, sketchIds: string[], featureIds: string[]): Record<string, EquationEntry> {
  const entries = eq?.entries ?? {};
  const out: Record<string, EquationEntry> = {};
  const prefixes = [...sketchIds.map(id => `sketch.${id}.`), ...featureIds.map(id => `feature.${id}.`)];
  const queue: string[] = [];
  for (const [k, e] of Object.entries(entries)) {
    if (prefixes.some(p => k.startsWith(p))) { out[k] = e; queue.push(e.expression); }
  }
  while (queue.length) {
    for (const name of queue.pop()!.match(IDENT) ?? []) {
      if (name in out || !(name in entries) || name.includes('.')) continue;
      out[name] = entries[name];
      queue.push(entries[name].expression);
    }
  }
  return structuredClone(out);
}

/** REQ 1100 — bundle of the selected sketches and features. Null when the
 * selection holds nothing copyable (e.g. only the Origin). */
export function buildItemsBundle(
  doc: SketchDocument, tree: FeatureTree, equations: EquationDoc | null,
  sel: { sketchIds: string[]; featureIds: string[] },
  source: ClipboardBundle['source'], namingVersion: number | null,
): ClipboardBundle | null {
  const wanted = new Set(sel.featureIds);
  const features = tree.features.filter(f => wanted.has(f.id) && f.type !== 'origin');
  const sketchIds = new Set(sel.sketchIds.filter(id => doc.sketches[id]));
  for (const f of features) for (const id of sketchesOf(f)) if (doc.sketches[id]) sketchIds.add(id);
  const sketches = [...sketchIds].map(id => doc.sketches[id])
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  if (!features.length && !sketches.length) return null;
  return {
    kind: 'letwinventory-cad', schema: 1, scope: 'items', namingVersion, source,
    sketches: structuredClone(sketches).map(s => ({ ...s, candidates: [] })),
    features: structuredClone(features),
    variables: variablesFor(equations, sketches.map(s => s.id), features.map(f => f.id)),
    primaryPlane: sketches.length ? structuredClone(sketches[0].plane) : null,
  };
}

// ── paste ────────────────────────────────────────────────────────────────────

export interface PasteTarget { hostId: string; plane: Plane3 }

export interface UnresolvedRef {
  /** Stable key for `applyPasteChoices`. */
  key: string;
  /** Pasted item (new id) and its display name. */
  itemId: string;
  itemName: string;
  label: string;
  /** False for a reference the item cannot exist without — it can only dangle. */
  deletable: boolean;
}

export interface VariableClash { name: string; incoming: string; existing: string; value: number | null }
export type VariableChoice = 'existing' | 'rename' | 'bake';

export interface PasteResult {
  doc: SketchDocument;
  tree: FeatureTree;
  equations: EquationDoc;
  unresolved: UnresolvedRef[];
  clashes: VariableClash[];
  newSketchIds: string[];
  newFeatureIds: string[];
  /** Equation keys the paste added (rewritten by variable choices). */
  pastedKeys: string[];
}

interface Rigid { pt(p: V3): V3; dir(d: V3): V3 }

/** Rigid motion carrying plane `a` onto plane `b` (origin and basis). */
export function planeToPlane(a: Plane3, b: Plane3): Rigid {
  const dot = (u: V3, w: V3) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const dir = (d: V3): V3 => {
    const x = dot(d, a.xAxis), y = dot(d, a.yAxis), n = dot(d, a.normal);
    return [
      x * b.xAxis[0] + y * b.yAxis[0] + n * b.normal[0],
      x * b.xAxis[1] + y * b.yAxis[1] + n * b.normal[1],
      x * b.xAxis[2] + y * b.yAxis[2] + n * b.normal[2],
    ];
  };
  const pt = (p: V3): V3 => {
    const d = dir([p[0] - a.origin[0], p[1] - a.origin[1], p[2] - a.origin[2]]);
    return [b.origin[0] + d[0], b.origin[1] + d[1], b.origin[2] + d[2]];
  };
  return { pt, dir };
}

const ORIGIN_DATUMS = new Set(['origin', 'x_axis', 'y_axis', 'z_axis', 'xy_plane', 'yz_plane', 'xz_plane']);

/** Replace whole alphanumeric tokens that are keys of `map` (ids embedded in
 * face / edge / vertex / body ids). */
function remapTokens(s: string, map: Map<string, string>): string {
  return s.replace(/[A-Za-z0-9]+/g, t => map.get(t) ?? t);
}
function mentions(s: string, map: Map<string, string>): boolean {
  return (s.match(/[A-Za-z0-9]+/g) ?? []).some(t => map.has(t));
}

function sketchLabel(s: Sketch): string { return s.name?.trim() || 'Sketch'; }
function featureLabel(f: Feature): string { return (f as { name?: string }).name?.trim() || f.type; }

const edgeKey = (e: EdgeRef3D) => `${e.start.join(',')}>${e.end.join(',')}`;

/**
 * REQ 1101–1103 — add independent copies of the bundle's items to a document.
 * References outside the bundle are kept when `sameModel`, otherwise left
 * dangling and reported in `unresolved` (see `applyPasteChoices`). Variable
 * clashes default to "use existing".
 */
export function pasteBundle(
  doc: SketchDocument, tree: FeatureTree, equations: EquationDoc | null, bundle: ClipboardBundle,
  opts: { target?: PasteTarget | null; sameModel: boolean; now?: number },
): PasteResult {
  const srcSketches = bundle.sketches ?? [];
  const srcFeatures = bundle.features ?? [];
  const now = opts.now ?? Date.now();
  const target = opts.target ?? null;

  const ids = new Map<string, string>();
  for (const s of srcSketches) ids.set(s.id, newSketchId());
  for (const f of srcFeatures) ids.set(f.id, newFeatureId());

  const move: Rigid | null = target && bundle.primaryPlane ? planeToPlane(bundle.primaryPlane, target.plane) : null;
  const unresolved: UnresolvedRef[] = [];
  const keepExternal = opts.sameModel;

  // ── sketches ──
  const sketches: Record<string, Sketch> = { ...doc.sketches };
  const newSketchIds: string[] = [];
  srcSketches.forEach((src, i) => {
    const id = ids.get(src.id)!;
    // A default name ("Sketch 2") takes the next free index; a user name is kept.
    const sketchName = /^Sketch \d+$/.test(src.name ?? '') ? `Sketch ${Object.keys(sketches).length + 1}` : src.name;
    const name = sketchLabel({ ...src, name: sketchName });
    const note = (key: string, label: string, deletable: boolean) =>
      unresolved.push({ key: `${id}|${key}`, itemId: id, itemName: name, label, deletable });

    let hostId = src.hostId, plane = src.plane;
    if (i === 0 && target) { hostId = target.hostId; plane = target.plane; }
    else {
      if (move) plane = { origin: move.pt(plane.origin), xAxis: move.dir(plane.xAxis), yAxis: move.dir(plane.yAxis), normal: move.dir(plane.normal) };
      const hostRef = hostId.slice(hostId.indexOf(':') + 1);
      if (mentions(hostRef, ids)) hostId = remapTokens(hostId, ids);
      else if (hostId.startsWith('datum:') && ORIGIN_DATUMS.has(hostRef) && !move) { /* exists in every part */ }
      // A host outside the bundle that the sketch no longer sits on (moved, or
      // another part): keep the plane, drop the link so regen does not snap it back.
      else if (move || !keepExternal) hostId = 'copied';
    }

    const entities: SketchEntity[] = src.state.entities.map(e => {
      const refId = e.kind === 'intersection' ? e.sourceBodyId : e.kind === 'splineOnSurface' ? e.faceId : null;
      if (refId === null) return e;
      if (mentions(refId, ids)) {
        const mapped = remapTokens(refId, ids);
        return e.kind === 'intersection' ? { ...e, sourceBodyId: mapped } : { ...e, faceId: mapped } as SketchEntity;
      }
      if (!keepExternal) note(`entity|${e.id}`, e.kind === 'intersection' ? 'intersection curve source body' : 'spline on surface face', true);
      return e;
    });

    const constraints = src.state.constraints.map(c => {
      const r = c.externalRef;
      if (!r) return c;
      if (r.scope !== 'cross-part' && mentions(r.featureId, ids)) {
        return { ...c, externalRef: {
          ...r, featureId: remapTokens(r.featureId, ids),
          ...(r.edgeId !== undefined ? { edgeId: remapTokens(r.edgeId, ids) } : {}),
          ...(r.vertexId !== undefined ? { vertexId: remapTokens(r.vertexId, ids) } : {}),
        } };
      }
      if (!keepExternal) {
        const what = r.scope === 'cross-part' ? 'in-context reference' : r.vertexId ? 'model vertex reference' : 'model edge reference';
        note(`constraint|${c.id}`, `${what} (${c.type})`, true);
      }
      return c;
    });

    sketches[id] = { ...src, id, hostId, plane, name: sketchName, candidates: [], createdAt: now + i, state: { entities, constraints } };
    newSketchIds.push(id);
  });

  // ── features ──
  const features = [...tree.features];
  const newFeatureIds: string[] = [];
  srcFeatures.forEach((src, i) => {
    const id = ids.get(src.id)!;
    const named = { ...src, id, createdAt: now + srcSketches.length + i } as Feature;
    // A default name ("Extrude 2") takes the next free index; a user name is kept.
    const dflt = /^.+ \d+$/.test((src as { name?: string }).name ?? '');
    if (dflt || !(src as { name?: string }).name) (named as { name?: string }).name = defaultFeatureName({ ...tree, features }, named);
    const itemName = featureLabel(named);
    const note = (key: string, label: string, required?: boolean) =>
      unresolved.push({ key: `${id}|${key}`, itemId: id, itemName, label, deletable: !required });

    const visitor: RefVisitor = {
      sketch: sid => ids.get(sid) ?? sid,
      ref: (kind, rid, label, required) => {
        if (mentions(rid, ids)) return remapTokens(rid, ids);
        if (kind === 'feature' && ORIGIN_DATUMS.has(rid)) return rid;
        if (!keepExternal) note(`${kind}|${label}|${rid}`, label, required);
        return rid;
      },
      edge: (e, label, required) => {
        const faces = [...(e.faces ?? []), ...(e.faceId ? [e.faceId] : [])];
        if (faces.some(fid => mentions(fid, ids))) {
          return {
            ...e,
            start: move ? move.pt(e.start) : e.start, end: move ? move.pt(e.end) : e.end,
            ...(e.faceId !== undefined ? { faceId: remapTokens(e.faceId, ids) } : {}),
            ...(e.faces ? { faces: e.faces.map(fid => remapTokens(fid, ids)) } : {}),
          };
        }
        if (!keepExternal) note(`edge|${label}|${edgeKey(e)}`, label, required);
        return e;
      },
      moves: rid => !!move && mentions(rid, ids),
      pt: p => (move ? move.pt(p) : p),
      dir: d => (move ? move.dir(d) : d),
    };
    features.push(walkFeature(named, visitor));
    newFeatureIds.push(id);
  });

  // ── variables ──
  const entries: Record<string, EquationEntry> = { ...(equations?.entries ?? {}) };
  const clashes: VariableClash[] = [];
  const pastedKeys: string[] = [];
  for (const [key, e] of Object.entries(bundle.variables ?? {})) {
    if (key.includes('.')) {
      // `sketch.<sid>.…` / `feature.<fid>.…` — re-key onto the pasted item.
      const parts = key.split('.');
      const mapped = ids.get(parts[1]);
      if (!mapped) continue;
      parts[1] = mapped;
      const k = parts.join('.');
      entries[k] = { expression: e.expression, ...(e.lastValue !== undefined ? { lastValue: e.lastValue } : {}) };
      pastedKeys.push(k);
    } else if (!(key in entries)) {
      entries[key] = { expression: e.expression, ...(e.lastValue !== undefined ? { lastValue: e.lastValue } : {}) };
      pastedKeys.push(key);
    } else if (entries[key].expression.trim() !== e.expression.trim()) {
      clashes.push({ name: key, incoming: e.expression, existing: entries[key].expression, value: e.lastValue ?? null });
    }
  }

  return {
    doc: { ...doc, sketches, nextSketchSeq: doc.nextSketchSeq + newSketchIds.length },
    tree: { ...tree, features, nextFeatureSeq: tree.nextFeatureSeq + newFeatureIds.length },
    equations: { ...(equations ?? { entries: {} }), entries },
    unresolved, clashes, newSketchIds, newFeatureIds, pastedKeys,
  };
}

/**
 * Apply the Copy Confirmation answers: delete the chosen unresolved references
 * (REQ 1102) and resolve variable clashes (REQ 1103). `bundle` supplies the
 * incoming expressions for renamed variables.
 */
export function applyPasteChoices(
  r: PasteResult, bundle: ClipboardBundle,
  choices: { deleteKeys: Iterable<string>; variables?: Record<string, VariableChoice> },
): PasteResult {
  const del = new Set(choices.deleteKeys);
  const pastedF = new Set(r.newFeatureIds);

  const features = r.tree.features.map(f => {
    if (!pastedF.has(f.id)) return f;
    const has = (key: string) => del.has(`${f.id}|${key}`);
    return walkFeature(f, {
      sketch: id => id,
      ref: (kind, id, label) => (has(`${kind}|${label}|${id}`) ? null : id),
      edge: (e, label) => (has(`edge|${label}|${edgeKey(e)}`) ? null : e),
      moves: () => false, pt: p => p, dir: d => d,
    });
  });

  const sketches = { ...r.doc.sketches };
  for (const sid of r.newSketchIds) {
    const s = sketches[sid];
    const goneEntities = new Set(s.state.entities.filter(e => del.has(`${sid}|entity|${e.id}`)).map(e => e.id));
    const constraints = s.state.constraints.filter(c =>
      !del.has(`${sid}|constraint|${c.id}`) && !c.targets.some(t => goneEntities.has(t.entityId)));
    if (!goneEntities.size && constraints.length === s.state.constraints.length) continue;
    sketches[sid] = { ...s, state: { entities: s.state.entities.filter(e => !goneEntities.has(e.id)), constraints } };
  }

  const entries = { ...r.equations.entries };
  for (const c of r.clashes) {
    const choice = choices.variables?.[c.name] ?? 'existing';
    let replacement: string | null = null;
    if (choice === 'rename') {
      let n = 2;
      while (`${c.name}_${n}` in entries) n++;
      replacement = `${c.name}_${n}`;
      entries[replacement] = { expression: bundle.variables?.[c.name]?.expression ?? c.incoming, ...(c.value !== null ? { lastValue: c.value } : {}) };
    } else if (choice === 'bake' && c.value !== null) {
      replacement = `(${c.value})`;
    }
    if (replacement === null) continue;
    const re = new RegExp(`(?<![A-Za-z0-9_.])${c.name}(?![A-Za-z0-9_])`, 'g');
    for (const k of r.pastedKeys) {
      if (entries[k]) entries[k] = { ...entries[k], expression: entries[k].expression.replace(re, replacement) };
    }
  }

  return {
    ...r,
    doc: { ...r.doc, sketches },
    tree: { ...r.tree, features },
    equations: { ...r.equations, entries },
    unresolved: r.unresolved.filter(u => !del.has(u.key)),
  };
}
