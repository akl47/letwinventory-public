import { describe, it, expect } from 'vitest';
import {
  emptyFeatureTree, addFeature, removeFeature, updateFeatureParam,
  removeFeaturesReferencingSketch, regenerateModel, isOriginFeature, isExtrudeFeature,
  type KernelAdapter,
} from './featureTree';
import type { SketchDocument, Plane3, FaceMesh, ModelTopology } from './types';

const XY: Plane3 = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };

function mockKernel(): KernelAdapter & { extrudeCalls: number } {
  let extrudeCalls = 0;
  return {
    get extrudeCalls() { return extrudeCalls; },
    buildOriginGeometry() {
      return { datums: [], faces: [], topology: { vertices: [], edges: [] } };
    },
    buildExtrude(_profile, _plane, _distance): { faces: FaceMesh[]; topology: ModelTopology } {
      extrudeCalls++;
      return { faces: [], topology: { vertices: [], edges: [] } };
    },
  };
}

function makeDoc(sketchId: string): SketchDocument {
  return {
    sketches: {
      [sketchId]: {
        id: sketchId,
        hostId: 'datum:xy_plane',
        plane: XY,
        state: {
          entities: [
            { kind: 'point', id: 'p1', x: 0, y: 0 },
            { kind: 'point', id: 'p2', x: 10, y: 0 },
            { kind: 'point', id: 'p3', x: 10, y: 10 },
            { kind: 'point', id: 'p4', x: 0, y: 10 },
            { kind: 'line', id: 'l1', startId: 'p1', endId: 'p2' },
            { kind: 'line', id: 'l2', startId: 'p2', endId: 'p3' },
            { kind: 'line', id: 'l3', startId: 'p3', endId: 'p4' },
            { kind: 'line', id: 'l4', startId: 'p4', endId: 'p1' },
          ],
          constraints: [],
        },
        candidates: [],
      },
    },
    nextSketchSeq: 2,
  };
}

