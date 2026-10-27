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

// REQ 966 — only PNGs (by signature) up to 512 KB are stored, and the
// thumbnail endpoint sends nosniff.
describe('Commit thumbnail validation (REQ 966)', () => {
  const cadvcs = require('../../../services/vcs/cadVcsService');

  async function checkinWith(auth, thumbnail) {
    const part = await createTestPart();
    const model = await createModel(auth, part.id);
    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
    const ci = await auth.post(`/api/design/cad-model/${model.id}/checkin`).send({ message: 'x', thumbnail });
    expect(ci.status).toBe(200); // a rejected thumbnail never fails the check-in
    return { model, hash: ci.body.commitHash };
  }

  test('an SVG (script-capable) upload is not stored', async () => {
    const auth = await authenticatedRequest();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    const { model, hash } = await checkinWith(auth, `data:image/svg+xml;base64,${svg}`);
    expect((await auth.get(`/api/design/cad-model/${model.id}/commits/${hash}/thumbnail`)).status).toBe(404);
  });

  test('an oversized PNG is not stored', async () => {
    const auth = await authenticatedRequest();
    const big = Buffer.concat([Buffer.from(PNG_1PX, 'base64'), Buffer.alloc(cadvcs.MAX_THUMBNAIL_BYTES)]);
    const { model, hash } = await checkinWith(auth, `data:image/png;base64,${big.toString('base64')}`);
    expect((await auth.get(`/api/design/cad-model/${model.id}/commits/${hash}/thumbnail`)).status).toBe(404);
  });

  test('a valid PNG is served with nosniff', async () => {
    const auth = await authenticatedRequest();
    const { model, hash } = await checkinWith(auth, DATA_URL);
    const res = await auth.get(`/api/design/cad-model/${model.id}/commits/${hash}/thumbnail`);
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('signature check unit cases', () => {
    expect(cadvcs.isAcceptableThumbnail(Buffer.from(PNG_1PX, 'base64'))).toBe(true);
    expect(cadvcs.isAcceptableThumbnail(Buffer.from('GIF89a....'))).toBe(false);
    expect(cadvcs.isAcceptableThumbnail(null)).toBe(false);
  });
});
