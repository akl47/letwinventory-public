import { make_gcs_wrapper, init_planegcs_module, GcsWrapper, SolveStatus, Algorithm } from '../vendor/planegcs';
import type { SketchPrimitive, SketchParam } from '../vendor/planegcs';
import type {
  SketchState, SketchConstraint, SketchEntity, CircleEntity, ArcEntity,
} from './types';
import { pointsOf, linesOf, findEntity, findPoint, onEdgeLookupKey, isCenterExternalRef } from './types';
import { ORIGIN_POINT_ID } from './store';

export type SolveStatus_ = 'ok' | 'inconsistent';

export interface SolveResult {
  status: SolveStatus_;
  state: SketchState;
  dof: number;
  /** REQ 860: on an inconsistent solve, the sketch-constraint ids that
   * participate in the conflict (mapped back from PlaneGCS's conflicting
   * primitive tags). Empty/absent when the solver names none. */
  conflicting?: string[];
}

export type GcsModule = unknown; // retained for backward-compat call sites

// ────────────────────────────────────────────────────────────────────────────
// PlaneGCS-backed sketch solver (REQ 558).
//
// PlaneGCS is a Newton-Raphson 2D geometric constraint solver with analytical
// Jacobians — the same solver shipped by FreeCAD. We feed it a translation of
// our SketchState (entities → SketchPoint/SketchLine/SketchCircle/…; constraints
// → matching PlaneGCS constraint types) and read solved coordinates back.
//
// The wrapper is cached for the module lifetime: WASM init is ~50 ms and the
// wrapper exposes `clear_data()` to reset state between solves.
// ────────────────────────────────────────────────────────────────────────────

let wrapperPromise: Promise<GcsWrapper> | null = null;

// In Node (vitest, SSR), Emscripten resolves the WASM file alongside the JS
// module — leave wasm_path undefined so the default locator runs. In a real
// browser the JS lives in a bundled chunk and the WASM is asset-mapped to
// /assets/planegcs/planegcs.wasm in angular.json.
function wasmPathForRuntime(): string | undefined {
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  if (proc?.versions?.node) return undefined;
  return '/assets/planegcs/planegcs.wasm';
}

function getWrapper(): Promise<GcsWrapper> {
  if (!wrapperPromise) {
    // Unit-test runner: Angular's vitest builder serves modules over http, so
    // planegcs's Emscripten loader can't find its `.wasm` on disk. test-setup.ts
    // preloads the bytes onto globalThis; hand them straight to Emscripten as
    // `wasmBinary`, which bypasses all path/URL resolution. Absent in the browser
    // (production) → the normal locateFile path runs unchanged.
    const testBinary = (globalThis as { __PLANEGCS_WASM_BINARY__?: Uint8Array }).__PLANEGCS_WASM_BINARY__;
    wrapperPromise = testBinary
      ? initWrapperFromBinary(testBinary)
      : make_gcs_wrapper(wasmPathForRuntime());
  }
  return wrapperPromise;
}

async function initWrapperFromBinary(wasmBinary: Uint8Array): Promise<GcsWrapper> {
  // Emscripten's Node branch derives its script dir from `import.meta.url` via
  // `url.fileURLToPath()`; under the vitest runner that URL is `http:` and the
  // call throws "The URL must be of scheme file" — before `wasmBinary` is even
  // consulted. Force the browser/web branch (which skips fileURLToPath) by
  // hiding `process.versions.node` across the module factory's SYNCHRONOUS
  // env-detection, and hand it the bytes so it never fetches a file. Restore
  // immediately (the detection is done once the factory call returns, before the
  // awaited instantiation) to avoid leaking the change to concurrent code.
  const init = init_planegcs_module as (arg: { wasmBinary: Uint8Array }) => Promise<{ GcsSystem: new () => unknown }>;
  const versions = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions;
  // `process.versions.node` is READ-ONLY (non-writable) but configurable —
  // plain assignment throws, so hide/restore via defineProperty.
  const savedDesc = versions ? Object.getOwnPropertyDescriptor(versions, 'node') : undefined;
  let modPromise: Promise<{ GcsSystem: new () => unknown }>;
  try {
    if (versions && savedDesc?.configurable) {
      Object.defineProperty(versions, 'node', { value: undefined, configurable: true, writable: true, enumerable: true });
    }
    modPromise = init({ wasmBinary });
  } finally {
    if (versions && savedDesc?.configurable) {
      Object.defineProperty(versions, 'node', savedDesc);
    }
  }
  const mod = await modPromise;
  return new GcsWrapper(new mod.GcsSystem() as never);
}

// Test-only hook: drop the cached wrapper so a fresh one is initialized.
// Useful when WASM-side state needs to be reset between unrelated test suites.
export function _resetSolverForTests(): void {
  wrapperPromise = null;
}

function tangentPrimitive(id: string, a: SketchEntity, b: SketchEntity): SketchPrimitive | null {
  const pair = (x: SketchEntity, y: SketchEntity): SketchPrimitive | null => {
    if (x.kind === 'line' && y.kind === 'circle') return { id, type: 'tangent_lc', l_id: x.id, c_id: y.id };
    if (x.kind === 'line' && y.kind === 'arc')    return { id, type: 'tangent_la', l_id: x.id, a_id: y.id };
    if (x.kind === 'line' && y.kind === 'ellipse')return { id, type: 'tangent_le', l_id: x.id, e_id: y.id };
    if (x.kind === 'circle' && y.kind === 'circle') return { id, type: 'tangent_cc', c1_id: x.id, c2_id: y.id };
    if (x.kind === 'arc' && y.kind === 'arc')    return { id, type: 'tangent_aa', a1_id: x.id, a2_id: y.id };
    if (x.kind === 'circle' && y.kind === 'arc') return { id, type: 'tangent_ca', c_id: x.id, a_id: y.id };
    return null;
  };
  return pair(a, b) ?? pair(b, a);
}

