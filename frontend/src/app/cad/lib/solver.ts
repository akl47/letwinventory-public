import { make_gcs_wrapper, SolveStatus, Algorithm, type GcsWrapper } from '../vendor/planegcs';
import type { SketchPrimitive, SketchParam } from '../vendor/planegcs';
import type {
  SketchState, SketchConstraint, SketchEntity, CircleEntity, ArcEntity,
} from './types';
import { pointsOf, linesOf, findEntity, findPoint } from './types';

export type SolveStatus_ = 'ok' | 'inconsistent';

export interface SolveResult {
  status: SolveStatus_;
  state: SketchState;
  dof: number;
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
  if (!wrapperPromise) wrapperPromise = make_gcs_wrapper(wasmPathForRuntime());
  return wrapperPromise;
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

function translateConstraint(state: SketchState, c: SketchConstraint): SketchPrimitive[] {
  const tid = (i: number) => c.targets[i].entityId;
  const at = (i: number) => findEntity(state, tid(i));
  switch (c.type) {
    case 'fixed':
      // Handled at the point level (push as { fixed: true }). No PlaneGCS constraint.
      return [];
    case 'coincident':
      return [{ id: c.id, type: 'p2p_coincident', p1_id: tid(0), p2_id: tid(1) }];
    case 'horizontal':
      return [{ id: c.id, type: 'horizontal_l', l_id: tid(0) }];
    case 'vertical':
      return [{ id: c.id, type: 'vertical_l', l_id: tid(0) }];
    case 'distance':
      return [{ id: c.id, type: 'p2p_distance', p1_id: tid(0), p2_id: tid(1), distance: c.value ?? 0 }];
    case 'point-on-line':
      return [{ id: c.id, type: 'point_on_line_pl', p_id: tid(0), l_id: tid(1) }];
    case 'perpendicular':
      return [{ id: c.id, type: 'perpendicular_ll', l1_id: tid(0), l2_id: tid(1) }];
    case 'parallel':
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
    case 'collinear': {
      // Targets: [lineA, lineB]. Synthesized: parallel + a point of A lies on B.
      const a = at(0), b = at(1);
      if (!a || !b || a.kind !== 'line' || b.kind !== 'line') return [];
      return [
        { id: `${c.id}-par`, type: 'parallel', l1_id: a.id, l2_id: b.id },
        { id: `${c.id}-onl`, type: 'point_on_line_pl', p_id: a.startId, l_id: b.id },
      ];
    }
  }
}

function circlesOf(state: SketchState): CircleEntity[] {
  return state.entities.filter((e): e is CircleEntity => e.kind === 'circle');
}

function arcsOf(state: SketchState): ArcEntity[] {
  return state.entities.filter((e): e is ArcEntity => e.kind === 'arc');
}

function buildPrimitives(state: SketchState): { primitives: (SketchPrimitive | SketchParam)[]; fixedIds: Set<string> } {
  const primitives: (SketchPrimitive | SketchParam)[] = [];
  const fixedIds = new Set<string>();

  // Construction entities are pinned (REQ 560) — same semantics as PlaneGCS `fixed`.
  // Also collect any point referenced by a `fixed` constraint.
  for (const c of state.constraints) {
    if (c.type === 'fixed') fixedIds.add(c.targets[0].entityId);
  }
  for (const p of pointsOf(state)) {
    if (p.construction) fixedIds.add(p.id);
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
    // Construction circles are reference geometry — pin their radius so the
    // solver doesn't redistribute constraint error into the dimension.
    if (c.construction) {
      primitives.push({ id: `radlock-${c.id}`, type: 'circle_radius', c_id: c.id, radius: c.radius });
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
    if (a.construction) {
      primitives.push({ id: `radlock-${a.id}`, type: 'arc_radius', a_id: a.id, radius: a.radius });
    }
  }
  for (const c of state.constraints) {
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

export async function solveSketch(state: SketchState, _gcs?: GcsModule): Promise<SolveResult> {
  void _gcs;
  if (state.entities.length === 0) {
    return { status: 'ok', state, dof: 0 };
  }

  const wrapper = await getWrapper();
  wrapper.clear_data();

  const { primitives } = buildPrimitives(state);
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

  wrapper.clear_data();
  return { status: 'inconsistent', state, dof };
}
