import type {
  SketchState, SketchEntity, SketchConstraint,
  LineEntity, CircleEntity, ArcEntity,
} from './types';
import { onEdgeLookupKey } from './types';
import { ORIGIN_POINT_ID } from './store';

// ────────────────────────────────────────────────────────────────────────────
// Per-entity determinacy via Jacobian rank analysis.
//
// PlaneGCS gives us a scalar system DOF but not per-parameter information.
// We compute it ourselves: build the constraint Jacobian (rows = constraint
// residuals, columns = free parameters at the current geometric
// configuration), reduce it to row echelon form with column pivoting, and
// read off which columns are pivots. Pivot columns are determined; the
// rest are free.
//
// A parameter is "free":
//   - Point x, y for every point that doesn't have a `fixed` constraint
//     (and isn't the synthetic origin).
//   - Radius for every circle / arc.
//
// A constraint contributes 1 or 2 residual rows depending on its kind.
//
// An entity is reported determined when ALL its supporting parameters are
// determined: a point when both x and y are; a line when both endpoints
// are; a circle when center + radius are; an arc when center + start +
// end + radius are.
//
// The Jacobian is computed by finite differences (one forward perturbation
// per param). For the typical sketch (N < 100 params, M < 100 constraints)
// the whole analysis runs in well under a millisecond.
// ────────────────────────────────────────────────────────────────────────────

/** 2D projection of a referenced model edge (its two endpoints on the sketch
 * plane), keyed by topology edgeId. A point with an edge-ref `on-edge`
 * constraint rides that line (1 DOF) rather than being pinned. Same shape the
 * solver consumes via `SolveOptions.externalEdges`. */
export type ExternalEdgeMap = Map<string, readonly [{ x: number; y: number }, { x: number; y: number }]>;

/** Run determinacy analysis on the given sketch. Returns the set of entity
 * IDs (points, lines, circles, arcs) that are fully determined by the
 * current constraint graph. `externalEdges` supplies the projected lines for
 * edge-ref `on-edge` points so they count as 1-DOF (ride the edge) instead of
 * fully pinned; omit it (the default) and such points fall back to pinned. */
export function analyzeDeterminacy(state: SketchState, externalEdges: ExternalEdgeMap = new Map()): Set<string> {
  try {
    return analyzeExact(state, externalEdges);
  } catch (err) {
    console.warn('analyzeDeterminacy: exact analyzer failed, falling back to heuristic:', err);
    return analyzeHeuristic(state);
  }
}

/** The projected edge line for an edge-ref `on-edge` constraint, or null when
 * it's a vertex ref, a cross-part ref, or the edge isn't in `externalEdges`. */
