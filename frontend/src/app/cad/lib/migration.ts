import type {
  SketchState, SketchEntity, SketchConstraint, ConstraintType,
  SketchDocument, Sketch,
} from './types';

// ──────────────────────────────────────────────────────────────────────────
// Legacy schema (pre-entity-model). Kept here as a self-contained type so the
// rest of the codebase can move on. Loader/migration code is the only consumer.
// REQ 565: schema migration on load.
// ──────────────────────────────────────────────────────────────────────────

export interface LegacyPoint {
  id: string;
  x: number;
  y: number;
  reference?: boolean;
}

export interface LegacyLine {
  id: string;
  startId: string;
  endId: string;
  reference?: boolean;
}

export interface LegacyConstraint {
  id: string;
  type: ConstraintType;
  targets: string[];
  value?: number;
}

export interface LegacySketchState {
  points: LegacyPoint[];
  lines: LegacyLine[];
  constraints: LegacyConstraint[];
}

export function isLegacySketchState(state: unknown): state is LegacySketchState {
  if (!state || typeof state !== 'object') return false;
  const s = state as Record<string, unknown>;
  return Array.isArray(s['points']) && Array.isArray(s['lines']) && !Array.isArray(s['entities']);
}

export function migrateSketchState(state: LegacySketchState | SketchState): SketchState {
  if (!isLegacySketchState(state)) return state as SketchState;

  const entities: SketchEntity[] = [];
  for (const p of state.points) {
    const e: SketchEntity = { kind: 'point', id: p.id, x: p.x, y: p.y };
    if (p.reference) e.construction = true;
    entities.push(e);
  }
  for (const l of state.lines) {
    const e: SketchEntity = { kind: 'line', id: l.id, startId: l.startId, endId: l.endId };
    if (l.reference) e.construction = true;
    entities.push(e);
  }

  const constraints: SketchConstraint[] = state.constraints.map(c => {
    const next: SketchConstraint = {
      id: c.id,
      type: c.type,
      targets: c.targets.map(t => ({ entityId: t })),
    };
    if (c.value !== undefined) next.value = c.value;
    return next;
  });

  return { entities, constraints };
}

export function migrateSketchDocument(doc: SketchDocument): SketchDocument {
  const sketches: Record<string, Sketch> = {};
  for (const [id, s] of Object.entries(doc.sketches)) {
    sketches[id] = { ...s, state: migrateSketchState(s.state as LegacySketchState | SketchState) };
  }
  return { ...doc, sketches };
}
