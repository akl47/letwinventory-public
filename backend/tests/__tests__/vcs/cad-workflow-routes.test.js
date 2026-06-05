'use strict';

// Workflow routes (REQ 704-705): per-branch review transitions. Release-to-main
// is SELF-SERVICE (no approval gate) — the approval workflow gates the separate
// production-letter release, not the numeric release onto main.

const { authenticatedRequest, createTestPart } = require('../../helpers');

describe('CAD workflow routes', () => {
  test('review transitions work on a draft branch; release-to-main is self-service', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;

    expect((await auth.get(`/api/design/cad-model/${model.id}/workflow`)).body.state).toBe('draft');
    // Review transitions still function on the draft branch (used for the
    // production gate once on main).
    expect((await auth.post(`/api/design/cad-model/${model.id}/workflow`).send({ action: 'submit' })).body.state).toBe('in_review');
    expect((await auth.post(`/api/design/cad-model/${model.id}/workflow`).send({ action: 'reject' })).body.state).toBe('draft');

    // Release straight from the draft branch — no submit/approve required.
    expect((await auth.post(`/api/design/cad-model/${model.id}/release`)).status).toBe(200);
  });
});
