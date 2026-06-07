# cadCacheEvictionService — BRep Cache Eviction

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Regeneration Pipeline](../regen-pipeline.md) ▸ **cadCacheEvictionService**
> Related: [cadRegenService](./cadRegenService.md)

---

## Requirements

Requirements: governed by [Regeneration Pipeline](../regen-pipeline.md). No dedicated REQ for cache eviction; it is operational infrastructure keeping the `DesignBRepCache` table from growing unboundedly.

---

## Succinct description

`cadCacheEvictionService.js` runs a periodic `DELETE` against `DesignBRepCache`, dropping rows whose `lastAccessedAt` is older than a configurable TTL (default 14 days). The regen path bumps `lastAccessedAt` on every cache hit, so actively-used rows survive indefinitely.

## How it works — for everyone (non-technical)

Every time the server recalculates a piece of geometry, it saves the result in a cache table so the next request for the same geometry is instant. But when a designer edits a parameter, the old cached result is no longer needed and just takes up space. This service sweeps through once an hour and deletes anything that hasn't been used in the last two weeks.

## How it works — in detail (technical)

### Exports

```javascript
module.exports = { initialize, shutdown, evictStaleEntries, MAX_AGE_DAYS };
```

### `initialize()`

Called once from `backend/index.js` at server startup. Sets up:

1. An immediate run of `evictStaleEntries()` so freshly-deployed servers don't carry stale rows from a previous deployment.
2. A `setInterval` every `ONE_HOUR_MS` (3600000 ms) to repeat the sweep.

Not called from Jest setup — tests bypass the eviction clock entirely.

### `evictStaleEntries(now?, db?) → Promise<number>`

```javascript
const cutoff = new Date(now - MAX_AGE_DAYS * ONE_DAY_MS);
await db.DesignBRepCache.destroy({ where: { lastAccessedAt: { [Op.lt]: cutoff } } });
```

`MAX_AGE_DAYS` defaults to 14, overridden by `CAD_BREP_CACHE_TTL_DAYS`. The `now` and `db` parameters are injectable for testing.

Returns the count of deleted rows (logged at info level when > 0).

### `shutdown()`

Clears the interval timer. Called from the graceful-shutdown handler in `backend/index.js`.

### Cache invalidation model

The eviction service handles **idle** rows. **Stale** rows (cache entries whose `namingVersion` no longer matches `NAMING_VERSION` in `cadRegenService.js`) are handled implicitly — the regen service queries with `namingVersion: NAMING_VERSION` so old-version rows are simply ignored and never `lastAccessedAt`-touched, causing them to age out naturally.

---

## Key files

- `backend/services/cadCacheEvictionService.js` — this module
- `backend/models/design/designBrepCache.js` — `DesignBRepCache` Sequelize model with `lastAccessedAt` column
- `backend/services/cadRegenService.js` — updates `lastAccessedAt` on every cache hit; `NAMING_VERSION` controls cache schema compatibility