function equalPrimitive(id: string, a: SketchEntity, b: SketchEntity): SketchPrimitive | null {
  if (a.kind === 'line' && b.kind === 'line')      return { id, type: 'equal_length', l1_id: a.id, l2_id: b.id };
  if (a.kind === 'circle' && b.kind === 'circle')  return { id, type: 'equal_radius_cc', c1_id: a.id, c2_id: b.id };
  if (a.kind === 'arc' && b.kind === 'arc')        return { id, type: 'equal_radius_aa', a1_id: a.id, a2_id: b.id };
  if (a.kind === 'circle' && b.kind === 'arc')     return { id, type: 'equal_radius_ca', c1_id: a.id, a2_id: b.id };
  if (a.kind === 'arc' && b.kind === 'circle')     return { id, type: 'equal_radius_ca', c1_id: b.id, a2_id: a.id };
  return null;
}

/** True when `pointId` has a POSITION-determining constraint
 * (coincident with a curve / another point, fixed, or midpoint).
 * Mirrors `isOtherwiseConstrained` in `solve()` — defined at module
 * scope so `translateConstraint` can use it without a closure.
 * Dimensions / orientation constraints don't anchor a point's 2D
 * position, so they don't count. */
function isAnchorPoint(state: SketchState, pointId: string): boolean {
  for (const c of state.constraints) {
    if (c.type !== 'coincident' && c.type !== 'fixed' && c.type !== 'midpoint') continue;
    for (const t of c.targets) {
      if (t.entityId === pointId) return true;
    }
  }
  return false;
}

