'use strict';

// REQ 704-705 (VC-36, VC-37) — workflow routes + the release gate end-to-end.

const { authenticatedRequest, createTestPart } = require('../../helpers');

describe('CAD workflow routes', () => {
  test('state + transitions; release gated on approval, resets to draft', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;

    const w0 = await auth.get(`/api/design/cad-model/${model.id}/workflow`);
    expect(w0.status).toBe(200);
    expect(w0.body.state).toBe('draft');

    // Release before approval is blocked.
    expect((await auth.post(`/api/design/cad-model/${model.id}/release`)).status).toBe(409);

    // submit → approve.
    expect((await auth.post(`/api/design/cad-model/${model.id}/workflow`).send({ action: 'submit' })).body.state).toBe('in_review');
    expect((await auth.post(`/api/design/cad-model/${model.id}/workflow`).send({ action: 'approve' })).body.state).toBe('approved');

    // Release now succeeds and the workflow resets to draft for the next cycle.
    expect((await auth.post(`/api/design/cad-model/${model.id}/release`)).status).toBe(200);
    expect((await auth.get(`/api/design/cad-model/${model.id}/workflow`)).body.state).toBe('draft');
  });
});
