import type { SketchState, SketchConstraint, ConstraintType, SketchPoint, SketchLine } from './types';

let _seq = 0;
function nextId(prefix: string): string {
  return `${prefix}${++_seq}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

function findPoint(state: SketchState, id: string): SketchPoint | undefined {
  return state.points.find(p => p.id === id);
}
function findLine(state: SketchState, id: string): SketchLine | undefined {
  return state.lines.find(l => l.id === id);
}
function isReference(state: SketchState, id: string): boolean {
  const p = findPoint(state, id); if (p?.reference) return true;
  const l = findLine(state, id); if (l?.reference) return true;
  return false;
}

export function emptySketchState(): SketchState {
  return { points: [], lines: [], constraints: [] };
}

export function addPoint(state: SketchState, x: number, y: number): { state: SketchState; id: string } {
  const id = nextId('p');
  return {
    state: { ...state, points: [...state.points, { id, x, y }] },
    id,
  };
}

export function addLine(state: SketchState, startId: string, endId: string): { state: SketchState; id: string } {
  const id = nextId('l');
  return {
    state: { ...state, lines: [...state.lines, { id, startId, endId }] },
    id,
  };
}

export function movePoint(state: SketchState, id: string, x: number, y: number): SketchState {
  const p = findPoint(state, id);
  if (!p || p.reference) return state;
  return {
    ...state,
    points: state.points.map(pt => pt.id === id ? { ...pt, x, y } : pt),
  };
}

export function deletePrimitive(state: SketchState, id: string): SketchState {
  if (isReference(state, id)) return state;
  // Iteratively cascade. A line depends on its endpoints; a constraint depends on any target.
  const toDelete = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of state.lines) {
      if (toDelete.has(l.id)) continue;
      if (toDelete.has(l.startId) || toDelete.has(l.endId)) {
        toDelete.add(l.id);
        changed = true;
      }
    }
  }
  return {
    points: state.points.filter(p => !toDelete.has(p.id)),
    lines: state.lines.filter(l => !toDelete.has(l.id)),
    constraints: state.constraints.filter(c => !c.targets.some(t => toDelete.has(t))),
  };
}

export function addConstraint(
  state: SketchState,
  type: ConstraintType,
  targets: string[],
  value?: number,
): { state: SketchState; constraint: SketchConstraint } {
  const constraint: SketchConstraint = { id: nextId('c'), type, targets };
  if (value !== undefined) constraint.value = value;
  return {
    state: { ...state, constraints: [...state.constraints, constraint] },
    constraint,
  };
}

export function setDistanceValue(state: SketchState, constraintId: string, value: number): SketchState {
  return {
    ...state,
    constraints: state.constraints.map(c => {
      if (c.id !== constraintId) return c;
      if (c.type !== 'distance') return c;
      return { ...c, value };
    }),
  };
}