function edgeLineForConstraint(c: SketchConstraint, externalEdges: ExternalEdgeMap)
  : readonly [{ x: number; y: number }, { x: number; y: number }] | null {
  const key = onEdgeLookupKey(c.externalRef);  // local edgeId OR cross-part stable id
  if (!key) return null;
  return externalEdges.get(key) ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// Exact analyzer (Jacobian rank).
// ────────────────────────────────────────────────────────────────────────────

type ParamKind = 'x' | 'y' | 'radius';
interface FreeParam { entityId: string; kind: ParamKind; baseValue: number; }
type EntityIndex = Map<string, { x?: number; y?: number; radius?: number }>;

function analyzeExact(state: SketchState, externalEdges: ExternalEdgeMap): Set<string> {
  const entById = new Map<string, SketchEntity>();
  for (const e of state.entities) entById.set(e.id, e);

  // Pre-fixed params: origin + every `fixed` constraint's target +
  // every projected (Convert Entities) anchor. These are omitted from
  // the column set entirely (no Jacobian column allocated).
  const preFixed = new Set<string>();  // entries: `${id}:x` / `${id}:y` / `${id}:radius`
  preFixed.add(`${ORIGIN_POINT_ID}:x`);
  preFixed.add(`${ORIGIN_POINT_ID}:y`);
  for (const c of state.constraints) {
    if (c.type === 'fixed' && c.targets[0]) {
      const id = c.targets[0].entityId;
      preFixed.add(`${id}:x`);
      preFixed.add(`${id}:y`);
    }
  }
  // The solver always pins projected anchor points (see solver.ts —
  // their positions come from the body's source edge, not the
  // constraint system). Mirror that here or sketches that are fully
  // pinned by a Convert outline will never roll up to "determined".
  // Source is now the on-edge constraint list, not an entity field.
  const entityById = new Map(state.entities.map(en => [en.id, en] as const));
  for (const c of state.constraints) {
    if (c.type !== 'on-edge') continue;
    // A standalone point with a KNOWN edge projection rides the edge (1 DOF):
    // it is NOT pinned here; a point-on-line residual (added in
    // evalAllResiduals) removes exactly its perpendicular DOF. Converted
    // line/circle/arc entities, vertex refs, and edge refs with no available
    // projection stay fully pinned (their coords come straight from the edge).
    const ridesEdge = !!edgeLineForConstraint(c, externalEdges);
    for (const t of c.targets) {
      const e = entityById.get(t.entityId);
      if (!e) continue;
      if (e.kind === 'line') {
        preFixed.add(`${e.startId}:x`); preFixed.add(`${e.startId}:y`);
        preFixed.add(`${e.endId}:x`);   preFixed.add(`${e.endId}:y`);
      } else if (e.kind === 'circle') {
        preFixed.add(`${e.centerId}:x`); preFixed.add(`${e.centerId}:y`);
        preFixed.add(`${e.id}:radius`);
      } else if (e.kind === 'arc') {
        preFixed.add(`${e.centerId}:x`); preFixed.add(`${e.centerId}:y`);
        preFixed.add(`${e.startId}:x`);  preFixed.add(`${e.startId}:y`);
        preFixed.add(`${e.endId}:x`);    preFixed.add(`${e.endId}:y`);
        preFixed.add(`${e.id}:radius`);
      } else if (e.kind === 'point' && !ridesEdge) {
        preFixed.add(`${e.id}:x`); preFixed.add(`${e.id}:y`);
      }
    }
  }

  // Build the free-param vector.
  const params: FreeParam[] = [];
  const index: EntityIndex = new Map();
  const addParam = (entityId: string, kind: ParamKind, baseValue: number) => {
    if (preFixed.has(`${entityId}:${kind}`)) return;
    const i = params.length;
    params.push({ entityId, kind, baseValue });
    let entry = index.get(entityId);
    if (!entry) { entry = {}; index.set(entityId, entry); }
    entry[kind] = i;
  };
  for (const e of state.entities) {
    if (e.kind === 'point') {
      addParam(e.id, 'x', e.x);
      addParam(e.id, 'y', e.y);
    } else if (e.kind === 'circle' || e.kind === 'arc') {
      addParam(e.id, 'radius', e.radius);
    }
  }

  // Initial parameter vector.
  const values = params.map(p => p.baseValue);

  // Evaluate every constraint's residuals at the current values.
  const baseResiduals = evalAllResiduals(state, entById, values, index, externalEdges);
  const M = baseResiduals.length;
  const N = params.length;

  if (N === 0) {
    // Everything is pre-fixed → every entity rolls up via pre-fixed params.
    return rollUpToEntities(state, new Set(preFixed));
  }

  // Numerical Jacobian: M × N. Forward differences with a scaled step.
  const J: number[][] = Array.from({ length: M }, () => new Array(N).fill(0));
  if (M > 0) {
    const EPS = 1e-7;
    for (let i = 0; i < N; i++) {
      const orig = values[i];
      const h = EPS * (Math.abs(orig) + 1);
      values[i] = orig + h;
      const perturbed = evalAllResiduals(state, entById, values, index, externalEdges);
      for (let j = 0; j < M; j++) {
        J[j][i] = (perturbed[j] - baseResiduals[j]) / h;
      }
      values[i] = orig;
    }
  }

  // Reduced row echelon → identify which columns are UNIQUELY determined.
  // A pivot column is "determined" only when its pivot row has zero entries
  // in every FREE column. Otherwise the pivot variable depends on a free
  // variable and is not uniquely fixed by the constraint system.
  const determinedCols = M === 0 ? new Set<number>() : determinedColumns(J);

  const determinedParams = new Set<string>(preFixed);
  for (const i of determinedCols) {
    determinedParams.add(`${params[i].entityId}:${params[i].kind}`);
  }

  return rollUpToEntities(state, determinedParams);
}

/** Final pass: an entity is determined iff every parameter it owns is
 * determined. Lines / arcs additionally require their supporting POINTS
 * to be fully determined (which is implicit when all their x/y params are). */
function rollUpToEntities(state: SketchState, determinedParams: Set<string>): Set<string> {
  const det = new Set<string>();
  const pointDetermined = (id: string) =>
    determinedParams.has(`${id}:x`) && determinedParams.has(`${id}:y`);
  // Pass 1: points.
  for (const e of state.entities) {
    if (e.kind === 'point' && pointDetermined(e.id)) det.add(e.id);
  }
  // Pass 2: lines / circles / arcs.
  for (const e of state.entities) {
    if (e.kind === 'line') {
      if (det.has(e.startId) && det.has(e.endId)) det.add(e.id);
    } else if (e.kind === 'circle') {
      const c = e as CircleEntity;
      if (det.has(c.centerId) && determinedParams.has(`${c.id}:radius`)) det.add(c.id);
    } else if (e.kind === 'arc') {
      const a = e as ArcEntity;
      if (det.has(a.centerId) && det.has(a.startId) && det.has(a.endId)
          && determinedParams.has(`${a.id}:radius`)) {
        det.add(a.id);
      }
    }
  }
  return det;
}

// ────────────────────────────────────────────────────────────────────────────
// Residual evaluation. Each constraint type contributes 0, 1, or 2 rows.
// Constraints we don't know are skipped (they contribute nothing — the
// system effectively under-counts rank, which is conservative).
// ────────────────────────────────────────────────────────────────────────────

function evalAllResiduals(
  state: SketchState, entById: Map<string, SketchEntity>,
  values: number[], index: EntityIndex, externalEdges: ExternalEdgeMap,
): number[] {
  const out: number[] = [];
  // Edge-ref `on-edge` points: a point riding a model edge is constrained to
  // the edge's projected line — 1 residual = signed perpendicular distance to
  // that (fixed) line, removing the perpendicular DOF and leaving the slide
  // DOF. Mirrors the solver's point_on_line for the same point.
  for (const c of state.constraints) {
    if (c.type !== 'on-edge' || c.driven) continue;
    const line = edgeLineForConstraint(c, externalEdges);
    if (!line) continue;
    const [A, B] = line;
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    for (const t of c.targets) {
      const e = entById.get(t.entityId);
      if (e?.kind !== 'point') continue;
      const Px = paramX(state, entById, values, index, e.id);
      const Py = paramY(state, entById, values, index, e.id);
      out.push(((Px - A.x) * dy - (Py - A.y) * dx) / len);
    }
  }
  // Point → model-edge DISTANCE dims (externalRef): the point's perpendicular
  // distance to the fixed projected edge line equals `value` — 1 residual,
  // removing the point's perpendicular DOF (mirrors the solver's p2l_distance).
  // Driven reference dims contribute none — they only measure.
  for (const c of state.constraints) {
    if (c.type !== 'point-line-distance' || !c.externalRef || c.driven || c.value === undefined) continue;
    const line = edgeLineForConstraint(c, externalEdges);
    if (!line) continue;
    const [A, B] = line;
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const e = entById.get(c.targets[0]?.entityId);
    if (e?.kind !== 'point') continue;
    const Px = paramX(state, entById, values, index, e.id);
    const Py = paramY(state, entById, values, index, e.id);
    const d = ((Px - A.x) * dy - (Py - A.y) * dx) / len;  // signed perpendicular distance
    out.push(Math.abs(d) - c.value);
  }
  // Intrinsic arc invariants (mirrors the solver's arc_rules primitive):
  // every arc's start and end MUST lie on the circle of radius R around
  // the arc's center. Without these residuals, the analyzer treats
  // start/end as 4 free DOFs unrelated to the radius — and an arc that
  // is geometrically fully pinned (via center + a coincident point on
  // the curve) is still marked as under-determined because the radius
  // residual alone can't bring start/end to a unique value. PlaneGCS
  // handles this implicitly at solve time; here we have to spell it out.
  for (const e of state.entities) {
    if (e.kind !== 'arc') continue;
    const arc = e as ArcEntity;
    const px = (id: string) => paramX(state, entById, values, index, id);
    const py = (id: string) => paramY(state, entById, values, index, id);
    const pr = (id: string) => paramR(state, entById, values, index, id);
    const cx = px(arc.centerId), cy = py(arc.centerId);
    const sx = px(arc.startId),  sy = py(arc.startId);
    const ex = px(arc.endId),    ey = py(arc.endId);
    const r = pr(arc.id);
    out.push(Math.hypot(sx - cx, sy - cy) - r);
    out.push(Math.hypot(ex - cx, ey - cy) - r);
  }
  for (const c of state.constraints) {
    // Driven dims don't constrain the system — they just read back a
    // measurement. Skip so they don't double-count DOFs.
    if (c.driven) continue;
    appendResiduals(c, state, entById, values, index, out);
  }
  // A NaN residual (e.g. from a constraint whose value resolves to NaN
  // because an upstream equation errored out) poisons the Jacobian and
  // makes EVERY pivot fall below the tol check — the whole sketch
  // reads as under-constrained. Substitute zero so the OTHER
  // constraints can still pin their params.
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) out[i] = 0;
  }
  return out;
}

