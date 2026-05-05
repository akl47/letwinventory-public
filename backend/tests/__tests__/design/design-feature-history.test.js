const { authenticatedRequest, createTestProject } = require('../../helpers');

async function createFeature(auth, projectID, overrides = {}) {
  const res = await auth.post('/api/design/feature').send({
    name: overrides.name || `Feature ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    slug: overrides.slug || `feat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: 'history test',
    markdownBody: 'body',
    projectID,
    ...overrides,
  });
  return res.body;
}

async function createReq(auth, projectID, overrides = {}) {
  const res = await auth.post('/api/design/requirement').send({
    description: 'r', rationale: 'r', verification: 'v', validation: 'v', projectID, ...overrides,
  });
  return res.body;
}

describe('Design Feature History (REQ 303)', () => {
  it('records a created entry on POST', async () => {
    const auth = await authenticatedRequest();
    const project = await createTestProject(auth.user);
    const feature = await createFeature(auth, project.id, { name: 'Hist Feat', slug: 'hist-feat' });

    const res = await auth.get(`/api/design/feature/${feature.id}/history`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].changeType).toBe('created');
    expect(res.body[0].changedByUserID).toBe(auth.user.id);
  });

  it('records an updated entry on PUT with field-level diffs', async () => {
    const auth = await authenticatedRequest();
    const project = await createTestProject(auth.user);
    const feature = await createFeature(auth, project.id, { description: 'Original' });

    await auth.put(`/api/design/feature/${feature.id}`).send({ description: 'New desc' });

    const res = await auth.get(`/api/design/feature/${feature.id}/history`);
    expect(res.body.length).toBe(2);
    const update = res.body[0]; // most recent first
    expect(update.changeType).toBe('updated');
    expect(update.changes.description).toEqual({ from: 'Original', to: 'New desc' });
  });

  it('records submitted/approved/rejected/released changeType for each transition', async () => {
    const auth = await authenticatedRequest();
    const project = await createTestProject(auth.user);
    const feature = await createFeature(auth, project.id);

    await auth.post(`/api/design/feature/${feature.id}/submit`);
    await auth.post(`/api/design/feature/${feature.id}/reject`);
    await auth.post(`/api/design/feature/${feature.id}/submit`);
    await auth.post(`/api/design/feature/${feature.id}/approve`);
    await auth.post(`/api/design/feature/${feature.id}/release`);

    const res = await auth.get(`/api/design/feature/${feature.id}/history`);
    const types = res.body.map(h => h.changeType);
    // most recent first; expect created at the bottom and released at top
    expect(types).toContain('created');
    expect(types).toContain('submitted');
    expect(types).toContain('rejected');
    expect(types).toContain('approved');
    expect(types).toContain('released');
  });

  it('records requirements_linked / requirements_unlinked on link/unlink', async () => {
    const auth = await authenticatedRequest();
    const project = await createTestProject(auth.user);
    const feature = await createFeature(auth, project.id);
    const req1 = await createReq(auth, project.id);

    await auth.post(`/api/design/feature/${feature.id}/link-requirement`).send({ requirementID: req1.id });
    await auth.delete(`/api/design/feature/${feature.id}/link-requirement/${req1.id}`);

    const res = await auth.get(`/api/design/feature/${feature.id}/history`);
    const types = res.body.map(h => h.changeType);
    expect(types).toContain('requirements_linked');
    expect(types).toContain('requirements_unlinked');
  });

  it('history endpoint paginates via offset and limit', async () => {
    const auth = await authenticatedRequest();
    const project = await createTestProject(auth.user);
    const feature = await createFeature(auth, project.id);
    // Generate ~5 history rows via repeated updates
    for (let i = 0; i < 4; i++) {
      await auth.put(`/api/design/feature/${feature.id}`).send({ description: `d${i}` });
    }

    const page1 = await auth.get(`/api/design/feature/${feature.id}/history?limit=2&offset=0`);
    expect(page1.status).toBe(200);
    expect(page1.body.length).toBe(2);

    const page2 = await auth.get(`/api/design/feature/${feature.id}/history?limit=2&offset=2`);
    expect(page2.body.length).toBeGreaterThan(0);
    expect(page2.body[0].id).not.toBe(page1.body[0].id);
  });

  it('includes user info on each row', async () => {
    const auth = await authenticatedRequest();
    const project = await createTestProject(auth.user);
    const feature = await createFeature(auth, project.id);

    const res = await auth.get(`/api/design/feature/${feature.id}/history`);
    expect(res.body[0].changedByUser).toBeDefined();
    expect(res.body[0].changedByUser.displayName).toBe('Test User');
  });
});
