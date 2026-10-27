import { describe, it, expect } from 'vitest';
import { externalRefKey, findProjectedBySource, listProjectedCurves } from './projectedGeometry';
import type { ExternalRef, SketchConstraint, SketchEntity, SketchState } from './types';

const localRef = (edgeId: string, sub?: 'center'): ExternalRef =>
  ({ scope: 'local', featureId: edgeId.split('/')[0], edgeId, ...(sub ? { sub } : {}) }) as ExternalRef;

const localVertexRef = (vertexId: string): ExternalRef =>
  ({ scope: 'local', featureId: vertexId.split('/')[0], vertexId }) as ExternalRef;

const xpRef = (opts: { asm?: number; inst?: string; edgeId?: string; vertexId?: string }): ExternalRef =>
  ({
    scope: 'cross-part',
    definingAssemblyId: opts.asm ?? 7,
    definingAssemblyRepoId: '42',
    sourceInstanceId: opts.inst ?? 'i2',
    sourcePartId: 99,
    sourceGeomRef: { featureId: '', ...(opts.edgeId ? { edgeId: opts.edgeId } : {}), ...(opts.vertexId ? { vertexId: opts.vertexId } : {}) },
  }) as ExternalRef;

const line = (id: string): SketchEntity => ({ id, kind: 'line', p1: `${id}-a`, p2: `${id}-b` }) as unknown as SketchEntity;
const point = (id: string): SketchEntity => ({ id, kind: 'point', x: 0, y: 0 }) as unknown as SketchEntity;
const circle = (id: string): SketchEntity => ({ id, kind: 'circle', center: `${id}-c`, radius: 5 }) as unknown as SketchEntity;

const onEdge = (id: string, entityId: string, externalRef: ExternalRef): SketchConstraint =>
  ({ id, type: 'on-edge', targets: [{ entityId }], externalRef }) as SketchConstraint;

const state = (entities: SketchEntity[], constraints: SketchConstraint[]): SketchState =>
  ({ entities, constraints }) as SketchState;

