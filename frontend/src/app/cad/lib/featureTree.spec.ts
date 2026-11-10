import { describe, it, expect } from 'vitest';
import {
  emptyFeatureTree, addFeature, removeFeature, updateFeatureParam,
  removeFeaturesReferencingSketch, featureReferencesSketch,
  upgradeFeatureTree, setBodyVisibility, setBodyName, setBodyColor, setRollbackIndex,
  addBodyGroup, renameBodyGroup, ungroupBodies, removeBodyFromGroup, addBodiesToGroup,
  isOriginFeature, isExtrudeFeature,
} from './featureTree';

// Phase 1: regenerateModel + KernelAdapter mock have moved server-side.
// Visibility-aware regeneration is now covered by
// `backend/tests/__tests__/design/cad-regenerate.test.js`.

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

    it('removes sweep features referencing the sketch as profile OR path', () => {
      let t = emptyFeatureTree();
      t = addFeature(t, { type: 'sweep', profileSketchId: 'sA', pathSketchId: 'sP' });
      t = addFeature(t, { type: 'sweep', profileSketchId: 'sB', pathSketchId: 'sA' });
      t = addFeature(t, { type: 'sweep', profileSketchId: 'sB', pathSketchId: 'sP' });
      const t2 = removeFeaturesReferencingSketch(t, 'sA');
      expect(t2.features.filter(f => f.type === 'sweep').length).toBe(1);
    });

    it('removes loft features whose sketchIds include the given sketch', () => {
      let t = emptyFeatureTree();
      t = addFeature(t, { type: 'loft', sketchIds: ['sA', 'sB'] });
      t = addFeature(t, { type: 'loft', sketchIds: ['sB', 'sC'] });
      const t2 = removeFeaturesReferencingSketch(t, 'sA');
      const lofts = t2.features.filter(f => f.type === 'loft');
      expect(lofts.length).toBe(1);
      expect(lofts[0].type === 'loft' && lofts[0].sketchIds).toEqual(['sB', 'sC']);
    });
  });

  describe('featureReferencesSketch (REQ 608 dependent scan)', () => {
    it('matches every sketch-consuming kind against its sketch fields', () => {
      expect(featureReferencesSketch({ id: 'f1', type: 'extrude', sketchId: 'sA', distance: 1 }, 'sA')).toBe(true);
      expect(featureReferencesSketch({ id: 'f2', type: 'cutExtrude', sketchId: 'sA', distance: 1 }, 'sA')).toBe(true);
      expect(featureReferencesSketch({ id: 'f3', type: 'revolve', sketchId: 'sA', axisLineId: 'l1', angle: 360 }, 'sA')).toBe(true);
      expect(featureReferencesSketch({ id: 'f4', type: 'cutRevolve', sketchId: 'sA', axisLineId: 'l1', angle: 360 }, 'sA')).toBe(true);
      expect(featureReferencesSketch({ id: 'f5', type: 'sweep', profileSketchId: 'sA', pathSketchId: 'sP' }, 'sA')).toBe(true);
      expect(featureReferencesSketch({ id: 'f6', type: 'cutSweep', profileSketchId: 'sB', pathSketchId: 'sA' }, 'sA')).toBe(true);
      expect(featureReferencesSketch({ id: 'f7', type: 'loft', sketchIds: ['sB', 'sA'] }, 'sA')).toBe(true);
    });

    it('does not match non-referencing features or the origin', () => {
      expect(featureReferencesSketch({ id: 'f1', type: 'extrude', sketchId: 'sB', distance: 1 }, 'sA')).toBe(false);
      expect(featureReferencesSketch({ id: 'f7', type: 'loft', sketchIds: ['sB', 'sC'] }, 'sA')).toBe(false);
      expect(featureReferencesSketch(emptyFeatureTree().features[0], 'sA')).toBe(false);
    });
  });

  describe('upgradeFeatureTree (REQ 610 — legacy hide → suppress)', () => {
    it('converts visible:false on a solid feature to suppressed:true and drops visible', () => {
      let t = emptyFeatureTree();
      t = addFeature(t, { type: 'extrude', sketchId: 's1', distance: 10, visible: false });
      const up = upgradeFeatureTree(t);
      const f = up.features[1];
      expect(f.type === 'extrude' && f.suppressed).toBe(true);
      expect(f.type === 'extrude' && f.visible).toBeUndefined();
    });

    it('preserves datum-feature visibility (render-only, not suppression)', () => {
      let t = emptyFeatureTree();
      t = addFeature(t, { type: 'datumPlane', method: { kind: 'offset', planeRef: { kind: 'datum', datumId: 'xy_plane' }, distance: 10 }, visible: false });
      const up = upgradeFeatureTree(t);
      const f = up.features[1] as { visible?: boolean; suppressed?: boolean };
      expect(f.visible).toBe(false);
      expect(f.suppressed).toBeUndefined();
    });

    it('returns the SAME tree object when nothing needs upgrading', () => {
      let t = emptyFeatureTree();
      t = addFeature(t, { type: 'extrude', sketchId: 's1', distance: 10 });
      expect(upgradeFeatureTree(t)).toBe(t);
    });

    it('does not disturb an already-suppressed feature', () => {
      let t = emptyFeatureTree();
      t = addFeature(t, { type: 'extrude', sketchId: 's1', distance: 10, suppressed: true, visible: false });
      const up = upgradeFeatureTree(t);
      const f = up.features[1];
      expect(f.type === 'extrude' && f.suppressed).toBe(true);
      expect(f.type === 'extrude' && f.visible).toBeUndefined();
    });
  });

  describe('setBodyVisibility (REQ 745)', () => {
    it('records hidden bodies and clears them back to visible', () => {
      const t0 = emptyFeatureTree();
      const t1 = setBodyVisibility(t0, 'b1', false);
      expect(t1.bodyVisibility).toEqual({ b1: false });
      const t2 = setBodyVisibility(t1, 'b1', true);
      expect(t2.bodyVisibility ?? {}).toEqual({});
    });

    it('is immutable', () => {
      const t0 = emptyFeatureTree();
      setBodyVisibility(t0, 'b1', false);
      expect(t0.bodyVisibility).toBeUndefined();
    });
  });

  describe('setBodyName (REQ 857)', () => {
    it('sets a name and clears it on empty/whitespace', () => {
      const t0 = emptyFeatureTree();
      const t1 = setBodyName(t0, 'b1', 'Housing');
      expect(t1.bodyNames).toEqual({ b1: 'Housing' });
      const t2 = setBodyName(t1, 'b1', '   ');
      expect(t2.bodyNames ?? {}).toEqual({});
    });
  });

  describe('setBodyColor (REQ 1041)', () => {
    it('stores a normalized hex color and clears it with null', () => {
      const t0 = emptyFeatureTree();
      const t1 = setBodyColor(t0, 'b1', '#FF8800');
      expect(t1.bodyColors).toEqual({ b1: 'ff8800' });
      const t2 = setBodyColor(t1, 'b2', '00aa11');
      expect(t2.bodyColors).toEqual({ b1: 'ff8800', b2: '00aa11' });
      const t3 = setBodyColor(setBodyColor(t2, 'b1', null), 'b2', null);
      expect(t3.bodyColors).toBeUndefined();
    });

    it('ignores a malformed color', () => {
      const t0 = setBodyColor(emptyFeatureTree(), 'b1', 'ff8800');
      expect(setBodyColor(t0, 'b1', 'orange')).toBe(t0);
    });
  });

  describe('body groups (REQ 1045)', () => {
    it('groups bodies, moving them out of any other group and dropping groups left empty', () => {
      const t1 = addBodyGroup(emptyFeatureTree(), { id: 'g1', name: 'Set A', bodyIds: ['b1', 'b2'] });
      expect(t1.bodyGroups).toEqual([{ id: 'g1', name: 'Set A', bodyIds: ['b1', 'b2'] }]);
      const t2 = addBodyGroup(t1, { id: 'g2', name: 'Set B', bodyIds: ['b2', 'b3'] });
      expect(t2.bodyGroups).toEqual([
        { id: 'g1', name: 'Set A', bodyIds: ['b1'] },
        { id: 'g2', name: 'Set B', bodyIds: ['b2', 'b3'] },
      ]);
      const t3 = addBodyGroup(t2, { id: 'g3', name: 'All', bodyIds: ['b1'] });
      expect(t3.bodyGroups!.map(g => g.id)).toEqual(['g2', 'g3']);
    });

    it('adds bodies to an existing group, taking them from their old group (REQ 1047)', () => {
      let t = addBodyGroup(emptyFeatureTree(), { id: 'g1', name: 'A', bodyIds: ['b1'] });
      t = addBodyGroup(t, { id: 'g2', name: 'B', bodyIds: ['b2', 'b3'] });
      t = addBodiesToGroup(t, 'g1', ['b3', 'b4']);
      expect(t.bodyGroups).toEqual([
        { id: 'g1', name: 'A', bodyIds: ['b1', 'b3', 'b4'] },
        { id: 'g2', name: 'B', bodyIds: ['b2'] },
      ]);
    });

    it('renames, removes a member, and ungroups', () => {
      const t1 = addBodyGroup(emptyFeatureTree(), { id: 'g1', name: 'Set A', bodyIds: ['b1', 'b2'] });
      expect(renameBodyGroup(t1, 'g1', '  Kit ').bodyGroups![0].name).toBe('Kit');
      expect(renameBodyGroup(t1, 'g1', '   ')).toBe(t1);  // blank name keeps the old one
      const t2 = removeBodyFromGroup(t1, 'b1');
      expect(t2.bodyGroups).toEqual([{ id: 'g1', name: 'Set A', bodyIds: ['b2'] }]);
      expect(removeBodyFromGroup(t2, 'b2').bodyGroups).toBeUndefined();
      expect(ungroupBodies(t1, 'g1').bodyGroups).toBeUndefined();
    });
  });

  describe('setRollbackIndex (REQ 858)', () => {
    it('stores an index and clears it with null', () => {
      const t0 = emptyFeatureTree();
      const t1 = setRollbackIndex(t0, 3);
      expect(t1.rollbackIndex).toBe(3);
      const t2 = setRollbackIndex(t1, null);
      expect(t2.rollbackIndex).toBeUndefined();
    });
  });

});