function translateConstraint(state: SketchState, c: SketchConstraint): SketchPrimitive[] {
  // A center reference (REQ 831/832) is a concentric/coincident constraint with
  // a SINGLE target + a sub:'center' externalRef. The target point is pinned at
  // the projected edge center elsewhere (solveSketch's center-ref pass); emit no
  // GCS primitive here — and short-circuit before any 2nd-target indexing.
  if (isCenterExternalRef(c.externalRef)) return [];
  // Null-safe target access: a constraint may legitimately carry fewer targets
  // than its type's two-target cases expect (e.g. an external single-target
  // ref). Return '' for a missing slot so findEntity yields undefined and the
  // per-case `if (!a || !b) return []` guards handle it instead of throwing.
  const tid = (i: number) => c.targets[i]?.entityId ?? '';
  const at = (i: number) => findEntity(state, tid(i));
  switch (c.type) {
    case 'fixed':
      // Handled at the point level (push as { fixed: true }). No PlaneGCS constraint.
      return [];
    case 'on-edge': {
      // SolidWorks-style Convert Entities link. The target entity's
      // anchor points are usually pinned by the extraFixed pass below
      // (see `solve()`), and re-projection rewrites their coords
      // from the source body edge each regen.
      //
      // When the target is an axis-aligned LINE and at least one
      // endpoint is FREE (otherwise constrained — typically a trim
      // point coincident with a cutter), emit a horizontal /
      // vertical primitive so the line stays axis-aligned through
      // user edits. When both endpoints are pinned in extraFixed,
      // the line is fully determined by the fixed points and a
      // horizontal/vertical primitive would just be reported as a
      // redundant constraint. Diagonal source edges aren't enforced
      // yet; that'd require a phantom collinear reference line.
      if (c.targets.length === 0) return [];
      const target = at(0);
      if (!target || target.kind !== 'line') return [];
      if (!isAnchorPoint(state, target.startId) && !isAnchorPoint(state, target.endId)) return [];
      const p = findPoint(state, target.startId);
      const q = findPoint(state, target.endId);
      if (!p || !q) return [];
      const dx = Math.abs(q.x - p.x);
      const dy = Math.abs(q.y - p.y);
      const TOL = 1e-3;
      if (dx < TOL && dy > TOL) return [{ id: c.id, type: 'vertical_l', l_id: target.id }];
      if (dy < TOL && dx > TOL) return [{ id: c.id, type: 'horizontal_l', l_id: target.id }];
      return [];
    }
    case 'coincident': {
      // Unified "this is on that" constraint. Dispatches on target kinds:
      //   point  + point  → p2p_coincident
      //   point  + line   → point_on_line_pl
      //   point  + curve  → point_on_{circle|arc|ellipse} by curve kind
      // Order-insensitive: we sort so the point comes first.
      const a = at(0), b = at(1);
      if (!a || !b) return [];
      const point = a.kind === 'point' ? a : b.kind === 'point' ? b : null;
      const other = point === a ? b : a;
      if (point && other.kind === 'point') {
        return [{ id: c.id, type: 'p2p_coincident', p1_id: point.id, p2_id: other.id }];
      }
      if (point && other.kind === 'line') {
        return [{ id: c.id, type: 'point_on_line_pl', p_id: point.id, l_id: other.id }];
      }
      if (point && other.kind === 'circle')  return [{ id: c.id, type: 'point_on_circle',  p_id: point.id, c_id: other.id }];
      if (point && other.kind === 'arc')     return [{ id: c.id, type: 'point_on_arc',     p_id: point.id, a_id: other.id }];
      if (point && other.kind === 'ellipse') return [{ id: c.id, type: 'point_on_ellipse', p_id: point.id, e_id: other.id }];
      return [];
    }
    case 'horizontal':
      // A line target → the line is horizontal; two points → the points share
      // a y (point-pair horizontal alignment).
      return at(0)?.kind === 'line'
        ? [{ id: c.id, type: 'horizontal_l', l_id: tid(0) }]
        : [{ id: c.id, type: 'horizontal_pp', p1_id: tid(0), p2_id: tid(1) }];
    case 'vertical':
      return at(0)?.kind === 'line'
        ? [{ id: c.id, type: 'vertical_l', l_id: tid(0) }]
        : [{ id: c.id, type: 'vertical_pp', p1_id: tid(0), p2_id: tid(1) }];
    case 'distance':
      return [{ id: c.id, type: 'p2p_distance', p1_id: tid(0), p2_id: tid(1), distance: c.value ?? 0 }];
    case 'perpendicular':
      // To a model edge (single sketch-line target + externalRef): handled by
      // the edge-orientation pass in solve() via a synthetic fixed line.
      if (c.externalRef) return [];
      return [{ id: c.id, type: 'perpendicular_ll', l1_id: tid(0), l2_id: tid(1) }];
    case 'parallel':
      if (c.externalRef) return [];
      return [{ id: c.id, type: 'parallel', l1_id: tid(0), l2_id: tid(1) }];
    case 'tangent': {
      const a = at(0), b = at(1);
      if (!a || !b) return [];
      const prim = tangentPrimitive(c.id, a, b);
      return prim ? [prim] : [];
    }
    case 'equal': {
      const a = at(0), b = at(1);
      if (!a || !b) return [];
      const prim = equalPrimitive(c.id, a, b);
      return prim ? [prim] : [];
    }
    case 'midpoint': {
      // Targets: [point, line]. Synthesized: point lies on the line AND on its
      // perpendicular bisector ⇒ point sits at the line's midpoint.
      return [
        { id: `${c.id}-onl`, type: 'point_on_line_pl', p_id: tid(0), l_id: tid(1) },
        { id: `${c.id}-pb`, type: 'point_on_perp_bisector_pl', p_id: tid(0), l_id: tid(1) },
      ];
    }
    case 'symmetric': {
      // Targets: [pointA, pointB, axisLine]. Synthesized: midpoint(A,B) lies on
      // the axis AND segment (A,B) is perpendicular to it ⇒ axis is the perp
      // bisector of (A,B), i.e. A and B are mirror images about the axis.
      const axis = at(2);
      if (!axis || axis.kind !== 'line') return [];
      return [
        { id: `${c.id}-mid`, type: 'midpoint_on_line_pppp',
          l1p1_id: tid(0), l1p2_id: tid(1), l2p1_id: axis.startId, l2p2_id: axis.endId },
        { id: `${c.id}-perp`, type: 'perpendicular_pppp',
          l1p1_id: tid(0), l1p2_id: tid(1), l2p1_id: axis.startId, l2p2_id: axis.endId },
      ];
    }
    case 'concentric': {
      // Targets: [curveA, curveB] where each is a circle or arc. Same center.
      const a = at(0), b = at(1);
      const centerA = a && (a.kind === 'circle' || a.kind === 'arc') ? a.centerId : null;
      const centerB = b && (b.kind === 'circle' || b.kind === 'arc') ? b.centerId : null;
      if (!centerA || !centerB) return [];
      return [{ id: c.id, type: 'p2p_coincident', p1_id: centerA, p2_id: centerB }];
    }
    case 'coradial': {
      // Targets: [curveA, curveB] where each is a circle or arc. SAME
      // center AND same radius — i.e., they sit on the same imaginary
      // circle. Synthesized from concentric (centers coincident) + an
      // equal-radius primitive (we reuse the same dispatcher used by
      // `equal`, which knows the right PlaneGCS variant per curve kind).
      const a = at(0), b = at(1);
      if (!a || !b) return [];
      const isCurve = (e: typeof a) => e.kind === 'circle' || e.kind === 'arc';
      if (!isCurve(a) || !isCurve(b)) return [];
      const centerA = (a as { centerId: string }).centerId;
      const centerB = (b as { centerId: string }).centerId;
      const radiusPrim = equalPrimitive(`${c.id}-r`, a, b);
      const out: SketchPrimitive[] = [
        { id: `${c.id}-cc`, type: 'p2p_coincident', p1_id: centerA, p2_id: centerB },
      ];
      if (radiusPrim) out.push(radiusPrim);
      return out;
    }
    case 'collinear': {
      // Targets: [lineA, lineB]. Synthesized: parallel + a point of A lies on B.
      const a = at(0), b = at(1);
      if (!a || !b || a.kind !== 'line' || b.kind !== 'line') return [];
      return [
        { id: `${c.id}-par`, type: 'parallel', l1_id: a.id, l2_id: b.id },
        { id: `${c.id}-onl`, type: 'point_on_line_pl', p_id: a.startId, l_id: b.id },
      ];
    }
    case 'radius': {
      // Targets: [circleOrArc]. Drives the radius parameter directly. Uses
      // PlaneGCS's circle_radius / arc_radius primitives — same shape we
      // already emit for construction-locked radii in buildPrimitives.
      const a = at(0);
      if (!a) return [];
      if (a.kind === 'circle') return [{ id: c.id, type: 'circle_radius', c_id: a.id, radius: c.value ?? 0 }];
      if (a.kind === 'arc')    return [{ id: c.id, type: 'arc_radius',    a_id: a.id, radius: c.value ?? 0 }];
      return [];
    }
    case 'diameter': {
      // Targets: [circleOrArc]. PlaneGCS exposes circle_diameter / arc_diameter
      // (driven), which keeps the constraint semantically distinct from
      // radius in the constraint list / history.
      const a = at(0);
      if (!a) return [];
      if (a.kind === 'circle') return [{ id: c.id, type: 'circle_diameter', c_id: a.id, diameter: c.value ?? 0 }];
      if (a.kind === 'arc')    return [{ id: c.id, type: 'arc_diameter',    a_id: a.id, diameter: c.value ?? 0 }];
      return [];
    }
    case 'radial-distance': {
      // Targets: [inner, outer] concentric circles/arcs. Drives
      // outer.radius − inner.radius = value via PlaneGCS `difference`
      // (param2 − param1 = difference). 'radius' is a valid geom param
      // for both circles and arcs (geom_params.SketchGeometryProperty).
      const inner = at(0), outer = at(1);
      const ok = (e: SketchEntity | undefined) => !!e && (e.kind === 'circle' || e.kind === 'arc');
      if (!ok(inner) || !ok(outer)) return [];
      return [{
        id: c.id, type: 'difference',
        param1: { o_id: inner!.id, prop: 'radius' },
        param2: { o_id: outer!.id, prop: 'radius' },
        difference: c.value ?? 0,
      }];
    }
    case 'angle': {
      // Targets: [lineA, lineB]. Drives the angle between two lines to
      // c.value (radians, magnitude).
      //
      // Two important subtleties:
      //
      // 1. Orient vectors away from the shared vertex when there is one
      //    so the constraint targets the INTERIOR angle at the corner —
      //    matches what `measureAngleBetween` reports and what the user
      //    sees. We use `l2l_angle_pppp` (4 explicit point ids) instead
      //    of `l2l_angle_ll` to control orientation directly.
      //
      // 2. PlaneGCS's angle is SIGNED — passing +π/2 when the current
      //    signed angle is -45° produces a 135° rotation. Sign-correct
      //    the target so the rotation direction matches the current
      //    sense (minimum rotation).
      const a = at(0), b = at(1);
      if (!a || !b || a.kind !== 'line' || b.kind !== 'line') return [];
      const oriented = orientLinesForAngle(a, b, c.angleRays);
      const angle = adjustAngleSignFromPoints(
        state, oriented.l1p1, oriented.l1p2, oriented.l2p1, oriented.l2p2, c.value ?? 0,
      );
      return [{
        id: c.id, type: 'l2l_angle_pppp',
        l1p1_id: oriented.l1p1, l1p2_id: oriented.l1p2,
        l2p1_id: oriented.l2p1, l2p2_id: oriented.l2p2,
        angle,
      }];
    }
    case 'horizontal-distance': {
      const pA = findPoint(state, tid(0));
      const pB = findPoint(state, tid(1));
      if (!pA || !pB) return [];
      const mag = Math.abs(c.value ?? 0);
      const signed = pB.x >= pA.x ? mag : -mag;
      // PlaneGCS `difference` is param2 - param1 = difference (FreeCAD's
      // convention). Setting param1=A, param2=B drives B.x - A.x to the
      // signed target so the user-typed distance lands on B's side of A.
      return [{
        id: c.id, type: 'difference',
        param1: { o_id: pA.id, prop: 'x' },
        param2: { o_id: pB.id, prop: 'x' },
        difference: signed,
      }];
    }
    case 'vertical-distance': {
      const pA = findPoint(state, tid(0));
      const pB = findPoint(state, tid(1));
      if (!pA || !pB) return [];
      const mag = Math.abs(c.value ?? 0);
      const signed = pB.y >= pA.y ? mag : -mag;
      return [{
        id: c.id, type: 'difference',
        param1: { o_id: pA.id, prop: 'y' },
        param2: { o_id: pB.id, prop: 'y' },
        difference: signed,
      }];
    }
    case 'point-line-distance': {
      // Targets: [point, line]. Driven perpendicular distance. PlaneGCS
      // takes signed distance; we feed the absolute value the user typed.
      // EXTERNAL-EDGE variant (externalRef set, single point target): the
      // "line" is a model edge with no sketch entity — built as synthetic
      // fixed geometry in solve() (see edgeDistanceDims). Skip here.
      if (c.externalRef) return [];
      const p = at(0), l = at(1);
      if (!p || !l || l.kind !== 'line') return [];
      return [{ id: c.id, type: 'p2l_distance', p_id: p.id, l_id: l.id, distance: c.value ?? 0 }];
    }
    case 'arc-length': {
      // Targets: [arc]. Drives the arc's length to c.value.
      const a = at(0);
      if (!a || a.kind !== 'arc') return [];
      return [{ id: c.id, type: 'arc_length', a_id: a.id, dist: c.value ?? 0 }];
    }
    case 'chord-distance': {
      // Targets: [arc]. Drives the straight-line distance between the
      // arc's start and end points to c.value. Reuses p2p_distance on
      // the arc's two endpoint references — no new PlaneGCS primitive
      // needed since the arc's start/end are first-class points.
      const a = at(0);
      if (!a || a.kind !== 'arc') return [];
      return [{ id: c.id, type: 'p2p_distance', p1_id: a.startId, p2_id: a.endId, distance: c.value ?? 0 }];
    }
  }
}

