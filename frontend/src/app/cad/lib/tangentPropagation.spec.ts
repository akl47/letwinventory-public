import { describe, it, expect } from 'vitest';
import { propagateTangentEdges } from './tangentPropagation';
import type { ModelTopology } from './types';

// REQ 646 — Tangent edge propagation for the Fillet / Chamfer sidebar.
// One click on any segment of a tangent-continuous chain picks the
// entire chain.

function topo(...edges: ModelTopology['edges']): ModelTopology {
  return { vertices: [], edges };
}

describe('propagateTangentEdges (REQ 646)', () => {
  it('returns just the seed when topology has no other edges', () => {
    const t = topo({
      id: 'e0',
      isStraight: true,
      endpoints: [[0, 0, 0], [10, 0, 0]],
    });
    const out = propagateTangentEdges(
      { edgeId: 'e0', start: [0, 0, 0], end: [10, 0, 0] },
      t,
    );
    expect(out.length).toBe(1);
    expect(out[0].edgeId).toBe('e0');
  });

  it('does not propagate across a sharp corner (perpendicular meeting)', () => {
    // Two segments meeting at the origin at 90° — not tangent-continuous.
    const t = topo(
      { id: 'e0', isStraight: true, endpoints: [[0, 0, 0], [10, 0, 0]] },
      { id: 'e1', isStraight: true, endpoints: [[0, 0, 0], [0, 10, 0]] },
    );
    const out = propagateTangentEdges(
      { edgeId: 'e0', start: [0, 0, 0], end: [10, 0, 0] },
      t,
    );
    expect(out.map(e => e.edgeId).sort()).toEqual(['e0']);
  });

  it('propagates across a collinear endpoint join (two straight segments forming one line)', () => {
    // (0,0,0) → (10,0,0) → (20,0,0): tangents anti-parallel at (10,0,0).
    const t = topo(
      { id: 'e0', isStraight: true, endpoints: [[0, 0, 0], [10, 0, 0]] },
      { id: 'e1', isStraight: true, endpoints: [[10, 0, 0], [20, 0, 0]] },
    );
    const out = propagateTangentEdges(
      { edgeId: 'e0', start: [0, 0, 0], end: [10, 0, 0] },
      t,
    );
    expect(out.map(e => e.edgeId).sort()).toEqual(['e0', 'e1']);
  });

  it('propagates through a 4-arc circumference of a circular hole (SolidWorks default)', () => {
    // Four 90° arcs forming a circle in the XY plane. The propagation
    // walker reads the tangent from the polyline's first/last segment, so
    // each arc carries a DENSELY sampled polyline: a 3-point polyline on a
    // 90° arc gives a chord direction ~22.5° off the true tangent — well
    // past the cos-5° tangent threshold — whereas the kernel emits many
    // samples per arc, making the endpoint segment ≈ the true tangent.
    // Tangent at each arc endpoint is the perpendicular to the radius;
    // neighboring arcs at the shared endpoint have anti-parallel outgoing
    // tangents.
    const r = 10;
    // Sample a quarter arc [a0, a1] (radians) into a fine polyline.
    const quarter = (id: string, a0: number, a1: number) => {
      const N = 32;
      const polyline: Array<[number, number, number]> = [];
      for (let i = 0; i <= N; i++) {
        const t = a0 + (a1 - a0) * (i / N);
        polyline.push([r * Math.cos(t), r * Math.sin(t), 0]);
      }
      return {
        id, isStraight: false,
        endpoints: [polyline[0], polyline[N]] as [[number, number, number], [number, number, number]],
        polyline,
      };
    };
    const H = Math.PI / 2;
    const t = topo(
      quarter('e0', 0, H),         // (r,0) → (0,r)
      quarter('e1', H, 2 * H),     // (0,r) → (-r,0)
      quarter('e2', 2 * H, 3 * H), // (-r,0) → (0,-r)
      quarter('e3', 3 * H, 4 * H), // (0,-r) → (r,0)
    );
    const out = propagateTangentEdges(
      { edgeId: 'e0', start: [r, 0, 0], end: [0, r, 0] },
      t,
    );
    expect(out.map(e => e.edgeId).sort()).toEqual(['e0', 'e1', 'e2', 'e3']);
  });

  it('preserves the seed scope prefix on propagated edge ids', () => {
    // Backend scopes ids as `f<feature>/<edgeId>` so propagation must
    // re-prefix matched neighbors with the same scope.
    const t = topo(
      { id: 'e0', isStraight: true, endpoints: [[0, 0, 0], [10, 0, 0]] },
      { id: 'e1', isStraight: true, endpoints: [[10, 0, 0], [20, 0, 0]] },
    );
    const out = propagateTangentEdges(
      { edgeId: 'f2/e0', start: [0, 0, 0], end: [10, 0, 0] },
      t,
    );
    const ids = out.map(e => e.edgeId).sort();
    expect(ids).toEqual(['f2/e0', 'f2/e1']);
  });

  it('does not loop on a closed tangent chain', () => {
    // Closed tangent chain: a → b → c → a all anti-parallel at each junction.
    // (Two straight segments going opposite ways form a degenerate
    // collinear pair with the third, but the algorithm should terminate
    // either way.)
    const t = topo(
      { id: 'e0', isStraight: true, endpoints: [[0, 0, 0], [10, 0, 0]] },
      { id: 'e1', isStraight: true, endpoints: [[10, 0, 0], [20, 0, 0]] },
      { id: 'e2', isStraight: true, endpoints: [[20, 0, 0], [30, 0, 0]] },
    );
    const out = propagateTangentEdges(
      { edgeId: 'e1', start: [10, 0, 0], end: [20, 0, 0] },
      t,
    );
    expect(out.length).toBe(3);
  });

  it('falls back to endpoint match when the seed id does not exist in topology', () => {
    // Editor passes synthetic `edit#0` ids when re-opening a saved
    // feature — propagation must locate the edge by endpoints instead.
    const t = topo(
      { id: 'e0', isStraight: true, endpoints: [[0, 0, 0], [10, 0, 0]] },
      { id: 'e1', isStraight: true, endpoints: [[10, 0, 0], [20, 0, 0]] },
    );
    const out = propagateTangentEdges(
      { edgeId: 'edit#0', start: [0, 0, 0], end: [10, 0, 0] },
      t,
    );
    expect(out.length).toBe(2);
  });
});
