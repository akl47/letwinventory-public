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

// REQ 608 cascade: drops every sketch-hosted feature whose sketchId (or
// profileSketchId/pathSketchId for Sweep variants) matches. Origin
// features and any future features without a sketch ref are unaffected.
export function removeFeaturesReferencingSketch(tree: FeatureTree, sketchId: string): FeatureTree {
  return {
    features: tree.features.filter(f => {
      if (f.type === 'extrude' || f.type === 'cutExtrude' || f.type === 'revolve' || f.type === 'cutRevolve') {
        return f.sketchId !== sketchId;
      }
      if (f.type === 'sweep' || f.type === 'cutSweep') {
        return f.profileSketchId !== sketchId && f.pathSketchId !== sketchId;
      }
      return true;
    }),
    nextFeatureSeq: tree.nextFeatureSeq,
  };
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