function circlesOf(state: SketchState): CircleEntity[] {
  return state.entities.filter((e): e is CircleEntity => e.kind === 'circle');
}

function arcsOf(state: SketchState): ArcEntity[] {
  return state.entities.filter((e): e is ArcEntity => e.kind === 'arc');
}

function buildPrimitives(
  state: SketchState,
  extraFixedIds?: Set<string>,
  pinAllRadii: boolean = false,
): { primitives: (SketchPrimitive | SketchParam)[]; fixedIds: Set<string> } {
  const primitives: (SketchPrimitive | SketchParam)[] = [];
  const fixedIds = new Set<string>(extraFixedIds ?? []);

  // Pin every point referenced by a `fixed` constraint, plus the synthetic
  // origin point (always at 0,0 — it's the sketch's coordinate anchor).
  // Construction geometry is NO LONGER pinned: it's purely a visual mode
  // (dashed reference) and the user can drag it freely. Matches SW.
  for (const c of state.constraints) {
    // Guard the target slot: a malformed/legacy `fixed` with empty targets must
    // not throw and abort the whole solve (determinacy already guards this).
    if (c.type === 'fixed' && c.targets[0]) fixedIds.add(c.targets[0].entityId);
  }
  for (const p of pointsOf(state)) {
    if (p.id === ORIGIN_POINT_ID) fixedIds.add(p.id);
  }

  for (const p of pointsOf(state)) {
    primitives.push({
      id: p.id,
      type: 'point',
      x: p.x,
      y: p.y,
      fixed: fixedIds.has(p.id),
    });
  }
  for (const l of linesOf(state)) {
    primitives.push({
      id: l.id,
      type: 'line',
      p1_id: l.startId,
      p2_id: l.endId,
    });
  }
  for (const c of circlesOf(state)) {
    primitives.push({ id: c.id, type: 'circle', c_id: c.centerId, radius: c.radius });
    // Construction circles used to have their radius pinned here. Removed
    // so construction is purely visual — user can drag / dimension a
    // dashed circle just like a normal one.
    if (pinAllRadii) {
      primitives.push({ id: `_pinrad_${c.id}`, type: 'circle_radius', c_id: c.id, radius: c.radius });
    }
  }
  for (const a of arcsOf(state)) {
    const center = findPoint(state, a.centerId);
    const start = findPoint(state, a.startId);
    const end = findPoint(state, a.endId);
    if (!center || !start || !end) continue;
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
    primitives.push({
      id: a.id, type: 'arc',
      c_id: a.centerId, start_id: a.startId, end_id: a.endId,
      start_angle: startAngle, end_angle: endAngle, radius: a.radius,
    });
    // arc_rules keeps center, start/end points, angles, and radius consistent
    // during solve — PlaneGCS does not infer this automatically.
    primitives.push({ id: `arcrules-${a.id}`, type: 'arc_rules', a_id: a.id });
    if (pinAllRadii) {
      primitives.push({ id: `_pinrad_${a.id}`, type: 'arc_radius', a_id: a.id, radius: a.radius });
    }
  }
  for (const c of state.constraints) {
    // Driven dimensions read geometry back; they don't drive it. Skip
    // them at primitive translation so the solver treats them as
    // display-only annotations and the user can over-pin geometry
    // (e.g. add a redundant chord-distance dim alongside a radius
    // dim) without the system going inconsistent.
    if (c.driven) continue;
    for (const t of translateConstraint(state, c)) primitives.push(t);
  }
  return { primitives, fixedIds };
}

