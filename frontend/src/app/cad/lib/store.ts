import type {
  SketchState, SketchEntity, SketchConstraint, ConstraintType,
  ConstraintTarget, PointEntity, LineEntity,
} from './types';
import { findEntity } from './types';

let _seq = 0;
function nextId(prefix: string): string {
  return `${prefix}${++_seq}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

function isConstructionEntity(state: SketchState, id: string): boolean {
  return !!findEntity(state, id)?.construction;
}

function toTargets(input: Array<string | ConstraintTarget>): ConstraintTarget[] {
  return input.map(t => typeof t === 'string' ? { entityId: t } : t);
}

export function emptySketchState(): SketchState {
  return { entities: [], constraints: [] };
}

export function addPoint(state: SketchState, x: number, y: number): { state: SketchState; id: string } {
  const id = nextId('p');
  const e: PointEntity = { kind: 'point', id, x, y };
  return { state: { ...state, entities: [...state.entities, e] }, id };
}

export function addLine(state: SketchState, startId: string, endId: string): { state: SketchState; id: string } {
  const id = nextId('l');
  const e: LineEntity = { kind: 'line', id, startId, endId };
  return { state: { ...state, entities: [...state.entities, e] }, id };
}

export function movePoint(state: SketchState, id: string, x: number, y: number): SketchState {
  const e = findEntity(state, id);
  if (!e || e.kind !== 'point' || e.construction) return state;
  return {
    ...state,
    entities: state.entities.map(ent =>
      ent.id === id && ent.kind === 'point' ? { ...ent, x, y } : ent,
    ),
  };
}

export function deletePrimitive(state: SketchState, id: string): SketchState {
  if (isConstructionEntity(state, id)) return state;
  const toDelete = new Set<string>([id]);
  // Iteratively cascade: any entity referencing a deleted id by structural field
  // (line endpoints, circle/arc center, spline control points, etc.) is also deleted.
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of state.entities) {
      if (toDelete.has(e.id)) continue;
      let depends = false;
      switch (e.kind) {
        case 'line':
          depends = toDelete.has(e.startId) || toDelete.has(e.endId);
          break;
        case 'circle':
          depends = toDelete.has(e.centerId);
          break;
        case 'arc':
          depends = toDelete.has(e.centerId) || toDelete.has(e.startId) || toDelete.has(e.endId);
          break;
        case 'ellipse':
          depends = toDelete.has(e.centerId) || toDelete.has(e.majorAxisEndId);
          break;
        case 'ellipticalArc':
          depends = toDelete.has(e.centerId) || toDelete.has(e.majorAxisEndId);
          break;
        case 'spline':
          depends = e.controlPointIds.some(cp => toDelete.has(cp));
          break;
      }
      if (depends) {
        toDelete.add(e.id);
        changed = true;
      }
    }
  }
  return {
    entities: state.entities.filter(e => !toDelete.has(e.id)),
    constraints: state.constraints.filter(c => !c.targets.some(t => toDelete.has(t.entityId))),
  };
}

export function addConstraint(
  state: SketchState,
  type: ConstraintType,
  targets: Array<string | ConstraintTarget>,
  value?: number,
): { state: SketchState; constraint: SketchConstraint } {
  const constraint: SketchConstraint = {
    id: nextId('c'),
    type,
    targets: toTargets(targets),
  };
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

