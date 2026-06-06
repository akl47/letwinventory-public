const { solveMates } = require('../../../services/assemblyMateSolver');

function quat(rx, ry, rz) {
  const angle = Math.hypot(rx, ry, rz);
  if (angle < 1e-12) return [0, 0, 0, 1];
  const s = Math.sin(angle / 2) / angle;
  return [rx * s, ry * s, rz * s, Math.cos(angle / 2)];
}
const inst = (id, translate, grounded = false, q = [0, 0, 0, 1]) => ({ id, translate, quaternion: q, grounded });
const plane = (instanceId, origin, normal) => ({ instanceId, geom: { kind: 'plane', origin, normal } });
const axis = (instanceId, origin, direction, radius) => ({ instanceId, geom: { kind: 'axis', origin, direction, radius } });

describe('assemblyMateSolver.solveMates (REQ 755-757)', () => {
  it('coincident: mates a free part onto a grounded face', () => {
    const A = inst('A', [0, 0, 0], true);
    const B = inst('B', [7, 3, 30]);
    const mate = { id: 'm1', type: 'coincident', a: plane('A', [0, 0, 10], [0, 0, 1]), b: plane('B', [0, 0, 0], [0, 0, -1]) };
    const r = solveMates([A, B], [mate]);
    expect(r.converged).toBe(true);
    expect(r.poses.B.translate[2]).toBeCloseTo(10, 3);
    expect(r.poses.B.translate[0]).toBeCloseTo(7, 3);
    expect(r.poses.A.translate).toEqual([0, 0, 0]);
    expect(r.dof).toBe(3);
    expect(r.state).toBe('under');
  });

  it('concentric: aligns two cylinder axes coaxially', () => {
    const A = inst('A', [0, 0, 0], true);
    const B = inst('B', [5, 5, 0]);
    const mate = { id: 'm1', type: 'concentric', a: axis('A', [0, 0, 0], [0, 0, 1], 3), b: axis('B', [0, 0, 0], [0, 0, 1], 3) };
    const r = solveMates([A, B], [mate]);
    expect(r.converged).toBe(true);
    expect(r.poses.B.translate[0]).toBeCloseTo(0, 3);
    expect(r.poses.B.translate[1]).toBeCloseTo(0, 3);
    expect(r.dof).toBe(2);
    expect(r.state).toBe('under');
  });

  it('distance: holds a parameterized gap', () => {
    const A = inst('A', [0, 0, 0], true);
    const B = inst('B', [0, 0, 50]);
    const mate = { id: 'm1', type: 'distance', value: 12, a: plane('A', [0, 0, 0], [0, 0, 1]), b: plane('B', [0, 0, 0], [0, 0, -1]) };
    const r = solveMates([A, B], [mate]);
    expect(r.converged).toBe(true);
    expect(r.poses.B.translate[2]).toBeCloseTo(12, 3);
  });

  it('fully constrained: three perpendicular coincident mates lock all 6 DOF', () => {
    const A = inst('A', [0, 0, 0], true);
    const B = inst('B', [3, -2, 5], false, quat(0.15, -0.1, 0.2));
    const mates = [
      { id: 'mx', type: 'coincident', a: plane('A', [0, 0, 0], [1, 0, 0]), b: plane('B', [0, 0, 0], [-1, 0, 0]) },
      { id: 'my', type: 'coincident', a: plane('A', [0, 0, 0], [0, 1, 0]), b: plane('B', [0, 0, 0], [0, -1, 0]) },
      { id: 'mz', type: 'coincident', a: plane('A', [0, 0, 0], [0, 0, 1]), b: plane('B', [0, 0, 0], [0, 0, -1]) },
    ];
    const r = solveMates([A, B], mates);
    expect(r.converged).toBe(true);
    expect(r.poses.B.translate[0]).toBeCloseTo(0, 2);
    expect(r.poses.B.translate[1]).toBeCloseTo(0, 2);
    expect(r.poses.B.translate[2]).toBeCloseTo(0, 2);
    expect(r.dof).toBe(0);
    expect(r.state).toBe('fully');
  });

  it('over-constrained: two conflicting distance mates are flagged', () => {
    const A = inst('A', [0, 0, 0], true);
    const B = inst('B', [0, 0, 30]);
    const mates = [
      { id: 'd1', type: 'distance', value: 10, a: plane('A', [0, 0, 0], [0, 0, 1]), b: plane('B', [0, 0, 0], [0, 0, -1]) },
      { id: 'd2', type: 'distance', value: 20, a: plane('A', [0, 0, 0], [0, 0, 1]), b: plane('B', [0, 0, 0], [0, 0, -1]) },
    ];
    const r = solveMates([A, B], mates);
    expect(r.converged).toBe(false);
    expect(r.residualNorm).toBeGreaterThan(1);
    expect(r.state).toBe('over');
  });

  it('lock: holds the relative pose as a rigid group', () => {
    const A = inst('A', [0, 0, 0], true);
    const B = inst('B', [10, 0, 0]);
    const mate = { id: 'lk', type: 'lock', a: plane('A', [0, 0, 0], [0, 0, 1]), b: plane('B', [0, 0, 0], [0, 0, 1]) };
    const r = solveMates([A, B], [mate]);
    expect(r.converged).toBe(true);
    expect(r.poses.B.translate[0]).toBeCloseTo(10, 3);
    expect(r.dof).toBe(0);
    expect(r.state).toBe('fully');
  });
});