describe('Feature tree (CAD-034, CAD-035, CAD-037)', () => {
  describe('emptyFeatureTree', () => {
    it('starts with exactly one origin feature', () => {
      const tree = emptyFeatureTree();
      expect(tree.features.length).toBe(1);
      expect(tree.features[0].type).toBe('origin');
    });

    it('assigns a stable id to the origin feature', () => {
      const tree = emptyFeatureTree();
      expect(tree.features[0].id).toBeTruthy();
      expect(typeof tree.features[0].id).toBe('string');
    });

    it('initializes nextFeatureSeq to 2 (origin took 1)', () => {
      const tree = emptyFeatureTree();
      expect(tree.nextFeatureSeq).toBe(2);
    });
  });

  describe('addFeature', () => {
    it('appends a new feature with auto-assigned id', () => {
      const t0 = emptyFeatureTree();
      const t1 = addFeature(t0, { type: 'extrude', sketchId: 's1', distance: 10 });
      expect(t1.features.length).toBe(2);
      expect(t1.features[1].type).toBe('extrude');
      expect(t1.features[1].id).toBeTruthy();
    });

    it('is immutable — original tree is unchanged', () => {
      const t0 = emptyFeatureTree();
      addFeature(t0, { type: 'extrude', sketchId: 's1', distance: 10 });
      expect(t0.features.length).toBe(1);
    });

    it('increments nextFeatureSeq', () => {
      const t0 = emptyFeatureTree();
      const t1 = addFeature(t0, { type: 'extrude', sketchId: 's1', distance: 5 });
      expect(t1.nextFeatureSeq).toBe(t0.nextFeatureSeq + 1);
    });
  });

  describe('removeFeature', () => {
    it('drops the feature with the given id', () => {
      const t0 = emptyFeatureTree();
      const t1 = addFeature(t0, { type: 'extrude', sketchId: 's1', distance: 10 });
      const extrudeId = t1.features[1].id;
      const t2 = removeFeature(t1, extrudeId);
      expect(t2.features.length).toBe(1);
      expect(t2.features.find(f => f.id === extrudeId)).toBeUndefined();
    });

    it('is immutable', () => {
      const t0 = emptyFeatureTree();
      const t1 = addFeature(t0, { type: 'extrude', sketchId: 's1', distance: 10 });
      removeFeature(t1, t1.features[1].id);
      expect(t1.features.length).toBe(2);
    });

    it('is a no-op for an unknown id', () => {
      const t0 = emptyFeatureTree();
      const t1 = removeFeature(t0, 'no-such-id');
      expect(t1.features.length).toBe(1);
    });
  });

  describe('updateFeatureParam', () => {
    it('merges a patch onto an extrude feature', () => {
      const t0 = emptyFeatureTree();
      const t1 = addFeature(t0, { type: 'extrude', sketchId: 's1', distance: 10 });
      const id = t1.features[1].id;
      const t2 = updateFeatureParam(t1, id, { distance: 25 });
      const ext = t2.features.find(f => f.id === id);
      expect(ext).toBeTruthy();
      expect((ext as any).distance).toBe(25);
      expect((ext as any).sketchId).toBe('s1');
    });

    it('is immutable', () => {
      const t0 = emptyFeatureTree();
      const t1 = addFeature(t0, { type: 'extrude', sketchId: 's1', distance: 10 });
      const id = t1.features[1].id;
      updateFeatureParam(t1, id, { distance: 99 });
      expect((t1.features[1] as any).distance).toBe(10);
    });
  });

  describe('type guards', () => {
    it('isOriginFeature identifies origin', () => {
      const t = emptyFeatureTree();
      expect(isOriginFeature(t.features[0])).toBe(true);
      expect(isExtrudeFeature(t.features[0])).toBe(false);
    });

    it('isExtrudeFeature identifies extrude', () => {
      const t0 = emptyFeatureTree();
      const t1 = addFeature(t0, { type: 'extrude', sketchId: 's1', distance: 1 });
      expect(isExtrudeFeature(t1.features[1])).toBe(true);
      expect(isOriginFeature(t1.features[1])).toBe(false);
    });
  });

  describe('removeFeaturesReferencingSketch (REQ 608)', () => {
    it('removes every Extrude that references the given sketchId', () => {
      let t = emptyFeatureTree();
      t = addFeature(t, { type: 'extrude', sketchId: 'sA', distance: 5 });
      t = addFeature(t, { type: 'extrude', sketchId: 'sB', distance: 7 });
      t = addFeature(t, { type: 'extrude', sketchId: 'sA', distance: 9 });
      const t2 = removeFeaturesReferencingSketch(t, 'sA');
      expect(t2.features.length).toBe(2);
      const remaining = t2.features.filter(f => f.type === 'extrude');
      expect(remaining.every(f => f.type === 'extrude' && f.sketchId === 'sB')).toBe(true);
    });

    it('preserves the Origin feature unconditionally', () => {
      const t = emptyFeatureTree();
      const t2 = removeFeaturesReferencingSketch(t, 'whatever');
      expect(t2.features.length).toBe(1);
      expect(t2.features[0].type).toBe('origin');
    });

    it('is a no-op when no Extrude references the sketch', () => {
      let t = emptyFeatureTree();
      t = addFeature(t, { type: 'extrude', sketchId: 'sA', distance: 5 });
      const t2 = removeFeaturesReferencingSketch(t, 'no-such-sketch');
      expect(t2.features.length).toBe(2);
    });

    it('is immutable', () => {
      let t = emptyFeatureTree();
      t = addFeature(t, { type: 'extrude', sketchId: 'sA', distance: 5 });
      const before = t.features.length;
      removeFeaturesReferencingSketch(t, 'sA');
      expect(t.features.length).toBe(before);
    });
  });

  describe('regenerateModel visibility (REQ 610)', () => {
    it('skips Extrude features where visible === false', async () => {
      let tree = emptyFeatureTree();
      tree = addFeature(tree, { type: 'extrude', sketchId: 'sA', distance: 5, visible: false });
      const kernel = mockKernel();
      const result = await regenerateModel(kernel, tree, makeDoc('sA'));
      expect(kernel.extrudeCalls).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('builds Extrude features where visible is true or undefined (default)', async () => {
      let tree = emptyFeatureTree();
      tree = addFeature(tree, { type: 'extrude', sketchId: 'sA', distance: 5 });
      tree = addFeature(tree, { type: 'extrude', sketchId: 'sA', distance: 7, visible: true });
      const kernel = mockKernel();
      await regenerateModel(kernel, tree, makeDoc('sA'));
      expect(kernel.extrudeCalls).toBe(2);
    });
  });
});
