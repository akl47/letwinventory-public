import type { Feature, FeatureTree, OriginFeature, ExtrudeFeature, RegenerateResult, SketchDocument, Plane3, FaceMesh, ModelTopology } from './types';
import { buildOriginDatums } from './datum';
import { extractClosedLoops, type ProfileLoop } from './profile';

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

// REQ 608 cascade: drops every Extrude feature whose sketchId matches.
// Origin features (and any future features without a sketchId) are unaffected.
export function removeFeaturesReferencingSketch(tree: FeatureTree, sketchId: string): FeatureTree {
  return {
    features: tree.features.filter(f => !(f.type === 'extrude' && f.sketchId === sketchId)),
    nextFeatureSeq: tree.nextFeatureSeq,
  };
}

export type KernelAdapter = {
  buildOriginGeometry(): RegenerateResult['geometry'];
  // REQ 617: the loop is a list of typed profile edges (line/arc/circle), not
  // a flat tessellated polyline. Pure-JS kernel produces one face per edge so
  // a single-circle profile yields three faces (top cap, bottom cap, lateral).
  buildExtrude(loop: ProfileLoop, plane: Plane3, distance: number): {
    faces: FaceMesh[];
    topology: ModelTopology;
  };
};

export async function regenerateModel(
  kernel: KernelAdapter,
  tree: FeatureTree,
  doc: SketchDocument,
): Promise<RegenerateResult> {
  // Seed with the origin feature's geometry (datums only).
  const acc: RegenerateResult = {
    geometry: { datums: buildOriginDatums(), faces: [], topology: { vertices: [], edges: [] } },
    errors: [],
  };

  for (const feature of tree.features) {
    if (feature.type === 'origin') continue;
    // REQ 610: features with visible === false are silently skipped (not an error).
    if (feature.visible === false) continue;
    if (feature.type === 'extrude') {
      const sketch = doc.sketches[feature.sketchId];
      if (!sketch) {
        acc.errors.push(`Extrude feature ${feature.id}: sketch ${feature.sketchId} not found`);
        continue;
      }
      try {
        // REQ 620 — sketch can contain multiple disjoint closed loops; the
        // feature picks which (default: first loop only for backwards compat).
        const { loops, errors: extractErrors } = extractClosedLoops(sketch.state);
        for (const err of extractErrors) acc.errors.push(`Extrude feature ${feature.id}: ${err}`);
        if (loops.length === 0) {
          acc.errors.push(`Extrude feature ${feature.id}: no closed loops in sketch`);
          continue;
        }
        const indices = feature.loopIndices ?? [0];
        const signedDistance = feature.flipped ? -feature.distance : feature.distance;
        for (const li of indices) {
          if (li < 0 || li >= loops.length) {
            acc.errors.push(`Extrude feature ${feature.id}: loop index ${li} out of range (have ${loops.length})`);
            continue;
          }
          const out = kernel.buildExtrude(loops[li], sketch.plane, signedDistance);
          // REQ 623: tag each face with its owning feature so 3D pick can
          // resolve clicks to features.
          for (const face of out.faces) face.featureId = feature.id;
          acc.geometry.faces.push(...out.faces);
          acc.geometry.topology.vertices.push(...out.topology.vertices);
          acc.geometry.topology.edges.push(...out.topology.edges);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        acc.errors.push(`Extrude feature ${feature.id}: ${msg}`);
      }
    }
  }

  return acc;
}

export function isOriginFeature(f: Feature): f is OriginFeature { return f.type === 'origin'; }
export function isExtrudeFeature(f: Feature): f is ExtrudeFeature { return f.type === 'extrude'; }