function appendResiduals(
  c: SketchConstraint, state: SketchState, entById: Map<string, SketchEntity>,
  values: number[], index: EntityIndex, out: number[],
) {
  // Lookups respect both the free-param values (when the entity has a
  // column allocated) and the original state for pre-fixed entities.
  const px = (id: string) => paramX(state, entById, values, index, id);
  const py = (id: string) => paramY(state, entById, values, index, id);
  const pr = (id: string) => paramR(state, entById, values, index, id);
  const e0 = c.targets[0] ? entById.get(c.targets[0].entityId) : undefined;
  const e1 = c.targets[1] ? entById.get(c.targets[1].entityId) : undefined;

  switch (c.type) {
    case 'fixed':
      // Pre-fixed — already accounted for by removing the param from the
      // column set. Contributes no rows.
      return;

    case 'coincident': {
      if (!e0 || !e1) return;
      if (e0.kind === 'point' && e1.kind === 'point') {
        out.push(px(e1.id) - px(e0.id));
        out.push(py(e1.id) - py(e0.id));
      } else if (e0.kind === 'point' && e1.kind === 'line') {
        out.push(pointLineCross(px(e0.id), py(e0.id), e1, px, py));
      } else if (e1.kind === 'point' && e0.kind === 'line') {
        out.push(pointLineCross(px(e1.id), py(e1.id), e0, px, py));
      } else if (e0.kind === 'point' && (e1.kind === 'circle' || e1.kind === 'arc')) {
        out.push(pointCurveResid(px(e0.id), py(e0.id), e1, px, py, pr));
      } else if (e1.kind === 'point' && (e0.kind === 'circle' || e0.kind === 'arc')) {
        out.push(pointCurveResid(px(e1.id), py(e1.id), e0, px, py, pr));
      }
      return;
    }

    case 'horizontal':
      if (e0?.kind === 'line') out.push(py(e0.startId) - py(e0.endId));
      else if (e0?.kind === 'point' && e1?.kind === 'point') out.push(py(e0.id) - py(e1.id));
      return;
    case 'vertical':
      if (e0?.kind === 'line') out.push(px(e0.startId) - px(e0.endId));
      else if (e0?.kind === 'point' && e1?.kind === 'point') out.push(px(e0.id) - px(e1.id));
      return;

    case 'distance': {
      if (!e0 || !e1 || e0.kind !== 'point' || e1.kind !== 'point' || c.value === undefined) return;
      const dx = px(e1.id) - px(e0.id), dy = py(e1.id) - py(e0.id);
      out.push(Math.hypot(dx, dy) - c.value);
      return;
    }
    case 'horizontal-distance': {
      if (!e0 || !e1 || e0.kind !== 'point' || e1.kind !== 'point' || c.value === undefined) return;
      // Use squared form so the residual is smooth at d=0 and sign-agnostic.
      const dx = px(e1.id) - px(e0.id);
      out.push(dx * dx - c.value * c.value);
      return;
    }
    case 'vertical-distance': {
      if (!e0 || !e1 || e0.kind !== 'point' || e1.kind !== 'point' || c.value === undefined) return;
      const dy = py(e1.id) - py(e0.id);
      out.push(dy * dy - c.value * c.value);
      return;
    }
    case 'point-line-distance': {
      if (!e0 || !e1 || c.value === undefined) return;
      const pt = e0.kind === 'point' ? e0 : (e1.kind === 'point' ? e1 : null);
      const ln = e0.kind === 'line' ? e0 : (e1.kind === 'line' ? e1 : null);
      if (!pt || !ln) return;
      out.push(pointLineDistance(px(pt.id), py(pt.id), ln, px, py) - c.value);
      return;
    }

    case 'perpendicular': {
      if (e0?.kind !== 'line' || e1?.kind !== 'line') return;
      const d1x = px(e0.endId) - px(e0.startId), d1y = py(e0.endId) - py(e0.startId);
      const d2x = px(e1.endId) - px(e1.startId), d2y = py(e1.endId) - py(e1.startId);
      out.push(d1x * d2x + d1y * d2y);
      return;
    }
    case 'parallel': {
      if (e0?.kind !== 'line' || e1?.kind !== 'line') return;
      const d1x = px(e0.endId) - px(e0.startId), d1y = py(e0.endId) - py(e0.startId);
      const d2x = px(e1.endId) - px(e1.startId), d2y = py(e1.endId) - py(e1.startId);
      out.push(d1x * d2y - d1y * d2x);
      return;
    }
    case 'tangent': {
      if (!e0 || !e1) return;
      // line + curve
      if (e0.kind === 'line' && (e1.kind === 'circle' || e1.kind === 'arc')) {
        const d = pointLineDistance(px(e1.centerId), py(e1.centerId), e0, px, py);
        out.push(d - pr(e1.id));
        return;
      }
      if (e1.kind === 'line' && (e0.kind === 'circle' || e0.kind === 'arc')) {
        const d = pointLineDistance(px(e0.centerId), py(e0.centerId), e1, px, py);
        out.push(d - pr(e0.id));
        return;
      }
      // curve + curve
      if ((e0.kind === 'circle' || e0.kind === 'arc') && (e1.kind === 'circle' || e1.kind === 'arc')) {
        const dx = px(e1.centerId) - px(e0.centerId);
        const dy = py(e1.centerId) - py(e0.centerId);
        const dist = Math.hypot(dx, dy);
        const sumR = pr(e0.id) + pr(e1.id);
        const diffR = Math.abs(pr(e0.id) - pr(e1.id));
        // External vs internal tangent: pick whichever matches current state.
        const useExternal = Math.abs(dist - sumR) < Math.abs(dist - diffR);
        out.push(dist - (useExternal ? sumR : diffR));
        return;
      }
      return;
    }
    case 'equal': {
      if (!e0 || !e1) return;
      if (e0.kind === 'line' && e1.kind === 'line') {
        const len1 = Math.hypot(px(e0.endId) - px(e0.startId), py(e0.endId) - py(e0.startId));
        const len2 = Math.hypot(px(e1.endId) - px(e1.startId), py(e1.endId) - py(e1.startId));
        out.push(len1 - len2);
        return;
      }
      if ((e0.kind === 'circle' || e0.kind === 'arc') && (e1.kind === 'circle' || e1.kind === 'arc')) {
        out.push(pr(e0.id) - pr(e1.id));
        return;
      }
      return;
    }
    case 'symmetric': {
      const e2 = c.targets[2] ? entById.get(c.targets[2].entityId) : undefined;
      if (e0?.kind !== 'point' || e1?.kind !== 'point' || e2?.kind !== 'line') return;
      const ax = px(e2.startId), ay = py(e2.startId);
      const bx = px(e2.endId), by = py(e2.endId);
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-18) return;
      // Reflect e0 across the axis line and require it to equal e1.
      const p1x = px(e0.id), p1y = py(e0.id);
      const t = ((p1x - ax) * dx + (p1y - ay) * dy) / len2;
      const footX = ax + dx * t, footY = ay + dy * t;
      const reflX = 2 * footX - p1x;
      const reflY = 2 * footY - p1y;
      out.push(reflX - px(e1.id));
      out.push(reflY - py(e1.id));
      return;
    }
    case 'midpoint': {
      if (e0?.kind !== 'point' || e1?.kind !== 'line') return;
      out.push(px(e0.id) - (px(e1.startId) + px(e1.endId)) / 2);
      out.push(py(e0.id) - (py(e1.startId) + py(e1.endId)) / 2);
      return;
    }
    case 'concentric': {
      if (!e0 || !e1) return;
      const a = (e0.kind === 'circle' || e0.kind === 'arc') ? e0 : null;
      const b = (e1.kind === 'circle' || e1.kind === 'arc') ? e1 : null;
      if (!a || !b) return;
      out.push(px(b.centerId) - px(a.centerId));
      out.push(py(b.centerId) - py(a.centerId));
      return;
    }
    case 'coradial': {
      // Same center + same radius. Three residuals = two for concentric
      // plus one for radius equality.
      if (!e0 || !e1) return;
      const a = (e0.kind === 'circle' || e0.kind === 'arc') ? e0 : null;
      const b = (e1.kind === 'circle' || e1.kind === 'arc') ? e1 : null;
      if (!a || !b) return;
      out.push(px(b.centerId) - px(a.centerId));
      out.push(py(b.centerId) - py(a.centerId));
      out.push(pr(b.id) - pr(a.id));
      return;
    }
    case 'collinear': {
      if (e0?.kind !== 'line' || e1?.kind !== 'line') return;
      out.push(pointLineCross(px(e0.startId), py(e0.startId), e1, px, py));
      out.push(pointLineCross(px(e0.endId), py(e0.endId), e1, px, py));
      return;
    }
    case 'radius':
      if ((e0?.kind === 'circle' || e0?.kind === 'arc') && c.value !== undefined) {
        out.push(pr(e0.id) - c.value);
      }
      return;
    case 'diameter':
      if ((e0?.kind === 'circle' || e0?.kind === 'arc') && c.value !== undefined) {
        out.push(2 * pr(e0.id) - c.value);
      }
      return;
    case 'radial-distance':
      // Targets [inner, outer]: outer.radius − inner.radius = value.
      if ((e0?.kind === 'circle' || e0?.kind === 'arc')
          && (e1?.kind === 'circle' || e1?.kind === 'arc') && c.value !== undefined) {
        out.push(pr(e1.id) - pr(e0.id) - c.value);
      }
      return;
    case 'angle': {
      if (e0?.kind !== 'line' || e1?.kind !== 'line' || c.value === undefined) return;
      // residual = cross(L1, L2)/|L1||L2| - sin(target) — angle locked.
      const d1x = px(e0.endId) - px(e0.startId), d1y = py(e0.endId) - py(e0.startId);
      const d2x = px(e1.endId) - px(e1.startId), d2y = py(e1.endId) - py(e1.startId);
      const len1 = Math.hypot(d1x, d1y), len2 = Math.hypot(d2x, d2y);
      if (len1 < 1e-9 || len2 < 1e-9) return;
      const cross = (d1x * d2y - d1y * d2x) / (len1 * len2);
      out.push(cross - Math.sin(c.value));
      return;
    }
    case 'arc-length': {
      if (e0?.kind !== 'arc' || c.value === undefined) return;
      const arc = e0 as ArcEntity;
      const cx = px(arc.centerId), cy = py(arc.centerId);
      const sx = px(arc.startId), sy = py(arc.startId);
      const ex = px(arc.endId), ey = py(arc.endId);
      const sa = Math.atan2(sy - cy, sx - cx);
      const ea = Math.atan2(ey - cy, ex - cx);
      let sweep = ea - sa;
      if (arc.ccw) {
        while (sweep < 0) sweep += 2 * Math.PI;
      } else {
        while (sweep > 0) sweep -= 2 * Math.PI;
        sweep = -sweep;
      }
      out.push(pr(arc.id) * sweep - c.value);
      return;
    }
    case 'chord-distance': {
      // Straight-line distance between arc start and end — reduces to
      // the same residual as `distance(start, end, value)`.
      if (e0?.kind !== 'arc' || c.value === undefined) return;
      const arc = e0 as ArcEntity;
      const dx = px(arc.endId) - px(arc.startId);
      const dy = py(arc.endId) - py(arc.startId);
      out.push(Math.hypot(dx, dy) - c.value);
      return;
    }
  }
}

