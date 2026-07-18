'use strict';

// Garbage collection for the content-addressed VCS object store (REQ 902).
//
// Branch archive, stash cleanup, and rolled-back releases delete only the REF
// pointer — the commits, trees, blobs, and (large) frozen-geometry objects
// they referenced stay behind forever. This sweep removes objects that are no
// longer reachable and old enough that no in-flight operation can still be
// about to reference them.
//
// Reachability is CONSERVATIVE by construction:
//   - Seeds: every ref (branch + tag) target in the repo, PLUS every
//     `baseCommitHash` held by any working-copy row (a copy can briefly sit
//     on a commit while its ref is being rewritten).
//   - Marking: BFS over reachable objects, treating EVERY 64-char lowercase
//     hex string anywhere in an object's JSON content as a reference. That
//     over-approximates (a user string that happens to look like a hash keeps
//     an object alive — harmless) and can never under-approximate, because
//     all real references (tree entries, commit parents/treeHash, frozen
//     meta's meshHash/brepHash, component children) are stored as plain
//     64-hex strings in JSON content. Binary objects (geometry) reference
//     nothing.
//   - Sweep: delete unreachable objects with createdAt older than the grace
//     window (default 7 days) — recent unreachable objects may belong to an
//     operation that is mid-flight or about to create the referencing ref.
//
// Cadence: daily. Disabled in tests — `initialize()` is only called from
// backend/index.js.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_DAYS = Number(process.env.VCS_GC_GRACE_DAYS) || 7;
const SWEEP_INTERVAL_MS = ONE_DAY_MS;
const DELETE_CHUNK = 500;

const HEX64 = /\b[0-9a-f]{64}\b/g;

let timerHandle = null;

/** Compute the reachable object-hash set for one repo. */
async function reachableSet(repoType, repoId, extraSeeds, db) {
  const D = db || global.db;
  const refs = await D.VcsRef.findAll({
    where: { repoType, repoId },
    attributes: ['targetHash'],
  });
  const reachable = new Set();
  const queue = refs.map((r) => r.targetHash).filter(Boolean);
  for (const s of extraSeeds || []) queue.push(s);
  while (queue.length) {
    const hash = queue.pop();
    if (!hash || reachable.has(hash)) continue;
    reachable.add(hash);
    const row = await D.VcsObject.findOne({
      where: { repoType, repoId, hash },
      attributes: ['content'],
    });
    if (!row || row.content == null) continue; // absent or binary — no outgoing refs
    const matches = JSON.stringify(row.content).match(HEX64);
    if (matches) for (const m of matches) queue.push(m);
  }
  return reachable;
}

/** Sweep one repo: delete unreachable objects older than `cutoff`.
 * Returns the number of rows deleted. */
async function sweepRepo(repoType, repoId, cutoff, extraSeeds, db) {
  const D = db || global.db;
  const { Op } = require('sequelize');
  const reachable = await reachableSet(repoType, repoId, extraSeeds, db);
  const candidates = await D.VcsObject.findAll({
    where: { repoType, repoId, createdAt: { [Op.lt]: cutoff } },
    attributes: ['hash'],
  });
  const doomed = candidates.map((c) => c.hash).filter((h) => !reachable.has(h));
  let deleted = 0;
  for (let i = 0; i < doomed.length; i += DELETE_CHUNK) {
    deleted += await D.VcsObject.destroy({
      where: { repoType, repoId, hash: { [Op.in]: doomed.slice(i, i + DELETE_CHUNK) } },
    });
  }
  return deleted;
}

/** Sweep every repo in the store. Returns total rows deleted. */
async function sweepUnreachableObjects({ graceDays = GRACE_DAYS, now = new Date(), db } = {}) {
  const D = db || global.db;
  if (!D || !D.VcsObject) return 0;
  const cutoff = new Date(now.getTime() - graceDays * ONE_DAY_MS);
  // Extra seeds: any commit a working copy currently sits on. Cheap and
  // repo-agnostic — an unmatched hash in some repo's queue is a no-op.
  const copies = await D.DesignCADModel.findAll({
    where: {},
    attributes: ['baseCommitHash'],
  });
  const extraSeeds = [...new Set(copies.map((m) => m.baseCommitHash).filter(Boolean))];
  const repos = await D.VcsObject.findAll({
    attributes: ['repoType', 'repoId'],
    group: ['repoType', 'repoId'],
    raw: true,
  });
  let total = 0;
  for (const r of repos) {
    total += await sweepRepo(r.repoType, r.repoId, cutoff, extraSeeds, db);
  }
  if (total > 0) {
    console.log(`[VcsGc] deleted ${total} unreachable VCS objects (grace ${graceDays}d)`);
  }
  return total;
}

function initialize() {
  if (timerHandle) return;
  // First sweep shortly after startup (not immediately — let the app settle),
  // then daily.
  const initial = setTimeout(() => {
    sweepUnreachableObjects().catch((err) => console.error('[VcsGc] sweep failed:', err));
  }, 5 * 60 * 1000);
  initial.unref();
  timerHandle = setInterval(() => {
    sweepUnreachableObjects().catch((err) => console.error('[VcsGc] sweep failed:', err));
  }, SWEEP_INTERVAL_MS);
  console.log(`[VcsGc] active — grace ${GRACE_DAYS}d, sweep every ${SWEEP_INTERVAL_MS / 1000}s`);
}

function shutdown() {
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
}

module.exports = { initialize, shutdown, sweepUnreachableObjects, sweepRepo, reachableSet, GRACE_DAYS };
