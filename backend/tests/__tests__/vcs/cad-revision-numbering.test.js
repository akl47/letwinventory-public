'use strict';

// Regression: the FIRST release of a freshly-created part must release IN PLACE
// at the part's current (unreleased) revision, not skip to the next number.
//
// Released revisions are write-once VCS tags — the part's INITIAL revision
// ("01" for internal parts, "00" for external) is NOT a release. The old code
// derived the next revision from Parts.revision (which already includes that
// unreleased initial), so an internal part sitting at "01" released as "02",
// skipping "01" entirely.

const { authenticatedRequest, createTestPart } = require('../../helpers');

describe('CAD release revision numbering', () => {
  async function createReleasableModel(auth, part) {
    // by-part seeds main + auto-creates/checks-in draft/01, so the model is
    // immediately releasable (no kernel round-trip needed).
    return (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({})).body;
  }

  test('first release of an internal part ("01") is "01", not "02"', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart({ internalPart: true }); // initial revision "01"
    const model = await createReleasableModel(auth, part);

    const rel = await auth.post(`/api/design/cad-model/${model.id}/release`);
    expect(rel.status).toBe(200);
    expect(rel.body.revision).toBe('01');
    expect(rel.body.model.released).toBe(true);
    expect(rel.body.model.displayRevision).toBe('01');
  });

  test('first release of an external part ("00") is "01"', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart(); // initial revision "00"
    const model = await createReleasableModel(auth, part);

    const rel = await auth.post(`/api/design/cad-model/${model.id}/release`);
    expect(rel.status).toBe(200);
    expect(rel.body.revision).toBe('01');
  });
});