// Param lookups: respect free-param values when present, otherwise fall
// back to the entity's current state (for pre-fixed entities like origin).

function paramX(
  state: SketchState, entById: Map<string, SketchEntity>,
  values: number[], index: EntityIndex, id: string,
): number {
  const e = index.get(id);
  if (e?.x !== undefined) return values[e.x];
  const ent = entById.get(id);
  return ent?.kind === 'point' ? ent.x : 0;
}
function paramY(
  state: SketchState, entById: Map<string, SketchEntity>,
  values: number[], index: EntityIndex, id: string,
): number {
  const e = index.get(id);
  if (e?.y !== undefined) return values[e.y];
  const ent = entById.get(id);
  return ent?.kind === 'point' ? ent.y : 0;
}
function paramR(
  state: SketchState, entById: Map<string, SketchEntity>,
  values: number[], index: EntityIndex, id: string,
): number {
  const e = index.get(id);
  if (e?.radius !== undefined) return values[e.radius];
  const ent = entById.get(id);
  if (ent?.kind === 'circle' || ent?.kind === 'arc') return ent.radius;
  return 0;
}

/** Signed cross-product residual for "point lies on infinite line through
 * line.startId → line.endId". Zero when the point is on the line. */
function pointLineCross(
  pxv: number, pyv: number,
  line: LineEntity,
  px: (id: string) => number, py: (id: string) => number,
): number {
  const ax = px(line.startId), ay = py(line.startId);
  const bx = px(line.endId), by = py(line.endId);
  return (bx - ax) * (pyv - ay) - (by - ay) * (pxv - ax);
}

