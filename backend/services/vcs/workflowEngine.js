'use strict';

// Phase 4 (REQ 703-706 / VC-35..38) — a generic, declarative workflow engine.
// A transition table per repoType defines states + permission-guarded
// transitions; state is stored per (repoType, repoId) in VcsWorkflowState.
// transition() validates the move from the current state, checks the actor's
// permission (reusing loadEffectivePermissions), advances the state, and fires
// a best-effort notification hook. Adding a new entity's workflow = adding a
// table entry — nothing else.

const RestError = require('../../util/RestError');
const { loadEffectivePermissions } = require('../../middleware/checkPermission');
const notificationService = require('../notificationService');

// Declarative transition tables. CAD: draft → in_review → approved.
const WORKFLOWS = {
  cad: {
    initial: 'draft',
    states: ['draft', 'in_review', 'approved'],
    transitions: [
      { action: 'submit', from: 'draft', to: 'in_review', permission: 'cad.write', notify: 'reviewers' },
      { action: 'approve', from: 'in_review', to: 'approved', permission: 'cad.approve', notify: 'author' },
      { action: 'reject', from: 'in_review', to: 'draft', permission: 'cad.approve', notify: 'author' },
      { action: 'reopen', from: 'approved', to: 'draft', permission: 'cad.write' },
    ],
  },
};

function dbOf(db) { return db || global.db; }

function workflowFor(repoType) {
  const w = WORKFLOWS[repoType];
  if (!w) throw new RestError(`No workflow is defined for repo type "${repoType}"`, 400);
  return w;
}

/** Current workflow state for a repo (the initial state if none is stored). */
async function getState(repo, db) {
  const D = dbOf(db);
  const row = await D.VcsWorkflowState.findOne({ where: { repoType: repo.repoType, repoId: String(repo.repoId) } });
  return row ? row.state : workflowFor(repo.repoType).initial;
}

/** Set the workflow state directly (used by release to reset to draft). */
async function setState(repo, state, userId, db) {
  const D = dbOf(db);
  await D.VcsWorkflowState.upsert({
    repoType: repo.repoType, repoId: String(repo.repoId), state, updatedByUserID: userId || null, updatedAt: new Date(),
  });
  return state;
}

/** Transitions available from the current state for which the user is permitted. */
async function availableActions(repo, userId, db) {
  const w = workflowFor(repo.repoType);
  const state = await getState(repo, db);
  const perms = await loadEffectivePermissions(userId);
  return w.transitions
    .filter(t => t.from === state && perms.has(t.permission))
    .map(t => ({ action: t.action, to: t.to }));
}

// Notification hook — injectable so tests can observe it; default routes to the
// existing push-notification service, best-effort.
const _defaultNotifier = async (repo, t, actorUserID, ctx) => {
  if (t.notify === 'author' && ctx && ctx.authorUserID) {
    await notificationService.sendPushToUser(ctx.authorUserID, {
      title: 'CAD model review', body: `Your model was ${t.to.replace('_', ' ')}.`,
    });
  }
  // 'reviewers' would notify cad.approve holders — left as a hook point.
};
let _notifier = _defaultNotifier;
function setNotifier(fn) { _notifier = fn || _defaultNotifier; }

/** Perform a workflow transition. Throws 409 if invalid from the current state,
 * 403 if the actor lacks the transition's permission (VC-36). Fires the notify
 * hook best-effort (a hook failure never fails the transition, VC-38). */
async function transition(repo, action, userId, ctx = {}, db) {
  const w = workflowFor(repo.repoType);
  const state = await getState(repo, db);
  const t = w.transitions.find(x => x.action === action && x.from === state);
  if (!t) throw new RestError(`Transition "${action}" is not allowed from state "${state}"`, 409);
  const perms = await loadEffectivePermissions(userId);
  if (!perms.has(t.permission)) throw new RestError(`You lack the ${t.permission} permission required for "${action}"`, 403);
  await setState(repo, t.to, userId, db);
  try { await _notifier(repo, t, userId, ctx, db); } catch (e) { /* best-effort */ }
  return { state: t.to, action };
}

/** Whether a repo's workflow permits release (state === approved, VC-37). */
async function canRelease(repo, db) {
  return (await getState(repo, db)) === 'approved';
}

module.exports = { WORKFLOWS, getState, setState, availableActions, transition, canRelease, setNotifier };
