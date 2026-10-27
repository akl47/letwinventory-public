import { describe, it, expect } from 'vitest';
import {
  parseScopedId, buildCrossPartExternalRef, classifyCrossPartRef, crossPartStatusLabel,
  isSkeletonRef, SKELETON_INSTANCE_ID,
  type CrossPartExternalRef,
} from './crossPartRef';

describe('parseScopedId (REQ 775)', () => {
  it('splits instanceId::rawId', () => {
    expect(parseScopedId('i2::f1#0-e0')).toEqual({ instanceId: 'i2', rawId: 'f1#0-e0' });
  });
  it('returns null for an unscoped (same-part) id', () => {
    expect(parseScopedId('f1#0-e0')).toBeNull();
  });
});

describe('buildCrossPartExternalRef (REQ 775)', () => {
  it('builds a cross-part ref from a cross-instance edge pick', () => {
    const er = buildCrossPartExternalRef({
      scopedId: 'i2::f1/e0', sourcePartId: 99,
      definingAssemblyId: 7, definingAssemblyRepoId: '42',
      fallback: { kind: 'edge', start: [0, 0, 0], end: [1, 0, 0] },
    });
    expect(er).toMatchObject({
      scope: 'cross-part', definingAssemblyId: 7, definingAssemblyRepoId: '42',
      sourceInstanceId: 'i2', sourcePartId: 99,
      sourceGeomRef: { featureId: 'f1', edgeId: 'f1/e0' },
      pinnedSourceCommit: null,
    });
    expect(er!.fallback).toEqual({ kind: 'edge', start: [0, 0, 0], end: [1, 0, 0] });
  });

  it('returns null for a same-part (unscoped) pick', () => {
    expect(buildCrossPartExternalRef({
      scopedId: 'f1/e0', sourcePartId: 99, definingAssemblyId: 7, definingAssemblyRepoId: '42',
    })).toBeNull();
  });

  it('derives featureId from a #-scoped edge id', () => {
    const er = buildCrossPartExternalRef({
      scopedId: 'i3::f2#0-e5', sourcePartId: 1, definingAssemblyId: 1, definingAssemblyRepoId: '1',
    });
    expect(er!.sourceGeomRef).toEqual({ featureId: 'f2#0-e5', edgeId: 'f2#0-e5' });
  });
});

describe('classifyCrossPartRef (REQ 776/778)', () => {
  const er = (extra: Partial<CrossPartExternalRef> = {}): CrossPartExternalRef => ({
    scope: 'cross-part', definingAssemblyId: 7, definingAssemblyRepoId: '42',
    sourceInstanceId: 'i2', sourcePartId: 99, sourceGeomRef: { featureId: 'f1', edgeId: 'f1/e0' }, ...extra,
  });

  it('ok when in its defining assembly and resolved', () => {
    expect(classifyCrossPartRef(er(), { openAssemblyId: 7, errors: [] })).toBe('ok');
  });
  it('out-of-context when opened in a different assembly', () => {
    expect(classifyCrossPartRef(er(), { openAssemblyId: 9 })).toBe('out-of-context');
  });
  it('cyclic when a cycle error names the source instance', () => {
    expect(classifyCrossPartRef(er(), { openAssemblyId: 7, errors: ['Cyclic in-context reference i5 → i2: resolved from cached snapshot'] })).toBe('cyclic');
  });
  it('stale when the cached projection is flagged', () => {
    expect(classifyCrossPartRef(er({ cachedProjection: { stale: true } }), { openAssemblyId: 7 })).toBe('stale');
  });
  it('broken takes precedence', () => {
    expect(classifyCrossPartRef(er(), { openAssemblyId: 9, broken: true })).toBe('broken');
  });
});

describe('crossPartStatusLabel', () => {
  it('maps statuses to human labels', () => {
    expect(crossPartStatusLabel('ok')).toBe('In context');
    expect(crossPartStatusLabel('broken')).toBe('Broken reference');
    expect(crossPartStatusLabel('out-of-context')).toBe('Out of context');
  });
});

describe('skeleton refs (REQ 915)', () => {
  it('isSkeletonRef recognizes the sentinel source instance', () => {
    expect(isSkeletonRef({
      scope: 'cross-part', definingAssemblyId: 1, definingAssemblyRepoId: '1',
      sourceInstanceId: SKELETON_INSTANCE_ID, sourcePartId: 2,
      sourceGeomRef: { featureId: '', edgeId: 'asketch:s1/l1' },
    })).toBe(true);
    expect(isSkeletonRef({
      scope: 'cross-part', definingAssemblyId: 1, definingAssemblyRepoId: '1',
      sourceInstanceId: 'i2', sourcePartId: 2,
      sourceGeomRef: { featureId: '', edgeId: 'e1' },
    })).toBe(false);
    expect(isSkeletonRef({ scope: 'local', featureId: 'f1', edgeId: 'e1' })).toBe(false);
    expect(isSkeletonRef(null)).toBe(false);
  });

  it('classifyCrossPartRef treats skeleton refs by the same rules', () => {
    const er = {
      scope: 'cross-part', definingAssemblyId: 5, definingAssemblyRepoId: '5',
      sourceInstanceId: SKELETON_INSTANCE_ID, sourcePartId: 2,
      sourceGeomRef: { featureId: '', edgeId: 'asketch:s1/l1' },
    } as const;
    expect(classifyCrossPartRef(er as never, { openAssemblyId: 5 })).toBe('ok');
    expect(classifyCrossPartRef(er as never, { openAssemblyId: 9 })).toBe('out-of-context');
    expect(classifyCrossPartRef(er as never, { broken: true })).toBe('broken');
  });
});
