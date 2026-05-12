import type { Feature, FeatureTree, OriginFeature, ExtrudeFeature, RegenerateResult, SketchDocument, Plane3, FaceMesh, ModelTopology } from './types';
import { buildOriginDatums } from './datum';

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

export type KernelAdapter = {
  buildOriginGeometry(): RegenerateResult['geometry'];
  buildExtrude(profile2D: Array<{ x: number; y: number }>, plane: Plane3, distance: number): {
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
    if (feature.type === 'extrude') {
      const sketch = doc.sketches[feature.sketchId];
      if (!sketch) {
        acc.errors.push(`Extrude feature ${feature.id}: sketch ${feature.sketchId} not found`);
        continue;
      }
      try {
        // Profile extraction is the caller's responsibility (regenerator focuses on building).
        // For now: derive a profile from the sketch's line endpoints in their stored order.
        const profile2D = sketch.state.lines.map(l => {
          const p = sketch.state.points.find(pt => pt.id === l.startId);
          return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
        });
        if (profile2D.length < 3) {
          acc.errors.push(`Extrude feature ${feature.id}: profile has fewer than 3 segments`);
          continue;
        }
        const out = kernel.buildExtrude(profile2D, sketch.plane, feature.distance);
        acc.geometry.faces.push(...out.faces);
        acc.geometry.topology.vertices.push(...out.topology.vertices);
        acc.geometry.topology.edges.push(...out.topology.edges);
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
