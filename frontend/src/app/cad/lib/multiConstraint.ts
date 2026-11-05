// REQ 990 — SolidWorks-style multi-select relations: one click on a
// constraint applies it to the whole selection. One-entity constraints are
// added per entity; relational ones chain every entity to the FIRST pick.
// Returns the target-id groups to add (already-present ones skipped), or null
// when the selection isn't a multi-select case for this constraint.

import type { ConstraintType, SketchEntity, SketchState } from './types';

const isLine = (e: SketchEntity) => e.kind === 'line';
const isPoint = (e: SketchEntity) => e.kind === 'point';
const isRound = (e: SketchEntity) => e.kind === 'circle' || e.kind === 'arc';
const all = (es: SketchEntity[], f: (e: SketchEntity) => boolean) => es.every(f);

function shape(type: ConstraintType, es: SketchEntity[]): 'each' | 'chain' | null {
  switch (type) {
    case 'fixed':
      return all(es, isPoint) ? 'each' : null;
    case 'horizontal':
    case 'vertical':
      if (all(es, isLine)) return 'each';
      return all(es, isPoint) ? 'chain' : null;
    case 'equal':
      return all(es, isLine) || all(es, isRound) ? 'chain' : null;
    case 'parallel':
    case 'collinear':
      return all(es, isLine) ? 'chain' : null;
    case 'concentric':
    case 'coradial':
      return all(es, isRound) ? 'chain' : null;
    case 'coincident':
    case 'horizontal-distance': // Equal X (value 0)
    case 'vertical-distance':   // Equal Y (value 0)
      return all(es, isPoint) ? 'chain' : null;
    default:
      return null;
  }
}

export function multiConstraintGroups(
  state: SketchState, type: ConstraintType, entities: SketchEntity[],
): string[][] | null {
  if (entities.length < 2) return null;
  const how = shape(type, entities);
  if (!how) return null;
  const ids = entities.map(e => e.id);
  const groups = how === 'each' ? ids.map(id => [id]) : ids.slice(1).map(id => [ids[0], id]);
  const key = (g: string[]) => [...g].sort().join('|');
  const existing = new Set(state.constraints
    .filter(c => c.type === type && !c.externalRef && (c.value === undefined || c.value === 0))
    .map(c => key(c.targets.map(t => t.entityId))));
  return groups.filter(g => !existing.has(key(g)));
}
