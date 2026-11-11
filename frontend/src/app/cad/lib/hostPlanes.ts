import type { FeatureTree, Plane3, SketchDocument, SketchId } from './types';

/** REQ 1052 — adopt the planes regeneration reports for face-hosted sketches
 * whose host face moved: each sketch takes its new plane, and every hole
 * placement on one of its points moves to where that point now is. Returns
 * the inputs unchanged (same references) when nothing moves. `skip` leaves a
 * sketch alone (the one being edited). */
export function adoptHostPlanes(
  doc: SketchDocument, tree: FeatureTree, planes: Record<SketchId, Plane3>, skip?: SketchId | null,
): { doc: SketchDocument; tree: FeatureTree } {
  const moved = Object.entries(planes || {}).filter(([sid]) => sid !== skip && doc.sketches[sid]);
  if (moved.length === 0) return { doc, tree };
  const sketches = { ...doc.sketches };
  for (const [sid, plane] of moved) sketches[sid] = { ...sketches[sid], plane };
  const nextDoc = { ...doc, sketches };

  let treeChanged = false;
  const features = tree.features.map(f => {
    if (f.type !== 'hole') return f;
    let changed = false;
    const placements = f.placements.map(p => {
      const ref = sketchPointOf(p.faceId);
      if (!ref || !planes[ref.sketchId] || ref.sketchId === skip) return p;
      const sk = sketches[ref.sketchId];
      const pt = sk?.state.entities.find(e => e.id === ref.pointId);
      if (!pt || pt.kind !== 'point') return p;
      const { origin: o, xAxis: x, yAxis: y } = sk.plane;
      const position: [number, number, number] = [0, 1, 2].map(i => o[i] + pt.x * x[i] + pt.y * y[i]) as [number, number, number];
      changed = true;
      return { ...p, position, faceCentroid: position };
    });
    if (!changed) return f;
    treeChanged = true;
    return { ...f, placements };
  });
  return { doc: nextDoc, tree: treeChanged ? { ...tree, features } : tree };
}

/** The sketch point a hole placement was made on, if any. */
function sketchPointOf(faceId: string): { sketchId: string; pointId: string } | null {
  let m = /^vertex:sketch:([^/]+)\/(.+)$/.exec(faceId);
  if (!m) m = /^sketchpoint:([^:]+):(.+)$/.exec(faceId);
  return m ? { sketchId: m[1], pointId: m[2] } : null;
}