/** Perpendicular distance from a point to the infinite line through a, b. */
function pointLineDistance(
  pxv: number, pyv: number,
  line: LineEntity,
  px: (id: string) => number, py: (id: string) => number,
): number {
  const ax = px(line.startId), ay = py(line.startId);
  const bx = px(line.endId), by = py(line.endId);
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return 0;
  return ((bx - ax) * (pyv - ay) - (by - ay) * (pxv - ax)) / len;
}

/** Signed residual for "point lies on circle/arc". Zero when |P − C| = R. */
function pointCurveResid(
  pxv: number, pyv: number,
  curve: CircleEntity | ArcEntity,
  px: (id: string) => number, py: (id: string) => number,
  pr: (id: string) => number,
): number {
  const cx = px(curve.centerId), cy = py(curve.centerId);
  return Math.hypot(pxv - cx, pyv - cy) - pr(curve.id);
}

// ────────────────────────────────────────────────────────────────────────────
// Rank analysis: reduced row echelon form, returning the set of UNIQUELY
// DETERMINED column indices.
//
// A pivot variable is uniquely determined only when its pivot-row entries
// in every FREE column are zero. If any free-column entry is nonzero, the
// pivot variable is a linear function of one or more free variables — i.e.
// it shifts whenever the free variable shifts, so the constraint system
// does NOT pin it to a single value.
//
// This is the key distinction from naïve "rank == count pivot columns":
// pivot columns are the LEADING basic variables; UNIQUELY DETERMINED
// variables are pivot variables whose row no longer depends on any free
// variable after RREF. That gives us proper "this point is locked in
// place" semantics matching SolidWorks's black-vs-blue coloring.
// ────────────────────────────────────────────────────────────────────────────

