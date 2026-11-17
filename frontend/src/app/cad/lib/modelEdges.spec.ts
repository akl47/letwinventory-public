import { describe, it, expect } from 'vitest';
import { usesTopologyEdges } from './modelEdges';
import type { ModelTopology } from './types';

const topo = (edges: unknown[]): ModelTopology => ({ edges, vertices: [] } as unknown as ModelTopology);
const A: [number, number, number] = [0, 0, 0], B: [number, number, number] = [1, 0, 0];

describe('usesTopologyEdges (REQ 1087)', () => {
  it('is false without topology edges', () => {
    expect(usesTopologyEdges(undefined)).toBe(false);
    expect(usesTopologyEdges(topo([]))).toBe(false);
  });

  it('is true for straight-only and sampled-curve bodies', () => {
    expect(usesTopologyEdges(topo([{ id: 'b/e1', isStraight: true, endpoints: [A, B] }]))).toBe(true);
    expect(usesTopologyEdges(topo([{ id: 'b/e1', isStraight: false, endpoints: [A, B], polyline: [A, [0.5, 0.1, 0], B] }]))).toBe(true);
  });

  it('stays true when a curved edge has no polyline', () => {
    expect(usesTopologyEdges(topo([
      { id: 'b/e1', isStraight: true, endpoints: [A, B] },
      { id: 'b/e2', isStraight: false, endpoints: [A, B] },
    ]))).toBe(true);
  });
});
