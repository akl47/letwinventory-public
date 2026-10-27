import { describe, it, expect } from 'vitest';
import { solveMates, type SolverInstance, type Mate, type Vec3, type Quat } from './mateSolver';

// Quaternion from a rotation vector (axis * angle) — local helper for test setup.
function quat(rx: number, ry: number, rz: number): Quat {
  const angle = Math.hypot(rx, ry, rz);
  if (angle < 1e-12) return [0, 0, 0, 1];
  const s = Math.sin(angle / 2) / angle;
  return [rx * s, ry * s, rz * s, Math.cos(angle / 2)];
}

function inst(id: string, translate: Vec3, grounded = false, q: Quat = [0, 0, 0, 1]): SolverInstance {
  return { id, translate, quaternion: q, grounded };
}

function plane(instanceId: string, origin: Vec3, normal: Vec3): Mate['a'] {
  return { instanceId, geom: { kind: 'plane', origin, normal } };
}

function axis(instanceId: string, origin: Vec3, direction: Vec3, radius?: number): Mate['a'] {
  return { instanceId, geom: { kind: 'axis', origin, direction, radius } };
}

describe('solveMates', () => {
  it('coincident: mates a free part onto a grounded face (anti-parallel normals, zero separation)', () => {
    const A = inst('A', [0, 0, 0], true);                 // grounded
    const B = inst('B', [7, 3, 30]);                      // floating, 20mm above the target
    const mate: Mate = {
      id: 'm1', type: 'coincident',
      a: plane('A', [0, 0, 10], [0, 0, 1]),               // A's top face at z=10, normal +z
      b: plane('B', [0, 0, 0], [0, 0, -1]),               // B's bottom face, normal -z
    };
    const r = solveMates([A, B], [mate]);
    expect(r.converged).toBe(true);
    expect(r.residualNorm).toBeLessThan(1e-4);
    // B's bottom face lands on A's top face → B origin at z = 10.
    expect(r.poses['B'].translate[2]).toBeCloseTo(10, 3);
    // x/y and the spin about z are unconstrained → left where they started.
    expect(r.poses['B'].translate[0]).toBeCloseTo(7, 3);
    expect(r.poses['B'].translate[1]).toBeCloseTo(3, 3);
    // Grounded part never moves.
    expect(r.poses['A'].translate).toEqual([0, 0, 0]);
    // 6 DOF − 3 constrained (1 translation + 2 rotation) = 3 remaining.
    expect(r.dof).toBe(3);
    expect(r.state).toBe('under');
  });

  it('concentric: aligns two cylinder axes coaxially', () => {
    const A = inst('A', [0, 0, 0], true);
    const B = inst('B', [5, 5, 0]);                       // axis offset by (5,5) in xy
    const mate: Mate = {
      id: 'm1', type: 'concentric',
      a: axis('A', [0, 0, 0], [0, 0, 1], 3),
      b: axis('B', [0, 0, 0], [0, 0, 1], 3),
    };
    const r = solveMates([A, B], [mate]);
    expect(r.converged).toBe(true);
    // Axes become coincident → B's xy offset removed.
    expect(r.poses['B'].translate[0]).toBeCloseTo(0, 3);
    expect(r.poses['B'].translate[1]).toBeCloseTo(0, 3);
    // Slide along the axis + spin about it remain free: 2 DOF.
    expect(r.dof).toBe(2);
    expect(r.state).toBe('under');
  });

  it('distance: holds a parameterized gap between two faces', () => {
    const A = inst('A', [0, 0, 0], true);
    const B = inst('B', [0, 0, 50]);
    const mate: Mate = {
      id: 'm1', type: 'distance', value: 12,
      a: plane('A', [0, 0, 0], [0, 0, 1]),
      b: plane('B', [0, 0, 0], [0, 0, -1]),
    };
    const r = solveMates([A, B], [mate]);
    expect(r.converged).toBe(true);
    expect(r.poses['B'].translate[2]).toBeCloseTo(12, 3);
  });

  it('fully constrained: three perpendicular coincident mates lock all 6 DOF', () => {
    const A = inst('A', [0, 0, 0], true);
    // Start B displaced and tilted so the solver must recover the origin pose.
    const B = inst('B', [3, -2, 5], false, quat(0.15, -0.1, 0.2));
    const mates: Mate[] = [
      { id: 'mx', type: 'coincident', a: plane('A', [0, 0, 0], [1, 0, 0]), b: plane('B', [0, 0, 0], [-1, 0, 0]) },
      { id: 'my', type: 'coincident', a: plane('A', [0, 0, 0], [0, 1, 0]), b: plane('B', [0, 0, 0], [0, -1, 0]) },
      { id: 'mz', type: 'coincident', a: plane('A', [0, 0, 0], [0, 0, 1]), b: plane('B', [0, 0, 0], [0, 0, -1]) },
    ];
    const r = solveMates([A, B], mates);
    expect(r.converged).toBe(true);
    expect(r.residualNorm).toBeLessThan(1e-4);
    expect(r.poses['B'].translate[0]).toBeCloseTo(0, 2);
    expect(r.poses['B'].translate[1]).toBeCloseTo(0, 2);
    expect(r.poses['B'].translate[2]).toBeCloseTo(0, 2);
    // Orientation back to identity (w ≈ ±1).
    expect(Math.abs(r.poses['B'].quaternion[3])).toBeCloseTo(1, 2);
    expect(r.dof).toBe(0);
    expect(r.state).toBe('fully');
  });

  it('over-constrained: two conflicting distance mates on the same faces are flagged', () => {
    const A = inst('A', [0, 0, 0], true);
    const B = inst('B', [0, 0, 30]);
    const mates: Mate[] = [
      { id: 'd1', type: 'distance', value: 10, a: plane('A', [0, 0, 0], [0, 0, 1]), b: plane('B', [0, 0, 0], [0, 0, -1]) },
      { id: 'd2', type: 'distance', value: 20, a: plane('A', [0, 0, 0], [0, 0, 1]), b: plane('B', [0, 0, 0], [0, 0, -1]) },
    ];
    const r = solveMates([A, B], mates);
    // The two demands (z=10 and z=20) cannot both be met.
    expect(r.converged).toBe(false);
    expect(r.residualNorm).toBeGreaterThan(1);
    expect(r.state).toBe('over');
  });

  it('lock: holds the relative pose of two parts as a rigid group', () => {
    const A = inst('A', [0, 0, 0], true);
    const B = inst('B', [10, 0, 0]);
    const mate: Mate = {
      id: 'lk', type: 'lock',
      a: plane('A', [0, 0, 0], [0, 0, 1]),
      b: plane('B', [0, 0, 0], [0, 0, 1]),
    };
    const r = solveMates([A, B], [mate]);
    expect(r.converged).toBe(true);
    // Lock pins all 6 relative DOF; B is fully determined by A.
    expect(r.poses['B'].translate[0]).toBeCloseTo(10, 3);
    expect(r.dof).toBe(0);
    expect(r.state).toBe('fully');
  });
});