function readBack(state: SketchState, wrapper: GcsWrapper): SketchState {
  return {
    ...state,
    entities: state.entities.map(e => {
      const solved = wrapper.sketch_index.get_primitive(e.id);
      if (!solved) return e;
      if (e.kind === 'point' && solved.type === 'point') {
        return { ...e, x: solved.x, y: solved.y };
      }
      if (e.kind === 'circle' && solved.type === 'circle') {
        return { ...e, radius: solved.radius };
      }
      if (e.kind === 'arc' && solved.type === 'arc') {
        return { ...e, radius: solved.radius };
      }
      return e;
    }),
  };
}

export interface SolveOptions {
  /** When set, pin every non-construction point NOT in this set during
   * the solve. Used after adding a new constraint to bound how much the
   * sketch can move — only points directly relevant to the new constraint
   * are allowed to update, so the rest of the geometry stays put.
   * If the solve fails with these pins, caller should retry without them. */
  movablePoints?: Set<string>;
  /** When true, every circle and arc gets a radius-lock primitive at the
   * current value, so the solver can't grow or shrink curves to satisfy
   * constraints. Used during live drag so attached geometry doesn't
   * resize while the user is just moving a center. */
  pinAllRadii?: boolean;
  /** Phase 2 (REQ 794): live 2D projections of referenced model edges, keyed
   * by topology edgeId. When a sketch point's on-edge constraint names an
   * edge present here, the point is constrained ON that edge line (1 DOF —
   * slides) via synthetic fixed reference points + `point_on_line_ppp`,
   * instead of being pinned. Vertex refs and edges absent here keep the v1
   * pin behavior. */
  externalEdges?: Map<string, [{ x: number; y: number }, { x: number; y: number }]>;
}

function isSolveOptions(x: unknown): x is SolveOptions {
  return !!x && typeof x === 'object'
    && ('movablePoints' in (x as object) || 'pinAllRadii' in (x as object) || 'externalEdges' in (x as object));
}

