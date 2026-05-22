import type { Feature, FeatureTree, OriginFeature, ExtrudeFeature, CutExtrudeFeature, RevolveFeature } from './types';
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
  const id = `f${tree.nextFeatureSeq}`;
  const next = { ...feature, id } as Feature;
  return {
    features: [...tree.features, next],
    nextFeatureSeq: tree.nextFeatureSeq + 1,
  };
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

// REQ 608 cascade: drops every Extrude / CutExtrude / Revolve feature whose
// sketchId matches. Origin features (and any future features without a
// sketchId) are unaffected.
export function removeFeaturesReferencingSketch(tree: FeatureTree, sketchId: string): FeatureTree {
  return {
    features: tree.features.filter(f => {
      if (f.type === 'extrude' || f.type === 'cutExtrude' || f.type === 'revolve') {
        return f.sketchId !== sketchId;
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
/** Any sketch-hosted feature — useful for code paths that treat them
 * the same (e.g. sketch-deletion cascade, "is this feature sketch-
 * based?" checks). */
export function isAnyExtrudeFeature(f: Feature): f is ExtrudeFeature | CutExtrudeFeature | RevolveFeature {
  return f.type === 'extrude' || f.type === 'cutExtrude' || f.type === 'revolve';
}
