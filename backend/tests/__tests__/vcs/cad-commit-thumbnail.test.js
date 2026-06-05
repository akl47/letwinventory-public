'use strict';

// REQ 710 — a low-resolution thumbnail captured at check-in is stored with the
// commit and served as a PNG so the version history can show it instantly.

const { authenticatedRequest, createTestPart } = require('../../helpers');

async function createModel(auth, partId) {
  const r = await auth.post(`/api/design/cad-model/by-part/${partId}`).send({ name: 'M' });
  return r.body;
}

// A 1x1 transparent PNG as a data URL — stands in for the viewer capture.
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const DATA_URL = `data:image/png;base64,${PNG_1PX}`;

describe('CAD commit thumbnails', () => {
  test('stores a thumbnail at check-in and serves it as a PNG', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(auth, part.id);

    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    const ci = await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'first', thumbnail: DATA_URL });
    expect(ci.status).toBe(200);
    const hash = ci.body.commitHash;
    expect(hash).toBeTruthy();

    const thumb = await auth.get(`/api/design/cad-model/${model.id}/commits/${hash}/thumbnail`)
      .buffer(true).parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(thumb.status).toBe(200);
    expect(thumb.headers['content-type']).toMatch(/image\/png/);
    // The served bytes equal the decoded PNG.
    expect(Buffer.from(thumb.body).equals(Buffer.from(PNG_1PX, 'base64'))).toBe(true);
  });

  test('404 when a commit has no thumbnail', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(auth, part.id);

    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    const ci = await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'no-thumb' });
    expect(ci.status).toBe(200);

    const thumb = await auth.get(`/api/design/cad-model/${model.id}/commits/${ci.body.commitHash}/thumbnail`);
    expect(thumb.status).toBe(404);
  });

  test('an invalid thumbnail does not fail the check-in', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const model = await createModel(auth, part.id);

    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    const ci = await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'bad-thumb', thumbnail: 'not-a-data-url' });
    expect(ci.status).toBe(200);
    expect(ci.body.commitHash).toBeTruthy();
  });
});