function determinedColumns(matrix: number[][]): Set<number> {
  const M = matrix.length;
  if (M === 0) return new Set();
  const N = matrix[0].length;
  if (N === 0) return new Set();

  // Copy into a working array.
  const a = matrix.map(row => row.slice());

  // Tolerance scales with the matrix's largest absolute entry — handles
  // sketches with mixed dimension scales (mm vs μm vs in, etc.). The
  // floor 1e-6 covers FD truncation noise: the numerical Jacobian is
  // computed with a step h ≈ 1e-7, so derivatives of nominally-zero
  // residuals can leak ~1e-7 in magnitude. Anything below that is noise.
  let maxAbs = 0;
  for (let r = 0; r < M; r++) for (let c = 0; c < N; c++) {
    const v = Math.abs(a[r][c]);
    if (v > maxAbs) maxAbs = v;
  }
  const tol = Math.max((maxAbs > 0 ? maxAbs : 1) * 1e-7, 1e-6);

  const pivotCols = new Set<number>();
  // pivotRowForCol[c] = which row holds the pivot for column c.
  const pivotRowForCol = new Map<number, number>();
  let pivotRow = 0;
  for (let col = 0; col < N && pivotRow < M; col++) {
    // Pick the row with the largest |a[row][col]| at or below pivotRow.
    let bestRow = pivotRow;
    let bestAbs = Math.abs(a[pivotRow][col]);
    for (let r = pivotRow + 1; r < M; r++) {
      const v = Math.abs(a[r][col]);
      if (v > bestAbs) { bestAbs = v; bestRow = r; }
    }
    if (bestAbs < tol) continue;
    if (bestRow !== pivotRow) [a[pivotRow], a[bestRow]] = [a[bestRow], a[pivotRow]];
    // Eliminate every other row's entry in this column (Gauss-Jordan).
    const pivotVal = a[pivotRow][col];
    for (let r = 0; r < M; r++) {
      if (r === pivotRow) continue;
      const factor = a[r][col];
      if (Math.abs(factor) < tol) continue;
      const scale = factor / pivotVal;
      for (let c = col; c < N; c++) a[r][c] -= scale * a[pivotRow][c];
    }
    pivotCols.add(col);
    pivotRowForCol.set(col, pivotRow);
    pivotRow++;
  }

  // Free columns = columns without a pivot.
  const freeCols: number[] = [];
  for (let c = 0; c < N; c++) if (!pivotCols.has(c)) freeCols.push(c);

  // A pivot variable is determined iff its row has zero entries in every
  // free column. No free cols → every pivot is determined.
  const determined = new Set<number>();
  for (const [col, row] of pivotRowForCol) {
    let allZero = true;
    for (const fc of freeCols) {
      if (Math.abs(a[row][fc]) >= tol) { allZero = false; break; }
    }
    if (allZero) determined.add(col);
  }
  return determined;
}

