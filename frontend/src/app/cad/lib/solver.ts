import { make_gcs_wrapper, SolveStatus, Algorithm, type GcsWrapper } from '../vendor/planegcs';
import type { SketchPrimitive, SketchParam } from '../vendor/planegcs';
import type { SketchState, SketchConstraint } from './types';
import { pointsOf, linesOf } from './types';

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

function translateConstraint(c: SketchConstraint): SketchPrimitive | null {
  const tid = (i: number) => c.targets[i].entityId;
  switch (c.type) {
    case 'fixed':
      // Handled at the point level (push as { fixed: true }). No PlaneGCS constraint.
      return null;
    case 'coincident':
      return { id: c.id, type: 'p2p_coincident', p1_id: tid(0), p2_id: tid(1) };
    case 'horizontal':
      return { id: c.id, type: 'horizontal_l', l_id: tid(0) };
    case 'vertical':
      return { id: c.id, type: 'vertical_l', l_id: tid(0) };
    case 'distance':
      return { id: c.id, type: 'p2p_distance', p1_id: tid(0), p2_id: tid(1), distance: c.value ?? 0 };
    case 'point-on-line':
      return { id: c.id, type: 'point_on_line_pl', p_id: tid(0), l_id: tid(1) };
  }
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
  for (const c of state.constraints) {
    const t = translateConstraint(c);
    if (t) primitives.push(t);
  }
  return { primitives, fixedIds };
}

function readBack(state: SketchState, wrapper: GcsWrapper): SketchState {
  return {
    ...state,
    entities: state.entities.map(e => {
      if (e.kind !== 'point') return e;
      const solved = wrapper.sketch_index.get_primitive(e.id);
      if (!solved || solved.type !== 'point') return e;
      return { ...e, x: solved.x, y: solved.y };
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
