import type {
  SketchState, SketchEntity, ConstraintType, PointEntity, LineEntity, CircleEntity, ArcEntity,
} from './types';
import { findPoint, findEntity } from './types';

// ────────────────────────────────────────────────────────────────────────────
// Mini constraint badges that hover next to a selected sketch entity,
// SolidWorks-style. One badge per geometric constraint that touches the
// entity (directly OR via a point the entity controls). Clicking a badge
// removes that constraint.
//
// Dimensional constraints (distance / radius / angle / etc.) are NOT
// rendered here — they already display as full dimension labels with
// extension lines elsewhere in the overlay.
// ────────────────────────────────────────────────────────────────────────────

export interface ConstraintIcon {
  constraintId: string;
  constraintType: ConstraintType;
  /** Short symbol shown on the badge. */
  symbol: string;
  /** Human-readable name for the tooltip. */
  label: string;
}

/** All badges for one selected entity, anchored at a single 2D sketch
 * point. The renderer builds ONE flex container at this anchor and lays
 * the badges out as siblings — that way spacing is fixed in screen pixels
 * (via CSS gap) and doesn't drift apart or overlap as the user zooms. */
export interface ConstraintIconGroup {
  anchor: { x: number; y: number };
  icons: ConstraintIcon[];
}

const SYMBOL: Partial<Record<ConstraintType, { symbol: string; label: string }>> = {
  // `coincident` covers point-point, point-on-line, AND point-on-curve.
  // One symbol so the badge stays consistent regardless of target kinds.
  coincident:        { symbol: '●', label: 'Coincident' },
  fixed:             { symbol: 'L', label: 'Fixed' },
  horizontal:        { symbol: 'H', label: 'Horizontal' },
  vertical:          { symbol: 'V', label: 'Vertical' },
  perpendicular:     { symbol: '⊥', label: 'Perpendicular' },
  parallel:          { symbol: '∥', label: 'Parallel' },
  tangent:           { symbol: '∽', label: 'Tangent' },
  equal:             { symbol: '=', label: 'Equal' },
  symmetric:         { symbol: '↔', label: 'Symmetric' },
  midpoint:          { symbol: 'M', label: 'Midpoint' },
  concentric:        { symbol: '◎', label: 'Concentric' },
  coradial:          { symbol: '⊙', label: 'Coradial' },
  collinear:         { symbol: '≡', label: 'Collinear' },
};

/** Sketch-unit offset from the entity to the badge cluster's anchor. */
const ICON_OFFSET = 6;

/**
 * Returns one ConstraintIconGroup for the selected entity — a single
 * anchor point in sketch-local coords plus the list of badges that should
 * render there. The viewer renders these as a single flex container so
 * spacing between badges stays fixed in CSS pixels (no overlap or drift
 * as the user zooms).
 *
 * Returns null when there's nothing to show.
 */
export function constraintIconsForEntity(state: SketchState, entityId: string): ConstraintIconGroup | null {
  const entity = findEntity(state, entityId);
  if (!entity) return null;

  const controlled = new Set<string>([entity.id, ...pointsControlledBy(entity)]);
  const seen = new Set<string>();
  const applicable = state.constraints.filter(c => {
    if (seen.has(c.id)) return false;
    if (!SYMBOL[c.type]) return false;
    if (c.targets.some(t => controlled.has(t.entityId))) {
      seen.add(c.id);
      return true;
    }
    return false;
  });
  if (applicable.length === 0) return null;

  const icons: ConstraintIcon[] = applicable.map(c => {
    const sym = SYMBOL[c.type]!;
    return { constraintId: c.id, constraintType: c.type, symbol: sym.symbol, label: sym.label };
  });
  return { anchor: anchorForEntity(state, entity), icons };
}

/** A single sketch-local anchor for the badge cluster — offset slightly
 * away from the entity itself so the badges don't overlap the geometry. */
function anchorForEntity(state: SketchState, e: SketchEntity): { x: number; y: number } {
  if (e.kind === 'point') {
    return { x: e.x + ICON_OFFSET, y: e.y + ICON_OFFSET };
  }
  if (e.kind === 'line') {
    const a = findPoint(state, (e as LineEntity).startId);
    const b = findPoint(state, (e as LineEntity).endId);
    if (!a || !b) return { x: 0, y: 0 };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return mid;
    // Perpendicular offset (CCW from line direction) by ICON_OFFSET.
    return { x: mid.x - (dy / len) * ICON_OFFSET, y: mid.y + (dx / len) * ICON_OFFSET };
  }
  if (e.kind === 'circle' || e.kind === 'arc') {
    const ce = findPoint(state, (e as CircleEntity | ArcEntity).centerId);
    if (!ce) return { x: 0, y: 0 };
    return { x: ce.x, y: ce.y + (e as CircleEntity | ArcEntity).radius + ICON_OFFSET };
  }
  return { x: 0, y: 0 };
}

/** Local helper duplicating cad-sketch-editor's pointsControlledBy so this
 * module has zero deps on the component layer. */
function pointsControlledBy(e: SketchEntity): string[] {
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
