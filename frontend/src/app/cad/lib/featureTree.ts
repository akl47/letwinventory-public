import type {
  Feature, FeatureTree, OriginFeature, ExtrudeFeature, CutExtrudeFeature,
  RevolveFeature, CutRevolveFeature, SweepFeature, CutSweepFeature,
} from './types';
import { newFeatureId } from './ids';
// Phase 1: regenerateModel + the KernelAdapter interface used to live here
// and ran in the browser. Both moved server-side. The server handles regen
// via `backend/services/cadRegenService.js`; this module is now just the
// feature-tree pure-data operations.

// Distributive Omit so each branch of the Feature union retains its own
// discriminator: { type: 'origin' } | { type: 'extrude'; sketchId; distance }.
type FeatureInput = Feature extends infer T ? T extends Feature ? Omit<T, 'id'> : never : never;

export function defaultDatumVisibility(): Record<string, boolean> {
  return {
    origin: true,
    x_axis: true, y_axis: true, z_axis: true,
    xy_plane: true, yz_plane: true, xz_plane: true,
  };
}

export function emptyFeatureTree(): FeatureTree {
  const origin: OriginFeature = { id: 'f1', type: 'origin', visibility: defaultDatumVisibility() };
  return { features: [origin], nextFeatureSeq: 2 };
}

export function addFeature(tree: FeatureTree, feature: FeatureInput): FeatureTree {
  // Globally-unique id (see ids.ts) — sequential ids collide across branches.
  // nextFeatureSeq is still advanced (legacy counter; some UI gating reads it).
  const id = newFeatureId();
  // Unified creation timestamp — same source/scale as Sketch.createdAt
  // so the feature tree can interleave orphan sketches by chronological
  // order. New features land at the end of the tree, so the tail of
  // features.map(f => f.createdAt) is always non-decreasing.
  const partial = { ...feature, id, createdAt: Date.now() } as Feature;
  // SolidWorks-style default name: "<Kind> N" where N is the next
  // sequence number for THIS kind in the tree. The user can rename via
  // the tree's right-click menu; we only fill in when no explicit name
  // was supplied, so renames stick across edits.
  const next: Feature = (partial as { name?: string }).name
    ? partial
    : { ...partial, name: defaultFeatureName(tree, partial) } as Feature;
  return {
    features: [...tree.features, next],
    nextFeatureSeq: tree.nextFeatureSeq + 1,
  };
}

/** Produce a human-readable default name for a newly-created feature.
 * Mirrors SolidWorks: "Extrude 1", "Extrude 2", "Cut-Extrude 1",
 * "Revolve 1", etc. Indexing counts existing features of the same kind
 * already in the tree (renames don't shift later indices because the
 * count includes renamed entries too — we're just looking at type). */
function defaultFeatureName(tree: FeatureTree, feature: Feature): string | undefined {
  const label = featureKindLabel(feature.type);
  if (!label) return undefined;
  const existing = tree.features.filter(f => f.type === feature.type).length;
  return `${label} ${existing + 1}`;
}

function featureKindLabel(kind: Feature['type']): string | null {
  switch (kind) {
    case 'extrude':    return 'Extrude';
    case 'cutExtrude': return 'Cut-Extrude';
    case 'revolve':    return 'Revolve';
    case 'cutRevolve': return 'Cut-Revolve';
    case 'sweep':      return 'Sweep';
    case 'cutSweep':   return 'Cut-Sweep';
    case 'loft':       return 'Loft';
    case 'fillet':     return 'Fillet';
    case 'chamfer':    return 'Chamfer';
    case 'datumPlane': return 'Plane';
    case 'mirror':           return 'Mirror';
    case 'linearPattern':    return 'Linear Pattern';
    case 'circularPattern':  return 'Circular Pattern';
    case 'shell':            return 'Shell';
    case 'datumAxis':        return 'Axis';
    case 'datumPoint':       return 'Point';
    case 'combine':          return 'Combine';
    case 'hole':             return 'Hole';
    case 'mirrorBody':       return 'Mirror Body';
    case 'moveCopyBody':     return 'Move/Copy Body';
    case 'origin':     return null;  // origin gets no default name
  }
}

export function removeFeature(tree: FeatureTree, id: string): FeatureTree {
  if (!tree.features.some(f => f.id === id)) return tree;
  return {
    features: tree.features.filter(f => f.id !== id),
    nextFeatureSeq: tree.nextFeatureSeq,
  };
}

export function updateFeatureParam<T extends Feature>(
  tree: FeatureTree, id: string, patch: Partial<T>,
): FeatureTree {
  return {
    features: tree.features.map(f => f.id === id ? ({ ...f, ...patch } as Feature) : f),
    nextFeatureSeq: tree.nextFeatureSeq,
  };
}