export async function solveSketch(
  state: SketchState, options?: SolveOptions | GcsModule,
): Promise<SolveResult> {
  // The original signature accepted a GcsModule as the second arg (unused).
  // Anything that doesn't look like a SolveOptions is treated as legacy.
  const opts: SolveOptions = isSolveOptions(options) ? options : {};

  if (state.entities.length === 0) {
    return { status: 'ok', state, dof: 0 };
  }

  const wrapper = await getWrapper();
  wrapper.clear_data();

  // If the caller specified `movablePoints`, freeze every point not in
  // that set. Construction points get the same treatment as normal ones
  // — they're visual-only now, no implicit pinning.
  let extraFixed: Set<string> | undefined;
  if (opts.movablePoints) {
    extraFixed = new Set<string>();
    for (const p of pointsOf(state)) {
      if (!opts.movablePoints.has(p.id)) extraFixed.add(p.id);
    }
  }
  // Projected-entity anchors are USUALLY fixed. Their coordinates
  // come from the body's source edge each regen; if the solver moves
  // them to satisfy a downstream constraint, the next regen
  // overwrites the change and the sketch oscillates.
  //
  // Exception: when a projected entity has been trimmed, the surviving
  // sub-segment inherits its on-edge link AND gets a coincident
  // constraint at the trim point (the cutting curve anchors it). For
  // those endpoints we must NOT pin via on-edge — that would make the
  // coincident unsatisfiable. Skip pinning when the point already has
  // a non-on-edge constraint referencing it. Source is the on-edge
  // constraint list (SolidWorks-style link).
  const entityByIdSolver = new Map(state.entities.map(en => [en.id, en] as const));
  // Only POSITION-determining constraints (coincident / fixed /
  // midpoint) actually anchor a point's 2D coords. Dimensions and
  // orientation constraints don't, so they shouldn't unpin a point
  // from its on-edge anchor — otherwise adding a smart dim to a
  // converted line silently lets the solver drift its endpoints.
  const isOtherwiseConstrained = (pointId: string): boolean => {
    for (const c of state.constraints) {
      if (c.type !== 'coincident' && c.type !== 'fixed' && c.type !== 'midpoint') continue;
      for (const t of c.targets) {
        if (t.entityId === pointId) return true;
      }
    }
    return false;
  };
  const pinPoint = (pointId: string): void => {
    if (isOtherwiseConstrained(pointId)) return;
    if (!extraFixed) extraFixed = new Set<string>();
    extraFixed.add(pointId);
  };
  // Phase 2 (REQ 794): a single point riding a model edge is constrained ON
  // the live-projected edge (1 DOF, slides) rather than pinned. Collect those
  // points first so the pin pass below skips them; the point_on_line helper
  // geometry is appended after buildPrimitives.
  interface EdgeRidePoint { pointId: string; cid: string; line: [{ x: number; y: number }, { x: number; y: number }]; }
  const edgeRidePoints: EdgeRidePoint[] = [];
  for (const c of state.constraints) {
    if (c.type !== 'on-edge' || !c.externalRef) continue;
    // Center reference (REQ 832): the target point pins to the projected edge
    // CENTER, not the edge line. Skip the edge-ride path so it falls through to
    // the pin pass below (frozen at the snapped center; regen re-derives it).
    if (c.externalRef.scope !== 'cross-part' && c.externalRef.sub === 'center') continue;
    // Local model edge → key by topology edgeId; cross-part (another
    // component, in-context) → key by the ref's stable id. Either way the
    // live 2D projection is supplied in opts.externalEdges.
    const key = onEdgeLookupKey(c.externalRef);
    const line = key ? opts.externalEdges?.get(key) : undefined;
    if (!line) continue;
    for (const t of c.targets) {
      const e = entityByIdSolver.get(t.entityId);
      if (e && e.kind === 'point') edgeRidePoints.push({ pointId: e.id, cid: c.id, line });
    }
  }
  // Point-to-model-edge DISTANCE dimensions (externalRef, single point target).
  // Same idea as edgeRidePoints: the model edge has no sketch entity, so we
  // build synthetic fixed reference points at its projected endpoints + a
  // synthetic line + a p2l_distance from the sketch point to that line.
  interface EdgeDistDim { pointId: string; cid: string; line: [{ x: number; y: number }, { x: number; y: number }]; distance: number; driven: boolean; }
  const edgeDistanceDims: EdgeDistDim[] = [];
  for (const c of state.constraints) {
    if (c.type !== 'point-line-distance' || !c.externalRef) continue;
    const key = onEdgeLookupKey(c.externalRef);
    const line = key ? opts.externalEdges?.get(key) : undefined;
    if (!line) continue;
    const e = entityByIdSolver.get(c.targets[0]?.entityId);
    if (e && e.kind === 'point') edgeDistanceDims.push({ pointId: e.id, cid: c.id, line, distance: c.value ?? 0, driven: !!c.driven });
  }
  // Sketch-line PARALLEL / PERPENDICULAR to a model edge (externalRef, single
  // line target). The edge has no sketch entity, so — like edgeDistanceDims —
  // we build a synthetic fixed line at its projection and emit the orientation
  // primitive against the sketch line.
  interface EdgeOrient { lineId: string; cid: string; line: [{ x: number; y: number }, { x: number; y: number }]; type: 'parallel' | 'perpendicular'; }
  const edgeOrientations: EdgeOrient[] = [];
  for (const c of state.constraints) {
    if ((c.type !== 'parallel' && c.type !== 'perpendicular') || !c.externalRef) continue;
    const key = onEdgeLookupKey(c.externalRef);
    const line = key ? opts.externalEdges?.get(key) : undefined;
    if (!line) continue;
    const e = entityByIdSolver.get(c.targets[0]?.entityId);
    if (e && e.kind === 'line') edgeOrientations.push({ lineId: e.id, cid: c.id, line, type: c.type });
  }
  const ridePointIds = new Set(edgeRidePoints.map(r => r.pointId));
  for (const c of state.constraints) {
    if (c.type !== 'on-edge') continue;
    for (const t of c.targets) {
      const e = entityByIdSolver.get(t.entityId);
      if (!e) continue;
      if (e.kind === 'line') { pinPoint(e.startId); pinPoint(e.endId); }
      else if (e.kind === 'circle') { pinPoint(e.centerId); }
      else if (e.kind === 'arc') { pinPoint(e.centerId); pinPoint(e.startId); pinPoint(e.endId); }
      else if (e.kind === 'point') { if (!ridePointIds.has(e.id)) pinPoint(e.id); }
    }
  }
  // Center references (REQ 831/832): a `concentric` (circle/arc) or `coincident`
  // (point) constraint that carries a local externalRef with sub:'center' pins
  // the target's center point at the projected edge center. translateConstraint
  // emits no primitive for these single-target constraints, so the pin is what
  // fixes them (frozen at the snapped center; regen re-derives the coords).
  // Type-agnostic on `sub` so legacy on-edge+sub:center docs pin identically.
  for (const c of state.constraints) {
    const r = c.externalRef;
    if (!r || r.scope === 'cross-part' || r.sub !== 'center') continue;
    const e = entityByIdSolver.get(c.targets[0]?.entityId);
    if (!e) continue;
    if (e.kind === 'point') pinPoint(e.id);
    else if (e.kind === 'circle' || e.kind === 'arc') pinPoint(e.centerId);
  }

  const { primitives } = buildPrimitives(state, extraFixed, opts.pinAllRadii ?? false);
  // Coradial-to-model-edge (REQ): a `coradial` constraint carrying a local
  // externalRef sub:'center' on a single circle/arc target. The center-ref pass
  // above pins its center; here we also pin its RADIUS at the entity's current
  // value. That value is kept equal to the referenced model edge's radius by
  // _reprojectAllSketches (cad-editor), which re-derives the curve's center +
  // radius from the source edge each regen — so the pin tracks the edge's size.
  for (const c of state.constraints) {
    if (c.type !== 'coradial') continue;
    const r = c.externalRef;
    if (!r || r.scope === 'cross-part' || r.sub !== 'center') continue;
    const e = entityByIdSolver.get(c.targets[0]?.entityId);
    if (e?.kind === 'circle') primitives.push({ id: `_coradrad_${c.id}`, type: 'circle_radius', c_id: e.id, radius: e.radius });
    else if (e?.kind === 'arc') primitives.push({ id: `_coradrad_${c.id}`, type: 'arc_radius', a_id: e.id, radius: e.radius });
  }
  // On-edge CIRCLE/ARC to a model edge: the curve coincides with that edge, so
  // its RADIUS must be pinned too (the on-edge pass above only pins the center).
  // Without this the radius is a free DOF and any later constraint that touches
  // the curve — e.g. a coincident point where the user attaches a line — silently
  // resizes it off the edge. _reprojectAllSketches keeps e.radius equal to the
  // source edge's radius each regen, so pinning to e.radius tracks the edge. The
  // determinacy analyzer already pre-fixes this radius; this makes the solver
  // agree. (sub:'center' refs are concentric/coradial, handled above — skip.)
  for (const c of state.constraints) {
    if (c.type !== 'on-edge' || !c.externalRef) continue;
    if (c.externalRef.scope !== 'cross-part' && c.externalRef.sub === 'center') continue;
    const e = entityByIdSolver.get(c.targets[0]?.entityId);
    if (e?.kind === 'circle') primitives.push({ id: `_onedgerad_${c.id}`, type: 'circle_radius', c_id: e.id, radius: e.radius });
    else if (e?.kind === 'arc') primitives.push({ id: `_onedgerad_${c.id}`, type: 'arc_radius', a_id: e.id, radius: e.radius });
  }
  // Synthetic point-on-edge geometry: two fixed reference points at the
  // projected edge endpoints + a point_on_line_ppp tying the sketch point to
  // that line. These ids never collide with entity ids and readBack ignores
  // them (it only reads entities), so no visible geometry is created.
  for (const r of edgeRidePoints) {
    const a = `_extrefA_${r.cid}`;
    const b = `_extrefB_${r.cid}`;
    primitives.push({ id: a, type: 'point', x: r.line[0].x, y: r.line[0].y, fixed: true });
    primitives.push({ id: b, type: 'point', x: r.line[1].x, y: r.line[1].y, fixed: true });
    primitives.push({ id: `_extrefC_${r.cid}`, type: 'point_on_line_ppp', p_id: r.pointId, lp1_id: a, lp2_id: b });
  }
  // Point-to-edge distance dims: fixed endpoints + synthetic line + p2l_distance.
  // Driven (reference) dims measure only — skip the constraint, keep the synthetic
  // geometry out entirely so they never affect the solve.
  for (const r of edgeDistanceDims) {
    if (r.driven) continue;
    const a = `_distA_${r.cid}`, b = `_distB_${r.cid}`, ln = `_distL_${r.cid}`;
    primitives.push({ id: a, type: 'point', x: r.line[0].x, y: r.line[0].y, fixed: true });
    primitives.push({ id: b, type: 'point', x: r.line[1].x, y: r.line[1].y, fixed: true });
    primitives.push({ id: ln, type: 'line', p1_id: a, p2_id: b });
    primitives.push({ id: `_distC_${r.cid}`, type: 'p2l_distance', p_id: r.pointId, l_id: ln, distance: r.distance });
  }
  // Line-to-edge orientation: fixed endpoints + synthetic line + parallel /
  // perpendicular against the sketch line (whose PlaneGCS line id is its id).
  for (const r of edgeOrientations) {
    const a = `_orientA_${r.cid}`, b = `_orientB_${r.cid}`, ln = `_orientL_${r.cid}`;
    primitives.push({ id: a, type: 'point', x: r.line[0].x, y: r.line[0].y, fixed: true });
    primitives.push({ id: b, type: 'point', x: r.line[1].x, y: r.line[1].y, fixed: true });
    primitives.push({ id: ln, type: 'line', p1_id: a, p2_id: b });
    primitives.push(r.type === 'parallel'
      ? { id: `_orientC_${r.cid}`, type: 'parallel', l1_id: r.lineId, l2_id: ln }
      : { id: `_orientC_${r.cid}`, type: 'perpendicular_ll', l1_id: r.lineId, l2_id: ln });
  }
  try {
    wrapper.push_primitives_and_params(primitives);
  } catch (e) {
    wrapper.clear_data();
    throw e;
  }

  const status = wrapper.solve(Algorithm.DogLeg);
  const dof = wrapper.gcs.dof();

  if (status === SolveStatus.Success || status === SolveStatus.Converged) {
    wrapper.apply_solution();
    const newState = readBack(state, wrapper);
    wrapper.clear_data();
    return { status: 'ok', state: newState, dof };
  }

  // REQ 860: map PlaneGCS's conflicting primitive ids back to sketch
  // constraint ids. Primitive-id conventions: a plain constraint emits
  // primitives with `id === c.id`; multi-primitive translations use
  // `${c.id}-suffix`; solver-internal synthetics use `_prefix_${c.id}`.
  let conflicting: string[] | undefined;
  try {
    if (wrapper.has_gcs_conflicting_constraints()) {
      const raw = wrapper.get_gcs_conflicting_constraints();
      const cids = new Set(state.constraints.map(c => c.id));
      const mapped = new Set<string>();
      for (const pid of raw) {
        if (cids.has(pid)) { mapped.add(pid); continue; }
        const synthetic = pid.match(/^_[a-zA-Z]+_(.+)$/);
        if (synthetic && cids.has(synthetic[1])) { mapped.add(synthetic[1]); continue; }
        for (const cid of cids) {
          if (pid.startsWith(cid + '-')) { mapped.add(cid); break; }
        }
      }
      if (mapped.size) conflicting = [...mapped];
    }
  } catch { /* diagnostics only — never fail the solve path over them */ }
  wrapper.clear_data();
  return { status: 'inconsistent', state, dof, conflicting };
}

