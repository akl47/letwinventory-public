const fs = require('fs');
const os = require('os');
const path = require('path');
const { authenticatedRequest, createTestProject } = require('../../helpers');

/**
 * Tests for scripts/migrate-feature-docs.js (REQ 311).
 * The script ingests docs/features/*.md and creates DesignFeature rows,
 * linking any matching requirements via designFeatureID.
 *
 * The script exposes a programmatic entrypoint for testing via:
 *   require('../../../scripts/migrate-feature-docs').run({ dir, dryRun, baseURL, token })
 */

let migrate;
beforeAll(() => {
  migrate = require('../../../../scripts/migrate-feature-docs');
});

function writeFixture(dir, filename, content) {
  fs.writeFileSync(path.join(dir, filename), content, 'utf8');
}

describe('migrate-feature-docs.js (REQ 311)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-docs-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dry-run reports planned features without writing to the DB', async () => {
    writeFixture(tmpDir, 'kitting.md', '# Kitting\n\nThis feature implements REQ 193 and REQ 194.\n');
    const auth = await authenticatedRequest();

    const result = await migrate.run({
      dir: tmpDir,
      dryRun: true,
      auth,
    });

    expect(result.planned).toHaveLength(1);
    expect(result.planned[0].slug).toBe('kitting');
    expect(result.planned[0].name).toBe('Kitting');
    expect(result.created).toHaveLength(0);

    const list = await auth.get('/api/design/feature');
    expect(list.body.find(f => f.slug === 'kitting')).toBeUndefined();
  });

  it('creates a DesignFeature record per MD file with correct fields', async () => {
    writeFixture(tmpDir, 'build.md', '# Build\n\nFirst paragraph.\n\nSecond paragraph.\n');
    const auth = await authenticatedRequest();

    const result = await migrate.run({ dir: tmpDir, auth });

    expect(result.created).toHaveLength(1);
    const created = result.created[0];
    expect(created.slug).toBe('build');
    expect(created.name).toBe('Build');
    expect(created.markdownBody).toContain('# Build');
    expect(created.reviewState).toBe('released');
  });

  it('links requirements found via REQ N references in body', async () => {
    const auth = await authenticatedRequest();
    const project = await createTestProject(auth.user);
    const r1 = await auth.post('/api/design/requirement').send({
      description: 'r1', rationale: 'r', verification: 'v', validation: 'v', projectID: project.id,
    });
    const r2 = await auth.post('/api/design/requirement').send({
      description: 'r2', rationale: 'r', verification: 'v', validation: 'v', projectID: project.id,
    });

    const reqIDs = [r1.body.id, r2.body.id];
    writeFixture(tmpDir, 'kitting.md',
      `# Kitting\n\nThis feature touches REQ ${reqIDs[0]} and REQ ${reqIDs[1]}.\n`);

    const result = await migrate.run({ dir: tmpDir, auth, projectID: project.id });
    expect(result.created).toHaveLength(1);
    const featureID = result.created[0].id;

    for (const reqID of reqIDs) {
      const reqRes = await auth.get(`/api/design/requirement/${reqID}`);
      expect(reqRes.body.designFeatureID).toBe(featureID);
    }
  });

  it('parses REQ N–M ranges in body', async () => {
    const auth = await authenticatedRequest();
    const project = await createTestProject(auth.user);
    const reqs = [];
    for (let i = 0; i < 3; i++) {
      const r = await auth.post('/api/design/requirement').send({
        description: `r${i}`, rationale: 'r', verification: 'v', validation: 'v', projectID: project.id,
      });
      reqs.push(r.body.id);
    }
    const lo = reqs[0];
    const hi = reqs[reqs.length - 1];

    writeFixture(tmpDir, 'kitting.md', `# Kitting\n\nrequirements created (REQ ${lo}–${hi})\n`);

    const result = await migrate.run({ dir: tmpDir, auth, projectID: project.id });
    const featureID = result.created[0].id;

    for (const reqID of reqs) {
      const reqRes = await auth.get(`/api/design/requirement/${reqID}`);
      expect(reqRes.body.designFeatureID).toBe(featureID);
    }
  });

  it('is idempotent on re-run by slug', async () => {
    writeFixture(tmpDir, 'kitting.md', '# Kitting\n\nbody\n');
    const auth = await authenticatedRequest();

    const first = await migrate.run({ dir: tmpDir, auth });
    expect(first.created).toHaveLength(1);

    const second = await migrate.run({ dir: tmpDir, auth });
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toContain('kitting');

    const list = await auth.get('/api/design/feature');
    const kittingRows = list.body.filter(f => f.slug === 'kitting');
    expect(kittingRows.length).toBe(1);
  });

  it('warns on REQ N references that do not exist in the DB but does not fail', async () => {
    writeFixture(tmpDir, 'orphan.md', '# Orphan\n\nReferences REQ 999999 which does not exist.\n');
    const auth = await authenticatedRequest();

    const result = await migrate.run({ dir: tmpDir, auth });
    expect(result.created).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.join('\n')).toMatch(/999999/);
  });
});
