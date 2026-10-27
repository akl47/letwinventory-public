'use strict';

// Phase 4 (REQ 703-706 / VC-35..38) — a generic, declarative workflow engine.
// A transition table per repoType defines states + permission-guarded
// transitions; state is stored per (repoType, repoId) in VcsWorkflowState.
// transition() validates the move from the current state, checks the actor's
// permission (reusing loadEffectivePermissions), advances the state, and fires
// a best-effort notification hook. Adding a new entity's workflow = adding a
// table entry — nothing else.
//
// Review hardening (2026-10-26):
//   REQ 947 — an approval records the commit it reviewed (ctx.commitHash);
//             canRelease(repo, db, commitHash) requires a match.
//   REQ 949 — the submitter is recorded and may not approve/reject their own
//             submission.
//   REQ 950 — submit notifies every active cad.approve holder but the submitter.

const RestError = require('../../util/RestError');
const { loadEffectivePermissions } = require('../../middleware/checkPermission');
const notificationService = require('../notificationService');

// Declarative transition tables. CAD: draft → in_review → approved.
// `independent: true` = the actor must not be the recorded submitter.
const CAD_WORKFLOW = {
  initial: 'draft',
  states: ['draft', 'in_review', 'approved'],
  transitions: [
    { action: 'submit', from: 'draft', to: 'in_review', permission: 'cad.write', notify: 'reviewers' },
    { action: 'approve', from: 'in_review', to: 'approved', permission: 'cad.approve', notify: 'author', independent: true },
    { action: 'reject', from: 'in_review', to: 'draft', permission: 'cad.approve', notify: 'author', independent: true },
    { action: 'reopen', from: 'approved', to: 'draft', permission: 'cad.write' },
  ],
};
// Assemblies share the same review workflow + the `cad` permission resource.
const WORKFLOWS = { cad: CAD_WORKFLOW, assembly: CAD_WORKFLOW };

function dbOf(db) { return db || global.db; }

function workflowFor(repoType) {
  const w = WORKFLOWS[repoType];
  if (!w) throw new RestError(`No workflow is defined for repo type "${repoType}"`, 400);
  return w;
}

async function getRow(repo, db) {
  const D = dbOf(db);
  return D.VcsWorkflowState.findOne({ where: { repoType: repo.repoType, repoId: String(repo.repoId) } });
}

/** Current workflow state for a repo (the initial state if none is stored). */
async function getState(repo, db) {
  const row = await getRow(repo, db);
  return row ? row.state : workflowFor(repo.repoType).initial;
}

/** Set the workflow state directly (used by release to reset to draft).
 * `extra` carries approvedCommitHash / submittedByUserID; both are cleared
 * unless supplied, so a reset never carries a stale approval forward. */
async function setState(repo, state, userId, db, extra = {}) {
  const D = dbOf(db);
  await D.VcsWorkflowState.upsert({
    repoType: repo.repoType, repoId: String(repo.repoId), state, updatedByUserID: userId || null, updatedAt: new Date(),
    approvedCommitHash: extra.approvedCommitHash || null,
    submittedByUserID: extra.submittedByUserID || null,
  });
  return state;
}

// REQ 943 — callers pass the REQUEST's effective permissions (user ∩ API-key
// scope, computed by checkPermission) so an API key can never exercise a
// permission it was not scoped to. Re-loading the user's full set is only the
// fallback for internal callers with no request context.
async function permsFor(userId, perms) {
  return perms instanceof Set ? perms : loadEffectivePermissions(userId);
}

/** Transitions available from the current state for which the user is permitted. */
async function availableActions(repo, userId, db, perms) {
  const w = workflowFor(repo.repoType);
  const row = await getRow(repo, db);
  const state = row ? row.state : w.initial;
  perms = await permsFor(userId, perms);
  return w.transitions
    .filter(t => t.from === state && perms.has(t.permission))
    .filter(t => !(t.independent && row && row.submittedByUserID === userId))
    .map(t => ({ action: t.action, to: t.to }));
}