describe('externalRefKey (REQ 939)', () => {
  it('keys a local ref by its namespaced edge id', () => {
    expect(externalRefKey(localRef('f1/e3'))).toBe(JSON.stringify(['local', 'f1/e3', '', '']));
  });

  it('is not fooled by ids containing the encoding punctuation', () => {
    // Cross-part stable ids embed `|` and `:` (`cpe:<inst>:<ptLo>|<ptHi>`), so a
    // naive delimiter-joined key could make two distinct refs collide.
    const a = externalRefKey(xpRef({ inst: 'i2', edgeId: 'cpe:i2:0,0,0|1,0,0' }));
    const b = externalRefKey(xpRef({ inst: 'i2|x', edgeId: 'cpe:i2:0,0,0' }));
    expect(a).not.toBe(b);
  });

  it('distinguishes an edge ride from a center pin on the SAME edge', () => {
    // Riding the edge and pinning to its projected center are different
    // references — collapsing them would block a legitimate second projection.
    expect(externalRefKey(localRef('f1/e3'))).not.toBe(externalRefKey(localRef('f1/e3', 'center')));
  });

  it('distinguishes an edge ref from a vertex ref', () => {
    expect(externalRefKey(localRef('f1/e3'))).not.toBe(externalRefKey(localVertexRef('f1/e3')));
  });

  it('keys a cross-part ref by assembly + instance + geometry id', () => {
    expect(externalRefKey(xpRef({ edgeId: 'cpe:i2:0,0,0|1,0,0' })))
      .toBe(JSON.stringify(['xp', 7, 'i2', 'cpe:i2:0,0,0|1,0,0', '', '']));
  });

  it('separates the same geometry id under different instances or assemblies', () => {
    const a = externalRefKey(xpRef({ inst: 'i2', edgeId: 'asketch:s1/e1' }));
    const b = externalRefKey(xpRef({ inst: '__skeleton__', edgeId: 'asketch:s1/e1' }));
    const c = externalRefKey(xpRef({ asm: 8, inst: 'i2', edgeId: 'asketch:s1/e1' }));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('never collides across scopes, and returns null when there is no id', () => {
    expect(externalRefKey(localRef('f1/e3'))).not.toBe(externalRefKey(xpRef({ edgeId: 'f1/e3' })));
    expect(externalRefKey(undefined)).toBeNull();
    expect(externalRefKey({ scope: 'local', featureId: 'f1' } as ExternalRef)).toBeNull();
  });

  it('ignores volatile resolve-time fields', () => {
    const bare = xpRef({ edgeId: 'cpe:i2:x' });
    const decorated = {
      ...(bare as any),
      fallback: { kind: 'edge', start: [0, 0, 0], end: [1, 0, 0] },
      cachedProjection: { resolvedAt: 123, edges: [{ polyline: [] }] },
      pinnedSourceCommit: 'abc123',
    } as ExternalRef;
    expect(externalRefKey(decorated)).toBe(externalRefKey(bare));
  });
});

describe('findProjectedBySource (REQ 939)', () => {
  const s = state(
    [line('L1'), point('P1')],
    [onEdge('c1', 'L1', localRef('f1/e3')), onEdge('c2', 'P1', localVertexRef('f1/v0'))],
  );

  it('finds the entity already projected from the same source', () => {
    expect(findProjectedBySource(s, localRef('f1/e3'))).toBe('L1');
  });

  it('covers POINTS too, so a vertex cannot be projected twice', () => {
    expect(findProjectedBySource(s, localVertexRef('f1/v0'))).toBe('P1');
  });

  it('returns null for a source that is not projected yet', () => {
    expect(findProjectedBySource(s, localRef('f1/e9'))).toBeNull();
    expect(findProjectedBySource(s, localRef('f1/e3', 'center'))).toBeNull();
  });

  it('ignores a constraint whose target entity no longer exists', () => {
    const stale = state([], [onEdge('c1', 'L1', localRef('f1/e3'))]);
    expect(findProjectedBySource(stale, localRef('f1/e3'))).toBeNull();
  });

  it('detects duplicates within an in-flight batch state', () => {
    // Chain/face projection accumulates into one state before committing, so
    // the check must see entities added earlier in the same batch.
    let batch = state([], []);
    batch = state([line('L1')], [onEdge('c1', 'L1', localRef('f1/e3'))]);
    expect(findProjectedBySource(batch, localRef('f1/e3'))).toBe('L1');
  });
});

describe('listProjectedCurves (REQ 938)', () => {
  it('lists projected curves and skips incidental snapped points', () => {
    const s = state(
      [line('L1'), circle('C1'), point('P1')],
      [
        onEdge('c1', 'L1', localRef('f1/e3')),
        onEdge('c2', 'C1', localRef('f1/e7')),
        onEdge('c3', 'P1', localVertexRef('f1/v0')),
      ],
    );
    expect(listProjectedCurves(s).map((r) => r.entityId)).toEqual(['L1', 'C1']);
  });

  it('flags cross-part sources', () => {
    const s = state(
      [line('L1'), line('L2')],
      [onEdge('c1', 'L1', localRef('f1/e3')), onEdge('c2', 'L2', xpRef({ edgeId: 'cpe:i2:x' }))],
    );
    const rows = listProjectedCurves(s);
    expect(rows.map((r) => r.crossPart)).toEqual([false, true]);
    expect(rows[1].sourceKey).toBe(externalRefKey(rows[1].ref));
  });

  it('omits hand-drawn geometry and entities whose link was broken', () => {
    // Break Link removes the on-edge constraint but keeps the geometry.
    const s = state([line('L1'), line('L2')], [onEdge('c1', 'L1', localRef('f1/e3'))]);
    expect(listProjectedCurves(s).map((r) => r.entityId)).toEqual(['L1']);
  });

  it('drops rows whose entity was deleted, and never repeats an entity', () => {
    const s = state(
      [line('L1')],
      [
        onEdge('c1', 'L1', localRef('f1/e3')),
        onEdge('c2', 'L1', localRef('f1/e3')),   // duplicate link on one entity
        onEdge('c3', 'GONE', localRef('f1/e9')), // entity deleted
      ],
    );
    expect(listProjectedCurves(s).map((r) => r.entityId)).toEqual(['L1']);
  });

  it('ignores constraints that carry no external ref', () => {
    const s = state([line('L1')], [{ id: 'c1', type: 'on-edge', targets: [{ entityId: 'L1' }] } as SketchConstraint]);
    expect(listProjectedCurves(s)).toEqual([]);
  });
});
