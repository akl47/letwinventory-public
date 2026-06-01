'use strict';

// Phase 4 (REQ 703-706 / VC-35..38) — declarative workflow engine.

const { createTestUser } = require('../../helpers');
const db = require('../../../models');
const wf = require('../../../services/vcs/workflowEngine');

const REPO = { repoType: 'cad', repoId: '999' };

async function grant(userID, actions) {
  const perms = await db.Permission.findAll({ where: { resource: 'cad' } });
  await db.UserPermission.bulkCreate(perms.filter(p => actions.includes(p.action)).map(p => ({ userID, permissionID: p.id })));
}

describe('workflowEngine', () => {
  let writer, approver;
  beforeEach(async () => {
    writer = await createTestUser({ displayName: 'wf-writer' });
    await grant(writer.id, ['read', 'write']);
    approver = await createTestUser({ displayName: 'wf-approver' });
    await grant(approver.id, ['read', 'write', 'approve']);
  });
  afterEach(() => wf.setNotifier(null)); // restore default notifier

  test('initial state is draft (VC-35)', async () => {
    expect(await wf.getState(REPO)).toBe('draft');
  });

  test('submit → approve transitions with the right permissions (VC-36)', async () => {
    expect((await wf.transition(REPO, 'submit', writer.id)).state).toBe('in_review');
    expect(await wf.getState(REPO)).toBe('in_review');
    expect((await wf.transition(REPO, 'approve', approver.id)).state).toBe('approved');
    expect(await wf.getState(REPO)).toBe('approved');
  });

  test('rejects a transition the actor is not permitted to make (VC-36)', async () => {
    await wf.transition(REPO, 'submit', writer.id);
    await expect(wf.transition(REPO, 'approve', writer.id)).rejects.toMatchObject({ statusCode: 403 });
  });

  test('rejects an invalid transition from the current state (VC-36)', async () => {
    await expect(wf.transition(REPO, 'approve', approver.id)).rejects.toMatchObject({ statusCode: 409 });
  });

  test('availableActions reflects state + permissions', async () => {
    expect((await wf.availableActions(REPO, writer.id)).map(a => a.action)).toEqual(['submit']);
    await wf.transition(REPO, 'submit', writer.id);
    expect((await wf.availableActions(REPO, writer.id)).map(a => a.action)).toEqual([]); // writer can't approve/reject
    expect((await wf.availableActions(REPO, approver.id)).map(a => a.action).sort()).toEqual(['approve', 'reject']);
  });

  test('fires the notify hook; a failing hook never fails the transition (VC-38)', async () => {
    const calls = [];
    wf.setNotifier(async (repo, t, actor) => { calls.push({ action: t.action, actor }); throw new Error('boom'); });
    const r = await wf.transition(REPO, 'submit', writer.id);
    expect(r.state).toBe('in_review');
    expect(calls).toEqual([{ action: 'submit', actor: writer.id }]);
  });

  test('canRelease only when approved (VC-37)', async () => {
    expect(await wf.canRelease(REPO)).toBe(false);
    await wf.transition(REPO, 'submit', writer.id);
    await wf.transition(REPO, 'approve', approver.id);
    expect(await wf.canRelease(REPO)).toBe(true);
  });
});