// Active users holding cad.approve (directly or via an active group).
async function reviewerIds(db) {
  const D = dbOf(db);
  const perm = await D.Permission.findOne({ where: { resource: 'cad', action: 'approve' } });
  if (!perm) return [];
  const ids = new Set();
  for (const up of await D.UserPermission.findAll({ where: { permissionID: perm.id } })) ids.add(up.userID);
  const groupIds = (await D.GroupPermission.findAll({ where: { permissionID: perm.id } })).map((g) => g.groupID);
  if (groupIds.length) {
    const members = await D.UserGroupMember.findAll({
      where: { groupID: groupIds },
      include: [{ model: D.UserGroup, as: 'group', where: { activeFlag: true }, attributes: ['id'], required: true }],
    });
    for (const m of members) ids.add(m.userID);
  }
  if (!ids.size) return [];
  const active = await D.User.findAll({ where: { id: [...ids], activeFlag: true }, attributes: ['id'] });
  return active.map((u) => u.id);
}

// Notification hook — injectable so tests can observe it; default routes to the
// existing push-notification service, best-effort.
const _defaultNotifier = async (repo, t, actorUserID, ctx, db) => {
  if (t.notify === 'author' && ctx && ctx.authorUserID) {
    await notificationService.sendPushToUser(ctx.authorUserID, {
      title: 'CAD model review', body: `Your model was ${t.to.replace('_', ' ')}.`,
    });
  }
  if (t.notify === 'reviewers') {
    const name = (ctx && ctx.modelName) || 'A CAD model';
    for (const id of await reviewerIds(db)) {
      if (id === actorUserID) continue;
      try {
        await notificationService.sendPushToUser(id, { title: 'CAD review requested', body: `${name} was submitted for review.` });
      } catch (e) { /* best-effort per recipient */ }
    }
  }
};
let _notifier = _defaultNotifier;
function setNotifier(fn) { _notifier = fn || _defaultNotifier; }

/** Perform a workflow transition. Throws 409 if invalid from the current state,
 * 403 if the actor lacks the transition's permission (VC-36) or is reviewing
 * their own submission (REQ 949). Fires the notify hook best-effort (a hook
 * failure never fails the transition, VC-38). `ctx.commitHash` is the commit
 * under review — recorded on approve (REQ 947). */
async function transition(repo, action, userId, ctx = {}, db) {
  const w = workflowFor(repo.repoType);
  const row = await getRow(repo, db);
  const state = row ? row.state : w.initial;
  const t = w.transitions.find(x => x.action === action && x.from === state);
  if (!t) throw new RestError(`Transition "${action}" is not allowed from state "${state}"`, 409);
  const perms = await permsFor(userId, ctx.permissions);
  if (!perms.has(t.permission)) throw new RestError(`You lack the ${t.permission} permission required for "${action}"`, 403);
  if (t.independent && row && row.submittedByUserID && row.submittedByUserID === userId) {
    throw new RestError(`You submitted this review, so a different reviewer must ${action} it`, 403);
  }
  const extra = {};
  if (t.action === 'submit') extra.submittedByUserID = userId;
  if (t.action === 'approve') {
    extra.submittedByUserID = row ? row.submittedByUserID : null;
    extra.approvedCommitHash = ctx.commitHash || null;
  }
  await setState(repo, t.to, userId, db, extra);
  try { await _notifier(repo, t, userId, ctx, db); } catch (e) { /* best-effort */ }
  return { state: t.to, action };
}

/** Whether a repo's workflow permits release (state === approved, VC-37).
 * REQ 947 — when `commitHash` is given, the approval must be for that commit. */
async function canRelease(repo, db, commitHash) {
  const row = await getRow(repo, db);
  if (!row || row.state !== 'approved') return false;
  if (commitHash === undefined) return true;
  return !!row.approvedCommitHash && row.approvedCommitHash === commitHash;
}

module.exports = { WORKFLOWS, getState, setState, availableActions, transition, canRelease, setNotifier, reviewerIds };
