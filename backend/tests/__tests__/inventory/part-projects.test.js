'use strict';

// REQ 1069 — parts link to projects (many-to-many) and can be marked common.

const { authenticatedRequest, createTestPart, createTestProject } = require('../../helpers');
const db = require('../../../models');

const url = (id) => `/api/inventory/part/${id}/projects`;

describe('Part projects', () => {
  it('links a part to several projects and returns them with the part', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const a = await createTestProject(auth.user, { name: 'Alpha' });
    const b = await createTestProject(auth.user, { name: 'Beta' });

    const res = await auth.put(url(part.id)).send({ projectIDs: [a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.body.projects.map((p) => p.name).sort()).toEqual(['Alpha', 'Beta']);
    expect(res.body.commonPart).toBe(false);

    const got = await auth.get(`/api/inventory/part/${part.id}`);
    expect(got.body.projects.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    const listed = (await auth.get('/api/inventory/part')).body.find((p) => p.id === part.id);
    expect(listed.projects).toHaveLength(2);
  });

  it('lets one project hold several parts', async () => {
    const auth = await authenticatedRequest();
    const project = await createTestProject(auth.user);
    const p1 = await createTestPart();
    const p2 = await createTestPart();
    await auth.put(url(p1.id)).send({ projectIDs: [project.id] });
    await auth.put(url(p2.id)).send({ projectIDs: [project.id] });
    expect(await db.PartProject.count({ where: { projectID: project.id } })).toBe(2);
  });

  it('replaces the links, and clears them with an empty list', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const a = await createTestProject(auth.user, { name: 'Alpha' });
    const b = await createTestProject(auth.user, { name: 'Beta' });
    await auth.put(url(part.id)).send({ projectIDs: [a.id] });
    const replaced = await auth.put(url(part.id)).send({ projectIDs: [b.id, b.id] });
    expect(replaced.body.projects.map((p) => p.name)).toEqual(['Beta']);
    const cleared = await auth.put(url(part.id)).send({ projectIDs: [] });
    expect(cleared.body.projects).toEqual([]);
  });

  it('marks a part common without touching its project links', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const a = await createTestProject(auth.user);
    await auth.put(url(part.id)).send({ projectIDs: [a.id] });
    const res = await auth.put(url(part.id)).send({ commonPart: true });
    expect(res.body.commonPart).toBe(true);
    expect(res.body.projects).toHaveLength(1);
    expect((await auth.get(`/api/inventory/part/${part.id}`)).body.commonPart).toBe(true);
  });

  it('allows changes on a revision-locked part', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart({ revisionLocked: true });
    const a = await createTestProject(auth.user);
    const res = await auth.put(url(part.id)).send({ projectIDs: [a.id], commonPart: true });
    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(1);
  });

  it('rejects an unknown project by id and changes nothing', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const a = await createTestProject(auth.user);
    await auth.put(url(part.id)).send({ projectIDs: [a.id] });
    const res = await auth.put(url(part.id)).send({ projectIDs: [a.id, 987654] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Project 987654 does not exist');
    expect(await db.PartProject.count({ where: { partID: part.id } })).toBe(1);
  });

  it('rejects malformed input and an unknown part', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    expect((await auth.put(url(part.id)).send({ projectIDs: 'all' })).status).toBe(400);
    expect((await auth.put(url(part.id)).send({ commonPart: 'yes' })).status).toBe(400);
    expect((await auth.put(url(999999)).send({ projectIDs: [] })).status).toBe(404);
  });

  it('records the change in the part history, once', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart();
    const a = await createTestProject(auth.user, { name: 'Alpha' });
    await auth.put(url(part.id)).send({ projectIDs: [a.id], commonPart: true });
    await auth.put(url(part.id)).send({ projectIDs: [a.id], commonPart: true }); // no change
    const history = await db.PartRevisionHistory.findAll({ where: { partID: part.id, changeType: 'updated' } });
    expect(history).toHaveLength(1);
    expect(history[0].changes).toEqual({ projects: { old: [], new: ['Alpha'] }, commonPart: { old: false, new: true } });
  });

  it('carries the links and the common mark to a new revision', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart({ internalPart: true });
    const a = await createTestProject(auth.user);
    await auth.put(url(part.id)).send({ projectIDs: [a.id], commonPart: true });
    const rev = await auth.post(`/api/inventory/part/${part.id}/new-revision`);
    expect(rev.status).toBe(200);
    const got = await auth.get(`/api/inventory/part/${rev.body.id}`);
    expect(got.body.commonPart).toBe(true);
    expect(got.body.projects.map((p) => p.id)).toEqual([a.id]);
  });

  it('an ordinary part save needs no common mark and leaves it and the links alone', async () => {
    const auth = await authenticatedRequest();
    const part = await createTestPart({ name: 'KeepLinks' });
    const a = await createTestProject(auth.user);
    await auth.put(url(part.id)).send({ projectIDs: [a.id], commonPart: true });
    const res = await auth.put(`/api/inventory/part/${part.id}`).send({
      name: 'KeepLinks', description: 'Edited', internalPart: false, vendor: 'TestVendor', minimumOrderQuantity: 1,
      partCategoryID: 1, serialNumberRequired: false, lotNumberRequired: false, manufacturer: 'TestMfg', manufacturerPN: 'MFG-001',
    });
    expect(res.status).toBe(200);
    const got = await auth.get(`/api/inventory/part/${part.id}`);
    expect(got.body.description).toBe('Edited');
    expect(got.body.commonPart).toBe(true);
    expect(got.body.projects.map((p) => p.id)).toEqual([a.id]);
  });

  it('requires parts write permission', async () => {
    const auth = await authenticatedRequest(undefined, { grantPermissions: false });
    const part = await createTestPart();
    expect((await auth.put(url(part.id)).send({ projectIDs: [] })).status).toBe(403);
  });
});
