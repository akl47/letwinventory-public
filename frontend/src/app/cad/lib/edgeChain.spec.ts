// REQ 921 — chained-edge selection for Convert Entities.
import { describe, expect, it } from 'vitest';
import { chainEdgeIds, type ChainableEdge } from './edgeChain';

const seg = (id: string, a: [number, number, number], b: [number, number, number]): ChainableEdge =>
  ({ id, endpoints: [a, b] });

describe('chainEdgeIds (REQ 921)', () => {
  it('returns just the seed when nothing connects', () => {
    const edges = [seg('a', [0, 0, 0], [1, 0, 0]), seg('b', [5, 5, 0], [6, 5, 0])];
    expect(chainEdgeIds(edges, 'a')).toEqual(['a']);
  });

  it('walks a connected open chain transitively, seed first', () => {
    const edges = [
      seg('a', [0, 0, 0], [1, 0, 0]),
      seg('b', [1, 0, 0], [1, 1, 0]),
      seg('c', [1, 1, 0], [0, 1, 0]),
      seg('far', [9, 9, 9], [8, 9, 9]),
    ];
    const chain = chainEdgeIds(edges, 'a');
    expect(chain[0]).toBe('a');
    expect(chain.sort()).toEqual(['a', 'b', 'c']);
  });

  it('walks a closed loop without repeating edges', () => {
    const edges = [
      seg('a', [0, 0, 0], [1, 0, 0]),
      seg('b', [1, 0, 0], [1, 1, 0]),
      seg('c', [1, 1, 0], [0, 1, 0]),
      seg('d', [0, 1, 0], [0, 0, 0]),
    ];
    expect(chainEdgeIds(edges, 'b').sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('uses polyline first/last samples when explicit endpoints are absent', () => {
    const arc: ChainableEdge = {
      id: 'arc',
      polyline: [[1, 0, 0], [1.7, 0.7, 0], [2, 1, 0]],
    };
    const edges = [seg('a', [0, 0, 0], [1, 0, 0]), arc, seg('b', [2, 1, 0], [3, 1, 0])];
    expect(chainEdgeIds(edges, 'a').sort()).toEqual(['a', 'arc', 'b']);
  });

  it('never chains INTO a closed curve (circle), but a circle seed returns itself', () => {
    const circle: ChainableEdge = {
      id: 'circ',
      polyline: [[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0], [1, 0, 0]],
    };
    const edges = [circle, seg('a', [1, 0, 0], [2, 0, 0])];
    expect(chainEdgeIds(edges, 'a')).toEqual(['a']);
    expect(chainEdgeIds(edges, 'circ')).toEqual(['circ']);
  });

  it('respects the tolerance for near-coincident endpoints', () => {
    const edges = [
      seg('a', [0, 0, 0], [1, 0, 0]),
      seg('b', [1.000_000_5, 0, 0], [2, 0, 0]),
      seg('c', [1.01, 0, 0], [2, 1, 0]),
    ];
    expect(chainEdgeIds(edges, 'a', 1e-5).sort()).toEqual(['a', 'b']);
  });

  it('returns the seed alone when the seed id is unknown', () => {
    expect(chainEdgeIds([], 'ghost')).toEqual(['ghost']);
  });
});
