import { describe, expect, it } from 'vitest';
import { hasMigrations, migrateMateRefs, migrateReferences, migrateSketchDoc } from './idMigration';

// REQ 1039 — rewrite references saved with positional ids to stable ids.
describe('migrateReferences', () => {
  const m = { faces: { 'old-top': 'new-top', 'old-wall': 'new-wall' } };

  it('rewrites sketch hosts and feature face refs; leaves edge/vertex refs to the backend aliases', () => {
    const doc = {
      sketches: {
        s1: {
          hostId: 'face:old-top',
          state: {
            constraints: [
              { id: 'c1', type: 'on-edge', externalRef: { scope: 'local', featureId: 'b1', edgeId: 'b1/e64' } },
              { id: 'c2', type: 'on-edge', externalRef: { scope: 'local', featureId: 'b1', vertexId: 'b1/v3' } },
            ],
          },
        },
        s2: { hostId: 'datum:xy_plane' },
      },
    };
    const tree: { features: any[] } = {
      features: [
        { id: 'f1', type: 'extrude', endCondition: { kind: 'upToSurface', faceId: 'old-wall' }, startCondition: { kind: 'upToVertex', vertexId: 'b1/v3' } },
        { id: 'f2', type: 'datumPlane', method: { kind: 'offset', planeRef: { kind: 'face', faceId: 'old-top' } } },
        { id: 'f3', type: 'fillet', edges: [{ start: [0, 0, 0], end: [1, 0, 0], faceId: 'old-top', edgeGroupId: 'b1/e64' }] },
      ],
    };
    const d = migrateReferences(doc, m);
    expect(d.sketches.s1.hostId).toBe('face:new-top');
    expect(d.sketches.s1.state.constraints).toBe(doc.sketches.s1.state.constraints);
    expect(d.sketches.s2).toBe(doc.sketches.s2);  // untouched subtree shared
    const t = migrateReferences(tree, m);
    expect(t.features[0].endCondition.faceId).toBe('new-wall');
    expect(t.features[0].startCondition.vertexId).toBe('b1/v3');
    expect(t.features[1].method.planeRef.faceId).toBe('new-top');
    expect(t.features[2].edges[0]).toMatchObject({ faceId: 'new-top', edgeGroupId: 'b1/e64' });
  });

  it('returns the same object when nothing needs migrating', () => {
    const doc = { sketches: { s1: { hostId: 'face:new-top' } } };
    expect(migrateReferences(doc, m)).toBe(doc);
  });

  it('leaves cross-part source refs alone (their ids belong to another model)', () => {
    const doc = { externalRef: { scope: 'cross-part', sourceGeomRef: { featureId: 'b1', faceId: 'old-top' } } };
    expect(migrateReferences(doc, m)).toBe(doc);
  });

  it('hasMigrations', () => {
    expect(hasMigrations(m)).toBe(true);
    expect(hasMigrations({ faces: {} })).toBe(false);
    expect(hasMigrations(undefined)).toBe(false);
  });
});

describe('migrateMateRefs', () => {
  it('rewrites only mates whose child face ids are legacy', () => {
    const mates = [
      { mateId: 'm1', a: { instanceId: 'i1', faceId: 'old-a' }, b: { instanceId: 'i2', faceId: 'csys:p:xy' } },
      { mateId: 'm2', a: { instanceId: 'i1', faceId: 'new-a' }, b: { instanceId: 'i2', faceId: 'x' } },
    ];
    const out = migrateMateRefs(mates, { i1: { 'old-a': 'new-a' }, i2: {} });
    expect(out).toEqual([{ mateId: 'm1', a: { instanceId: 'i1', faceId: 'new-a' }, b: mates[0].b }]);
  });
});

describe('migrateSketchDoc', () => {
  it('moves a legacy sketch host onto the face the backend resolved, not the drifted id', () => {
    const m = { faces: { 'legacy-93': 'stable-wall' } };
    const doc = { sketches: { s1: { hostId: 'face:legacy-93' }, s2: { hostId: 'face:legacy-93' } } };
    const out = migrateSketchDoc(doc, m, { s1: 'stable-top' });
    expect(out.sketches.s1.hostId).toBe('face:stable-top');
    expect(out.sketches.s2.hostId).toBe('face:stable-wall');  // nothing resolved → plain id migration
  });

  it('leaves a stable host alone even if the resolver picked a sibling piece', () => {
    const doc = { sketches: { s1: { hostId: 'face:stable-top' } } };
    expect(migrateSketchDoc(doc, { faces: {} }, { s1: 'stable-top-piece' })).toBe(doc);
  });
});
