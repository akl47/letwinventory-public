'use strict';

// REQ 905 — doc-version conflict detection on save. The checkout lock only
// guards against other users; two sessions of the same user both hold it and
// previously clobbered each other last-write-wins. The client echoes the
// lastContentSavedAt it last synced; a mismatch is a 409 DOC_CONFLICT.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');

const TREE_A = { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 };
const TREE_B = { features: [{ id: 'f1', type: 'origin' }, { id: 'f2', type: 'extrude', sketchId: 's1', distance: 3, endCondition: { kind: 'blind' } }], nextFeatureSeq: 3 };

describe('CAD model save conflict (REQ 905)', () => {
  let auth, model;

  beforeEach(async () => {
    auth = await authenticatedRequest();
    const part = await createTestPart();
    const created = await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'M' });
    model = created.body;
    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
  });

  test('save chain with matching tokens succeeds and rotates the token', async () => {
    // Fresh model: no content save yet → token is null.
    const first = await auth.put(`/api/design/cad-model/${model.id}`)
      .send({ featureTree: TREE_A, clientSavedAt: null });
    expect(first.status).toBe(200);
    expect(first.body.lastContentSavedAt).toBeTruthy();

    // Echo the rotated token → accepted.
    const second = await auth.put(`/api/design/cad-model/${model.id}`)
      .send({ featureTree: TREE_B, clientSavedAt: first.body.lastContentSavedAt });
    expect(second.status).toBe(200);
  });

  test('stale token is rejected with 409 DOC_CONFLICT and the doc is unchanged', async () => {
    const first = await auth.put(`/api/design/cad-model/${model.id}`)
      .send({ featureTree: TREE_A, clientSavedAt: null });
    expect(first.status).toBe(200);

    // A second session that synced before `first` still holds the null token.
    const conflict = await auth.put(`/api/design/cad-model/${model.id}`)
      .send({ featureTree: TREE_B, clientSavedAt: null });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('DOC_CONFLICT');

    const row = await db.DesignCADModel.findByPk(model.id);
    expect(row.featureTree.features.length).toBe(TREE_A.features.length); // TREE_B not applied
  });

  test('legacy clients that send no token keep last-write-wins behavior', async () => {
    await auth.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_A, clientSavedAt: null });
    const legacy = await auth.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_B });
    expect(legacy.status).toBe(200);
  });

  test('non-content saves (rename) skip the conflict check', async () => {
    await auth.put(`/api/design/cad-model/${model.id}`).send({ featureTree: TREE_A, clientSavedAt: null });
    const rename = await auth.put(`/api/design/cad-model/${model.id}`)
      .send({ name: 'Renamed', clientSavedAt: null }); // stale token but no content fields
    expect(rename.status).toBe(200);
  });
});
