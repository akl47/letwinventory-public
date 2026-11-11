import { describe, expect, it } from 'vitest';
import { adoptHostPlanes } from './hostPlanes';
import type { FeatureTree, Plane3, SketchDocument } from './types';

// REQ 1052 — the editor adopts the planes regen reports for face-hosted
// sketches whose face moved, and hole placements on their points follow.

const plane = (z: number): Plane3 => ({ origin: [0, 0, z], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] });
const doc: SketchDocument = {
  sketches: {
    s2: {
      id: 's2', hostId: 'face:top', plane: plane(10), candidates: [],
      state: { entities: [{ kind: 'point', id: 'p1', x: 3, y: 4 }], constraints: [] },
    } as any,
  },
  nextSketchSeq: 3,
};
const tree = {
  features: [
    { id: 'f1', type: 'origin' },
    {
      id: 'f3', type: 'hole', placements: [
        { faceId: 'vertex:sketch:s2/p1', position: [3, 4, 10], faceCentroid: [3, 4, 10], faceNormal: [0, 0, 1] },
        { faceId: 'sketchpoint:s2:p1', position: [3, 4, 10], faceCentroid: [3, 4, 10], faceNormal: [0, 0, 1] },
        { faceId: 'vertex:b1/v0', position: [9, 9, 9], faceCentroid: [9, 9, 9], faceNormal: [0, 0, 1] },
      ],
    },
  ],
  nextFeatureSeq: 4,
} as unknown as FeatureTree;

describe('adoptHostPlanes', () => {
  it('moves the sketch onto its new plane and its hole placements with it', () => {
    const out = adoptHostPlanes(doc, tree, { s2: plane(6) });
    expect(out.doc.sketches['s2'].plane.origin).toEqual([0, 0, 6]);
    const placements = (out.tree.features[1] as any).placements;
    expect(placements[0].position).toEqual([3, 4, 6]);
    expect(placements[1].position).toEqual([3, 4, 6]);
    expect(placements[2]).toBe((tree.features[1] as any).placements[2]);  // a body vertex is left alone
  });

  it('returns the inputs unchanged when nothing moved or the moved sketch is being edited', () => {
    const none = adoptHostPlanes(doc, tree, {});
    expect(none.doc).toBe(doc);
    expect(none.tree).toBe(tree);
    const editing = adoptHostPlanes(doc, tree, { s2: plane(6) }, 's2');
    expect(editing.doc).toBe(doc);
    expect(editing.tree).toBe(tree);
  });
});