/**
 * Two-pass solve specifically for "user just added a new constraint".
 *
 * First pass: pin every point NOT directly referenced by the new
 * constraint, then solve. This forces the solver to satisfy the constraint
 * by moving ONLY the points it has to, instead of redistributing slack
 * across the whole sketch (which makes unrelated geometry jump).
 *
 * Fallback: if the constrained pass can't find a solution, retry with a
 * normal solve. Some constraints genuinely require multiple points to
 * move (e.g. a tangent constraint pulling a circle into a line).
 */
export async function solveSketchAfterAdd(
  state: SketchState, newConstraintId: string,
  externalEdges?: SolveOptions['externalEdges'],
): Promise<SolveResult> {
  const newC = state.constraints.find(c => c.id === newConstraintId);
  if (!newC) return solveSketch(state, { externalEdges });
  const movable = movablePointsForNewConstraint(state, newC);
  const first = await solveSketch(state, { movablePoints: movable, externalEdges });
  if (first.status === 'ok') return first;
  return solveSketch(state, { externalEdges });
}

/**
 * Per-constraint heuristic for which points the solver is allowed to move
 * after the constraint is added. The general rule is "any point structurally
 * controlled by a target entity"; specific constraint kinds get tighter
 * rules to avoid the solver redistributing slack into unrelated geometry.
 *
 * - `angle` / `perpendicular` / `parallel`: pin the FIRST line's endpoints
 *   entirely, let only the SECOND line's non-shared endpoint rotate. This
 *   gives the natural "first pick = reference, second pick = subject"
 *   behaviour that matches SolidWorks. Without this, a 90° angle on two
 *   floating lines would let the solver rotate both arbitrarily, often
 *   landing far from the user's original geometry.
 * - default: union of `pointIdsControlledBy` for every target entity.
 */