// ────────────────────────────────────────────────────────────────────────────
// Heuristic fallback — kept as a safety net for the case where the exact
// analyzer throws (e.g., malformed state). Same propagation-rule logic as
// before; doesn't handle implicitly-determined entities (e.g., a triangle
// pinned by a rotational anchor) but is robust to weird inputs.
// ────────────────────────────────────────────────────────────────────────────

function analyzeHeuristic(state: SketchState): Set<string> {
  const determined = new Set<string>();
  const pointDof = new Map<string, number>();
  const entById = new Map<string, SketchEntity>();
  for (const e of state.entities) entById.set(e.id, e);

  for (const e of state.entities) {
    if (e.kind !== 'point') continue;
    const startDof = (e.id === ORIGIN_POINT_ID) ? 0 : 2;
    pointDof.set(e.id, startDof);
    if (startDof <= 0) determined.add(e.id);
  }
  for (const c of state.constraints) {
    if (c.type === 'fixed' && c.targets[0]) {
      const id = c.targets[0].entityId;
      if (pointDof.has(id)) { pointDof.set(id, 0); determined.add(id); }
    }
  }
  // Projected entities — same treatment as the solver: anchors are
  // always pinned, radius (for projected circles/arcs) is locked.
  // Source is the on-edge constraint list (SolidWorks-style link).
  const projectedRadiusLocked = new Set<string>();
  const entityByIdDet = new Map(state.entities.map(en => [en.id, en] as const));
  for (const c of state.constraints) {
    if (c.type !== 'on-edge') continue;
    const pin = (id: string) => {
      if (pointDof.has(id)) { pointDof.set(id, 0); determined.add(id); }
    };
    for (const t of c.targets) {
      const e = entityByIdDet.get(t.entityId);
      if (!e) continue;
      if (e.kind === 'line') { pin(e.startId); pin(e.endId); }
      else if (e.kind === 'circle') { pin(e.centerId); projectedRadiusLocked.add(e.id); }
      else if (e.kind === 'arc') { pin(e.centerId); pin(e.startId); pin(e.endId); projectedRadiusLocked.add(e.id); }
      else if (e.kind === 'point') { pin(e.id); }
    }
  }

  const radiusDimensioned = new Set<string>(projectedRadiusLocked);
  for (const c of state.constraints) {
    if ((c.type === 'radius' || c.type === 'diameter') && c.targets[0]) {
      radiusDimensioned.add(c.targets[0].entityId);
    }
  }
  let rChanged = true; let rIt = 0;
  while (rChanged && rIt < 50) {
    rChanged = false; rIt++;
    for (const c of state.constraints) {
      // equal / coradial / radial-distance all relate two radii, so a
      // dimensioned radius on one side fixes the other.
      if (c.type !== 'equal' && c.type !== 'coradial' && c.type !== 'radial-distance') continue;
      const a = c.targets[0]?.entityId, b = c.targets[1]?.entityId;
      if (!a || !b) continue;
      const ea = entById.get(a), eb = entById.get(b);
      if (!ea || !eb) continue;
      const isCurve = (e: SketchEntity) => e.kind === 'circle' || e.kind === 'arc';
      if (!isCurve(ea) || !isCurve(eb)) continue;
      if (radiusDimensioned.has(a) && !radiusDimensioned.has(b)) { radiusDimensioned.add(b); rChanged = true; }
      if (radiusDimensioned.has(b) && !radiusDimensioned.has(a)) { radiusDimensioned.add(a); rChanged = true; }
    }
  }

  const reduce = (id: string, by: number) => {
    const cur = pointDof.get(id);
    if (cur === undefined || cur <= 0) return false;
    const next = Math.max(0, cur - by);
    pointDof.set(id, next);
    if (next <= 0 && !determined.has(id)) { determined.add(id); return true; }
    return false;
  };

  const curveDetermined = (e: SketchEntity): boolean => {
    if (e.kind === 'line') return determined.has(e.startId) && determined.has(e.endId);
    if (e.kind === 'circle') return determined.has(e.centerId) && radiusDimensioned.has(e.id);
    if (e.kind === 'arc') return determined.has(e.centerId) && radiusDimensioned.has(e.id)
      && determined.has(e.startId) && determined.has(e.endId);
    return false;
  };

  let changed = true; let iters = 0;
  while (changed && iters < 100) {
    changed = false; iters++;
    for (const c of state.constraints) {
      const t0id = c.targets[0]?.entityId;
      const t1id = c.targets[1]?.entityId;
      if (!t0id) continue;
      const e0 = entById.get(t0id);
      const e1 = t1id ? entById.get(t1id) : undefined;
      const e0d = determined.has(t0id);
      const e1d = t1id ? determined.has(t1id) : false;
      switch (c.type) {
        case 'coincident': {
          if (!e0 || !e1) break;
          if (e0.kind === 'point' && e1.kind === 'point') {
            if (e0d) changed = reduce(t1id!, 2) || changed;
            if (e1d) changed = reduce(t0id, 2) || changed;
          } else if (e0.kind === 'point' && e1.kind !== 'point') {
            if (curveDetermined(e1)) changed = reduce(t0id, 1) || changed;
          } else if (e1.kind === 'point' && e0.kind !== 'point') {
            if (curveDetermined(e0)) changed = reduce(t1id!, 1) || changed;
          }
          break;
        }
        case 'distance':
        case 'horizontal-distance':
        case 'vertical-distance': {
          if (!t1id || c.value === undefined) break;
          if (e0?.kind !== 'point' || e1?.kind !== 'point') break;
          if (e0d) changed = reduce(t1id, 1) || changed;
          if (e1d) changed = reduce(t0id, 1) || changed;
          break;
        }
        case 'horizontal':
        case 'vertical': {
          if (e0?.kind !== 'line') break;
          if (determined.has(e0.startId)) changed = reduce(e0.endId, 1) || changed;
          if (determined.has(e0.endId))   changed = reduce(e0.startId, 1) || changed;
          break;
        }
      }
    }
  }

  for (const e of state.entities) {
    if (e.kind === 'line') {
      if (determined.has((e as LineEntity).startId) && determined.has((e as LineEntity).endId)) {
        determined.add(e.id);
      }
    } else if (e.kind === 'circle') {
      const c = e as CircleEntity;
      if (determined.has(c.centerId) && radiusDimensioned.has(c.id)) determined.add(c.id);
    } else if (e.kind === 'arc') {
      const a = e as ArcEntity;
      if (determined.has(a.centerId) && determined.has(a.startId)
          && determined.has(a.endId) && radiusDimensioned.has(a.id)) {
        determined.add(a.id);
      }
    }
  }
  return determined;
}
