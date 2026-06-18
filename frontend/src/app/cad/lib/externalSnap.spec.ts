import { describe, it, expect } from 'vitest';
import {
  featureIdFromTopoId,
  parseCandidateId,
  externalRefForCandidate,
  closestPointOnSegment,
  nearestCandidateHit,
  crossPartEdgeRef,
  crossPartVertexRef,
} from './externalSnap';
import { onEdgeLookupKey } from './types';
import type { ReferenceCandidate } from './types';

describe('featureIdFromTopoId', () => {
  it('takes the segment before the first slash', () => {
    expect(featureIdFromTopoId('feat-1/e3')).toBe('feat-1');
    expect(featureIdFromTopoId('extrude_2/v0')).toBe('extrude_2');
  });
  it('returns the whole id when unnamespaced', () => {
    expect(featureIdFromTopoId('e3')).toBe('e3');
  });
});

describe('parseCandidateId', () => {
  it('parses vertex candidates', () => {
    expect(parseCandidateId('cand-v-feat-1/v0')).toEqual({ kind: 'vertex', topoId: 'feat-1/v0' });
  });
  it('parses edge candidates and preserves hyphens in the topo id', () => {
    expect(parseCandidateId('cand-e-f2#0-f0')).toEqual({ kind: 'edge', topoId: 'f2#0-f0' });
  });
  it('rejects non-candidate ids', () => {
    expect(parseCandidateId('point-7')).toBeNull();
  });
});