function movablePointsForNewConstraint(
  state: SketchState, c: SketchConstraint,
): Set<string> {
  if (c.type === 'angle' || c.type === 'perpendicular' || c.type === 'parallel') {
    const l1 = findEntity(state, c.targets[0]?.entityId);
    const l2 = findEntity(state, c.targets[1]?.entityId);
    if (l1?.kind === 'line' && l2?.kind === 'line') {
      const l1Points = new Set([l1.startId, l1.endId]);
      const movable = new Set<string>();
      // l2's endpoints, EXCLUDING any shared with l1 (those are pinned as
      // part of l1's pin set, so the second line rotates about the shared
      // corner instead of breaking the connection).
      if (!l1Points.has(l2.startId)) movable.add(l2.startId);
      if (!l1Points.has(l2.endId))   movable.add(l2.endId);
      return movable;
    }
  }
  const movable = new Set<string>();
  for (const t of c.targets) {
    const e = findEntity(state, t.entityId);
    if (!e) continue;
    for (const pid of pointIdsControlledBy(e)) movable.add(pid);
  }
  return movable;
}

/**
 * Reorient the two lines for an angle constraint so that both direction
 * vectors point AWAY from the shared vertex if there is one. This makes
 * `l2l_angle_pppp` measure the interior angle at the corner, matching
 * what the user reads off and types in.
 *
 * Returns four point ids (l1p1 → l1p2 is L1's direction; l2p1 → l2p2 is
 * L2's). When the lines don't share a vertex, the original start/end
 * order is preserved.
 */
function orientLinesForAngle(
  l1: SketchEntity, l2: SketchEntity, angleRays?: [number, number],
): { l1p1: string; l1p2: string; l2p1: string; l2p2: string } {
  if (l1.kind !== 'line' || l2.kind !== 'line') {
    // Shouldn't happen — caller validates — but fall back to identity.
    return { l1p1: '', l1p2: '', l2p1: '', l2p2: '' };
  }
  // Placement-locked orientation (the quadrant the user dropped the dim in):
  // sA/sB = +1 means the line's own start→end direction, -1 means reversed.
  // The directed angle between these rays IS the measured value, so the solver
  // holds the exact angle the user picked (interior vs supplementary).
  if (angleRays) {
    const [sA, sB] = angleRays;
    return {
      l1p1: sA >= 0 ? l1.startId : l1.endId,
      l1p2: sA >= 0 ? l1.endId : l1.startId,
      l2p1: sB >= 0 ? l2.startId : l2.endId,
      l2p2: sB >= 0 ? l2.endId : l2.startId,
    };
  }
  let shared: string | null = null;
  if (l1.startId === l2.startId || l1.startId === l2.endId) shared = l1.startId;
  else if (l1.endId === l2.startId || l1.endId === l2.endId) shared = l1.endId;
  if (shared) {
    return {
      l1p1: shared,
      l1p2: l1.startId === shared ? l1.endId : l1.startId,
      l2p1: shared,
      l2p2: l2.startId === shared ? l2.endId : l2.startId,
    };
  }
  return { l1p1: l1.startId, l1p2: l1.endId, l2p1: l2.startId, l2p2: l2.endId };
}

/** Sign-correct an angle target against the current orientation of two
 * direction vectors (defined by 4 oriented points). Returns the target's
 * magnitude with the sign of the current signed angle, so the solver
 * picks the rotation matching current geometry. */
function adjustAngleSignFromPoints(
  state: SketchState,
  l1p1: string, l1p2: string, l2p1: string, l2p2: string,
  target: number,
): number {
  const a1 = findPoint(state, l1p1), a2 = findPoint(state, l1p2);
  const b1 = findPoint(state, l2p1), b2 = findPoint(state, l2p2);
  if (!a1 || !a2 || !b1 || !b2) return target;
  const ax = a2.x - a1.x, ay = a2.y - a1.y;
  const bx = b2.x - b1.x, by = b2.y - b1.y;
  const cross = ax * by - ay * bx;
  const dot = ax * bx + ay * by;
  const signedCurrent = Math.atan2(cross, dot);
  const mag = Math.abs(target);
  return signedCurrent < 0 ? -mag : mag;
}

/** Local helper duplicating cad-sketch-editor's pointsControlledBy. Kept
 * here so the solver doesn't reach into a component module. */
function pointIdsControlledBy(e: SketchEntity): string[] {
  switch (e.kind) {
    case 'point':  return [e.id];
    case 'line':   return [e.startId, e.endId];
    case 'circle': return [e.centerId];
    case 'arc':    return [e.centerId, e.startId, e.endId];
    case 'ellipse': return [e.centerId, e.majorAxisEndId];
    case 'spline': return [...e.controlPointIds];
    default: return [];
  }
}
