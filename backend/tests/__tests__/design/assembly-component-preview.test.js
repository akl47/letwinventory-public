// REQ 1082 — the insert preview's geometry: one component's face meshes in its
// own frame, resolved the way an instance tracking the branch would be.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const assemblyRegenService = require('../../../services/assemblyRegenService');

const FACE = {
  persistentName: 'f2#0-f0', faceId: 'f2#0-f0', surface: { kind: 'plane' },
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2],
};

describe('GET /api/design/assembly/component-preview (REQ 1082)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the face meshes of the part resolved at the requested branch', async () => {
    const auth = await authenticatedRequest();
    const seen = [];
    jest.spyOn(assemblyRegenService, 'defaultResolveChild').mockReturnValue(async (instance) => {
      seen.push(instance);
      return { faces: [FACE], vertices: [], edges: [], bodies: [] };
    });
    const res = await auth.get('/api/design/assembly/component-preview?partID=42&branch=draft%2F01');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ faces: [{ positions: FACE.positions, normals: FACE.normals, indices: FACE.indices }] });
    expect(seen[0]).toMatchObject({ partID: 42, ref: { kind: 'cad', branch: 'draft/01' } });
  });

  it('answers 400 for a missing or non-numeric partID', async () => {
    const auth = await authenticatedRequest();
    expect((await auth.get('/api/design/assembly/component-preview')).status).toBe(400);
    expect((await auth.get('/api/design/assembly/component-preview?partID=abc')).status).toBe(400);
  });

  it('answers 422 when the part has no design', async () => {
    const auth = await authenticatedRequest();
    const bare = await createTestPart();
    const res = await auth.get(`/api/design/assembly/component-preview?partID=${bare.id}`);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no design/);
  });
});