describe('externalRefForCandidate', () => {
  const cand = (id: string, kind: 'vertex' | 'edge'): ReferenceCandidate =>
    ({ id, kind, points: kind === 'vertex' ? [{ x: 0, y: 0 }] : [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
  it('builds a vertex ref with vertexId (no edgeId)', () => {
    const ref = externalRefForCandidate(cand('cand-v-feat-1/v0', 'vertex'));
    expect(ref).toEqual({ scope: 'local', featureId: 'feat-1', vertexId: 'feat-1/v0' });
  });
  it('builds an edge ref with edgeId (no vertexId)', () => {
    const ref = externalRefForCandidate(cand('cand-e-feat-1/e3', 'edge'));
    expect(ref).toEqual({ scope: 'local', featureId: 'feat-1', edgeId: 'feat-1/e3' });
  });
  it('returns null for a malformed local id', () => {
    expect(externalRefForCandidate(cand('nope', 'edge'))).toBeNull();
  });
  it('builds a cross-part ref from the crossPart descriptor (fallback geometry + stable id)', () => {
    const c: ReferenceCandidate = {
      id: 'cand-cpe-cpe:i2:...', kind: 'edge', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      crossPart: {
        definingAssemblyId: 7, definingAssemblyRepoId: '7', sourceInstanceId: 'i2', sourcePartId: 99,
        sourceStart: [0, 0, 0], sourceEnd: [10, 0, 0], stableId: 'cpe:i2:abc',
      },
    };
    expect(externalRefForCandidate(c)).toEqual({
      scope: 'cross-part', definingAssemblyId: 7, definingAssemblyRepoId: '7',
      sourceInstanceId: 'i2', sourcePartId: 99,
      sourceGeomRef: { featureId: '', edgeId: 'cpe:i2:abc' },
      fallback: { kind: 'edge', start: [0, 0, 0], end: [10, 0, 0] },
      pinnedSourceCommit: null,
    });
  });
});

describe('closestPointOnSegment', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  it('projects onto the interior', () => {
    expect(closestPointOnSegment(a, b, { x: 4, y: 5 })).toEqual({ x: 4, y: 0 });
  });
  it('clamps past the end', () => {
    expect(closestPointOnSegment(a, b, { x: 20, y: 3 })).toEqual({ x: 10, y: 0 });
  });
  it('clamps before the start', () => {
    expect(closestPointOnSegment(a, b, { x: -5, y: 3 })).toEqual({ x: 0, y: 0 });
  });
  it('handles a degenerate segment', () => {
    expect(closestPointOnSegment(a, a, { x: 3, y: 3 })).toEqual({ x: 0, y: 0 });
  });
});

describe('nearestCandidateHit', () => {
  const candidates: ReferenceCandidate[] = [
    { id: 'cand-v-f/v0', kind: 'vertex', points: [{ x: 0, y: 0 }] },
    { id: 'cand-v-f/v1', kind: 'vertex', points: [{ x: 10, y: 0 }] },
    { id: 'cand-e-f/e0', kind: 'edge', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
  ];

  it('snaps to a vertex within tolerance, returning the vertex coord', () => {
    const hit = nearestCandidateHit(candidates, { x: 0.4, y: 0.3 }, 1);
    expect(hit?.kind).toBe('vertex');
    expect(hit?.candidateId).toBe('cand-v-f/v0');
    expect(hit?.x).toBe(0);
    expect(hit?.y).toBe(0);
  });

  it('prefers a vertex over an overlapping edge when both are in range', () => {
    // Cursor near the edge midpoint endpoint region — vertex at (10,0) wins
    // over the edge even though both are within tol.
    const hit = nearestCandidateHit(candidates, { x: 9.7, y: 0.2 }, 1);
    expect(hit?.kind).toBe('vertex');
    expect(hit?.candidateId).toBe('cand-v-f/v1');
  });

  it('snaps onto the edge (closest point) when no vertex is in range', () => {
    const hit = nearestCandidateHit(candidates, { x: 5, y: 0.4 }, 1);
    expect(hit?.kind).toBe('edge');
    expect(hit?.x).toBe(5);
    expect(hit?.y).toBe(0);
  });

  it('returns null when nothing is within tolerance', () => {
    expect(nearestCandidateHit(candidates, { x: 5, y: 50 }, 1)).toBeNull();
  });
});

describe('cross-part ref builders (Convert Entities)', () => {
  it('crossPartEdgeRef puts the stable id in edgeId + fallback endpoints', () => {
    const ref = crossPartEdgeRef({
      definingAssemblyId: 7, definingAssemblyRepoId: '7', sourceInstanceId: 'i2', sourcePartId: 99,
      sourceStart: [0, 0, 0], sourceEnd: [10, 0, 0], stableId: 'cpe:i2:x',
    });
    expect(ref).toEqual({
      scope: 'cross-part', definingAssemblyId: 7, definingAssemblyRepoId: '7',
      sourceInstanceId: 'i2', sourcePartId: 99,
      sourceGeomRef: { featureId: '', edgeId: 'cpe:i2:x' },
      fallback: { kind: 'edge', start: [0, 0, 0], end: [10, 0, 0] }, pinnedSourceCommit: null,
    });
  });

  it('crossPartVertexRef uses vertexId (no edgeId → pinned) + vertex fallback', () => {
    const ref = crossPartVertexRef({
      definingAssemblyId: 7, definingAssemblyRepoId: '7', sourceInstanceId: 'i2', sourcePartId: 99,
      sourcePosition: [3, 4, 5], stableId: 'cpv:i2:y',
    });
    expect(ref).toEqual({
      scope: 'cross-part', definingAssemblyId: 7, definingAssemblyRepoId: '7',
      sourceInstanceId: 'i2', sourcePartId: 99,
      sourceGeomRef: { featureId: '', vertexId: 'cpv:i2:y' },
      fallback: { kind: 'vertex', position: [3, 4, 5] }, pinnedSourceCommit: null,
    });
    // No edgeId → onEdgeLookupKey returns null → solver pins it (0 DOF).
    expect(onEdgeLookupKey(ref)).toBeNull();
  });
});

describe('arc/circle center references (REQ 830–832)', () => {
  it('parses a center candidate id', () => {
    expect(parseCandidateId('cand-c-f1/e0')).toEqual({ kind: 'center', topoId: 'f1/e0' });
  });

  it('builds a center ref as an edge ref carrying sub:center', () => {
    const cand: ReferenceCandidate = { id: 'cand-c-f1/e0', kind: 'center', points: [{ x: 5, y: 7 }] };
    expect(externalRefForCandidate(cand)).toEqual({ scope: 'local', featureId: 'f1', edgeId: 'f1/e0', sub: 'center' });
  });

  it('onEdgeLookupKey returns the edgeId for a center ref (the solver skips its ride path via sub:center)', () => {
    const ref = externalRefForCandidate({ id: 'cand-c-f1/e0', kind: 'center', points: [{ x: 0, y: 0 }] })!;
    expect(onEdgeLookupKey(ref)).toBe('f1/e0');
  });

  it('nearestCandidateHit returns a center hit and prefers it over an edge', () => {
    const cands: ReferenceCandidate[] = [
      { id: 'cand-c-f1/e0', kind: 'center', points: [{ x: 5, y: 5 }] },
      { id: 'cand-e-f1/e1', kind: 'edge', points: [{ x: 5, y: 4 }, { x: 9, y: 4 }] },
    ];
    const hit = nearestCandidateHit(cands, { x: 5.2, y: 4.6 }, 2);
    expect(hit?.kind).toBe('center');
    expect(hit?.candidateId).toBe('cand-c-f1/e0');
  });

  it('nearestCandidateHit returns null when the center is out of tolerance', () => {
    const cands: ReferenceCandidate[] = [{ id: 'cand-c-f1/e0', kind: 'center', points: [{ x: 5, y: 5 }] }];
    expect(nearestCandidateHit(cands, { x: 50, y: 50 }, 2)).toBeNull();
  });
});
