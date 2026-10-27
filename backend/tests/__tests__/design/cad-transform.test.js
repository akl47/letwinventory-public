// Shared rigid-transform math for CAD in-context references (REQ 771).
// Backend twin of frontend/src/app/cad/lib/placementMath.spec.ts — both assert
// against the SAME golden fixture so the two language implementations are proven
// bit-for-bit equivalent (to 1e-9). A Placement is { translate:[x,y,z],
// quaternion:[x,y,z,w] }; relativePlacement(a,b) gives B expressed in A's frame
// (the formula already used inline for lock mates in assemblyMateSolver.js).
const {
  relativePlacement, inverseTransform, composePlacements,
  transformPoint, transformDir,
} = require('../../../services/cadTransform');

// quat from a rotation vector (axis*angle) — same helper as the solver specs.
function quat(rx, ry, rz) {
  const a = Math.hypot(rx, ry, rz);
  if (a < 1e-12) return [0, 0, 0, 1];
  const s = Math.sin(a / 2) / a;
  return [rx * s, ry * s, rz * s, Math.cos(a / 2)];
}

// ── shared golden fixture (identical constants in the frontend spec) ──
const A = { translate: [1, 2, 3], quaternion: quat(0.1, -0.2, 0.3) };
const B = { translate: [-4, 5, 6], quaternion: quat(-0.3, 0.15, 0.05) };
const P = [0.5, -1.5, 2.0];
const GOLD = {
  aQ: [0.049708843324859, -0.099417686649719, 0.149126529974578, 0.982550982155259],
  bQ: [-0.149282282496155, 0.074641141248078, 0.024880380416026, 0.985659407116006],
  relQ: [-0.182068918073385, 0.194829428429794, -0.111410750518179, 0.957329644144734],
  relT: [-3.198704016842145, 4.57049936994628, 3.446567585578235],
  invQ: [-0.049708843324859, 0.099417686649719, -0.149126529974578, 0.982550982155259],
  invT: [-2.132659842260294, -1.802322471624366, -2.490661700329479],
  compQ: [-0.111285988496567, -0.048151975144818, 0.160303234946505, 0.97959159292007],
  compT: [-5.340923240291247, 4.856235797764381, 8.351131611940003],
  tPoint: [1.56119631835412, 0.461042403588139, 4.953629496274052],
};

const closeVec = (actual, expected, digits = 9) => {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i], digits);
};
// quaternions q and -q are the same rotation — compare up to sign.
const closeQuat = (actual, expected, digits = 9) => {
  const flip = expected.map((e, i) => Math.abs(actual[i] - e) > Math.abs(actual[i] + e));
  const sign = flip.filter(Boolean).length > expected.length / 2 ? -1 : 1;
  closeVec(actual.map((v) => v * sign), expected.map((v) => v * sign), digits);
};

describe('cadTransform — shared rigid-transform math (REQ 771)', () => {
  it('fixture quaternions match the canonical convention', () => {
    closeVec(A.quaternion, GOLD.aQ);
    closeVec(B.quaternion, GOLD.bQ);
  });

  it('relativePlacement(A,B) gives B-in-A frame (golden)', () => {
    const r = relativePlacement(A, B);
    closeQuat(r.quaternion, GOLD.relQ);
    closeVec(r.translate, GOLD.relT);
  });

  it('inverseTransform(A) matches golden', () => {
    const inv = inverseTransform(A);
    closeQuat(inv.quaternion, GOLD.invQ);
    closeVec(inv.translate, GOLD.invT);
  });

  it('composePlacements(A,B) = A∘B (golden)', () => {
    const c = composePlacements(A, B);
    closeQuat(c.quaternion, GOLD.compQ);
    closeVec(c.translate, GOLD.compT);
  });

  it('transformPoint(A,p) and transformDir ignore/use translation correctly', () => {
    closeVec(transformPoint(A, P), GOLD.tPoint);
    // dir == point minus the origin's image (translation-free)
    const d = transformDir(A, P);
    closeVec(d, transformPoint(A, P).map((v, i) => v - A.translate[i]));
  });

  it('round-trips: A∘(B-in-A) === B', () => {
    const rel = relativePlacement(A, B);
    const back = composePlacements(A, rel);
    closeVec(back.translate, B.translate);
    closeQuat(back.quaternion, B.quaternion);
  });

  it('inverseTransform is an involution', () => {
    const r = inverseTransform(inverseTransform(A));
    closeVec(r.translate, A.translate);
    closeQuat(r.quaternion, A.quaternion);
  });

  it('composePlacements(A, inverse(A)) === identity', () => {
    const id = composePlacements(A, inverseTransform(A));
    closeVec(id.translate, [0, 0, 0]);
    closeQuat(id.quaternion, [0, 0, 0, 1]);
  });

  it('relativePlacement(A,A) === identity', () => {
    const id = relativePlacement(A, A);
    closeVec(id.translate, [0, 0, 0]);
    closeQuat(id.quaternion, [0, 0, 0, 1]);
  });

  it('point mapping is consistent: rel maps B-local → A-local', () => {
    // a point given in B's local frame, expressed in A's local frame two ways
    const viaRel = transformPoint(relativePlacement(A, B), P);
    const viaWorld = transformPoint(inverseTransform(A), transformPoint(B, P));
    closeVec(viaRel, viaWorld);
  });

  it('direction mapping is consistent and unaffected by translation', () => {
    const d = [0, 1, 0];
    const viaRel = transformDir(relativePlacement(A, B), d);
    const viaWorld = transformDir(inverseTransform(A), transformDir(B, d));
    closeVec(viaRel, viaWorld);
    // adding translation to A or B must not change a direction mapping
    const A2 = { translate: [99, -7, 12], quaternion: A.quaternion };
    const B2 = { translate: [-3, 41, 5], quaternion: B.quaternion };
    closeVec(transformDir(relativePlacement(A2, B2), d), viaRel);
  });
});