// REQ 608: single source of truth for "does this feature consume this
// sketch?" — used by both the deletion cascade below and the editor's
// pre-delete dependent scan so the two can never disagree on a kind.
export function featureReferencesSketch(f: Feature, sketchId: string): boolean {
  switch (f.type) {
    case 'extrude': case 'cutExtrude': case 'revolve': case 'cutRevolve':
      return f.sketchId === sketchId;
    case 'sweep': case 'cutSweep':
      return f.profileSketchId === sketchId || f.pathSketchId === sketchId;
    case 'loft':
      return f.sketchIds.includes(sketchId);
    default:
      return false;
  }
}

// REQ 608 cascade: drops every sketch-hosted feature that references the
// sketch (extrude/revolve variants, sweep profile OR path, loft profiles).
// Origin features and any future features without a sketch ref are unaffected.
export function removeFeaturesReferencingSketch(tree: FeatureTree, sketchId: string): FeatureTree {
  return {
    features: tree.features.filter(f => !featureReferencesSketch(f, sketchId)),
    nextFeatureSeq: tree.nextFeatureSeq,
  };
}

/** Datum feature kinds — their `visible` flag is render-only (they produce no
 * solid geometry), unlike solid features where hiding was regen-affecting. */
const DATUM_KINDS = new Set(['datumPlane', 'datumAxis', 'datumPoint']);

/** REQ 610: upgrade a loaded document in memory — legacy `visible: false` on a
 * SOLID feature becomes `suppressed: true` (hide-that-skips-regen is dead;
 * suppression is the explicit mechanism). Datum kinds keep `visible` as their
 * render-only toggle. Returns the same object when nothing needs upgrading so
 * callers can cheaply detect no-ops. */
export function upgradeFeatureTree(tree: FeatureTree): FeatureTree {
  let changed = false;
  const features = tree.features.map(f => {
    if (f.type === 'origin' || DATUM_KINDS.has(f.type)) return f;
    if ((f as { visible?: boolean }).visible !== false) return f;
    changed = true;
    const next = { ...f, suppressed: true } as Feature;
    delete (next as { visible?: boolean }).visible;
    return next;
  });
  return changed ? { ...tree, features } : tree;
}

/** REQ 745: per-body render visibility on the featureTree blob. Visible is
 * the default, so setting true removes the key (keeps the map minimal). */
export function setBodyVisibility(tree: FeatureTree, bodyId: string, visible: boolean): FeatureTree {
  const map = { ...(tree.bodyVisibility ?? {}) };
  if (visible) delete map[bodyId];
  else map[bodyId] = false;
  const next = { ...tree };
  if (Object.keys(map).length) next.bodyVisibility = map;
  else delete next.bodyVisibility;
  return next;
}

/** REQ 857: user body names. Empty/whitespace clears back to the default label. */
export function setBodyName(tree: FeatureTree, bodyId: string, name: string): FeatureTree {
  const trimmed = name.trim();
  const map = { ...(tree.bodyNames ?? {}) };
  if (trimmed) map[bodyId] = trimmed;
  else delete map[bodyId];
  const next = { ...tree };
  if (Object.keys(map).length) next.bodyNames = map;
  else delete next.bodyNames;
  return next;
}

/** REQ 858: persisted rollback-bar position. null clears (fully rolled forward). */
export function setRollbackIndex(tree: FeatureTree, index: number | null): FeatureTree {
  const next = { ...tree };
  if (index === null) delete next.rollbackIndex;
  else next.rollbackIndex = index;
  return next;
}

export function isOriginFeature(f: Feature): f is OriginFeature { return f.type === 'origin'; }
export function isExtrudeFeature(f: Feature): f is ExtrudeFeature { return f.type === 'extrude'; }
export function isCutExtrudeFeature(f: Feature): f is CutExtrudeFeature { return f.type === 'cutExtrude'; }
export function isRevolveFeature(f: Feature): f is RevolveFeature { return f.type === 'revolve'; }
export function isCutRevolveFeature(f: Feature): f is CutRevolveFeature { return f.type === 'cutRevolve'; }
export function isSweepFeature(f: Feature): f is SweepFeature { return f.type === 'sweep'; }
export function isCutSweepFeature(f: Feature): f is CutSweepFeature { return f.type === 'cutSweep'; }
/** Any sketch-hosted feature — useful for code paths that treat them
 * the same (e.g. sketch-deletion cascade, "is this feature sketch-
 * based?" checks). Note: Sweep variants reference TWO sketches. */
export function isAnyExtrudeFeature(
  f: Feature,
): f is ExtrudeFeature | CutExtrudeFeature | RevolveFeature | CutRevolveFeature | SweepFeature | CutSweepFeature {
  return f.type === 'extrude' || f.type === 'cutExtrude'
    || f.type === 'revolve' || f.type === 'cutRevolve'
    || f.type === 'sweep' || f.type === 'cutSweep';
}
