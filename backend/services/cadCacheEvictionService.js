'use strict';

// Idle eviction of `DesignBRepCache` rows.
//
// Why: the cache is keyed by (featureId, paramHash, upstreamHash) and each
// parameter edit creates a new row while the old one becomes unreachable.
// Without eviction the table grows monotonically.
//
// Policy: drop rows whose `lastAccessedAt` is older than `MAX_AGE_DAYS`. The
// regen path bumps `lastAccessedAt` on every cache hit, so anything still
// in active use survives indefinitely. Cold rows for old parameter values
// fall off.
//
// Cadence: runs once an hour. The cost is a single DELETE with an indexed
// timestamp filter, so cadence-vs-thoroughness isn't a meaningful tradeoff.
//
// Disabled in tests — `initialize()` is only called from `backend/index.js`
// and never from Jest setup.

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_DAYS = Number(process.env.CAD_BREP_CACHE_TTL_DAYS) || 14;

let timerHandle = null;

async function evictStaleEntries(now = new Date(), db = global.db) {
  if (!db || !db.DesignBRepCache) return 0;
  const { Op } = require('sequelize');
  const cutoff = new Date(now.getTime() - MAX_AGE_DAYS * ONE_DAY_MS);
  const deleted = await db.DesignBRepCache.destroy({
    where: { lastAccessedAt: { [Op.lt]: cutoff } },
  });
  if (deleted > 0) {
    console.log(`[CadCacheEviction] dropped ${deleted} BRep cache rows older than ${MAX_AGE_DAYS}d`);
  }
  return deleted;
}

function initialize() {
  if (timerHandle) return;
  // Run once on startup so freshly-deployed servers don't carry over a stale
  // cache, then on interval.
  evictStaleEntries().catch(err => console.error('[CadCacheEviction] initial run failed:', err));
  timerHandle = setInterval(() => {
    evictStaleEntries().catch(err => console.error('[CadCacheEviction] eviction failed:', err));
  }, ONE_HOUR_MS);
  console.log(`[CadCacheEviction] active — TTL ${MAX_AGE_DAYS}d, sweep every ${ONE_HOUR_MS / 1000}s`);
}

function shutdown() {
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
}

module.exports = { initialize, shutdown, evictStaleEntries, MAX_AGE_DAYS };
