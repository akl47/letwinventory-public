'use strict';

// Orchestrates a full feature-tree regeneration for a CAD model.
//
// Walks the model's `featureTree`, and for each visible feature:
//   1. extracts the closed loop(s) from the saved `sketchDoc`
//   2. computes a cache key triple (featureId, paramHash, upstreamHash)
//   3. on cache hit, returns the cached tessellated faces immediately
//   4. on cache miss, calls the Rust kernel via `cadKernelClient`,
//      writes the result back to the cache, and returns it
//
// `featureTree` JSONB stays authoritative; `DesignBRepCache` is *derived*
// and can be dropped + rebuilt at any time. See
// `docs/cad-architecture-pivot-plan.md` for the broader design.
//
// Phase 1 v1 limits (extension points called out as TODOs):
//   - Only extrude features. Cut/revolve/sweep/loft land in Phase 2.
//   - upstreamHash is always '' because no current feature kind consumes
//     upstream BRep yet. Cuts/fillets will populate this when they land.
//   - No streaming — returns the full geometry payload in the response.
//     The cadStreamService skeleton is in place for the Phase 1.5
//     incremental-edit path.

const crypto = require('crypto');
const { getDefaultClient } = require('./cadKernelClient');
const { extractClosedLoops } = require('./cadProfile');

const NAMING_VERSION = 1;  // matches NAMING_SCHEMA_VERSION in cad-kernel/src/main.rs

/**
 * @param {object} model    a DesignCADModel Sequelize instance (with featureTree+sketchDoc)
 * @param {object} options  { kernelClient?, db? } (overrides for tests)
 * @returns {Promise<{
 *   features: Array<{ featureId, faces, error?, cached: boolean }>,
 *   errors: string[],
 * }>}
 */
async function regenerateModel(model, { kernelClient, db } = {}) {
  const client = kernelClient || getDefaultClient();
  const dbClient = db || global.db;
  const featureTree = model.featureTree || { features: [] };
  const sketchDoc = model.sketchDoc || { sketches: {} };

  const results = [];
  const errors = [];

  for (const feature of featureTree.features) {
    if (feature.type === 'origin') continue;
    if (feature.visible === false) continue;
    if (feature.type !== 'extrude') {
      // TODO Phase 2: cut, revolve, sweep, loft, fillet, etc.
      errors.push(`feature ${feature.id}: unsupported type '${feature.type}'`);
      continue;
    }

    try {
      const faces = await _regenerateExtrude(feature, sketchDoc, model, client, dbClient);
      results.push({ featureId: feature.id, faces: faces.merged, cached: faces.cached });
    } catch (err) {
      results.push({ featureId: feature.id, faces: [], error: err.message, cached: false });
      errors.push(`feature ${feature.id}: ${err.message}`);
    }
  }

  return { features: results, errors };
}

async function _regenerateExtrude(feature, sketchDoc, model, client, dbClient) {
  const sketch = sketchDoc.sketches[feature.sketchId];
  if (!sketch) throw new Error(`sketch ${feature.sketchId} not found in sketchDoc`);

  const { loops, errors: loopErrors } = extractClosedLoops(sketch.state || { entities: [], constraints: [] });
  if (loops.length === 0) {
    throw new Error(loopErrors[0] || 'no closed loops in sketch');
  }
  const loopIndices = Array.isArray(feature.loopIndices) ? feature.loopIndices : [0];

  // The kernel takes a single profile per call — orchestrate one call per
  // selected loop and merge the resulting faces. Each loop has its own
  // paramHash so independent loop edits don't invalidate each other.
  const mergedFaces = [];
  let allCached = true;

  for (const li of loopIndices) {
    if (li < 0 || li >= loops.length) {
      throw new Error(`loop index ${li} out of range (have ${loops.length})`);
    }
    const profile = loops[li];
    const paramHash = _hashParams({
      profile,
      plane: sketch.plane,
      distance: feature.distance,
      flipped: !!feature.flipped,
      loopIndex: li,
    });
    const upstreamHash = '';  // Phase 1 — no upstream BRep dependency yet

    const cached = await dbClient.DesignBRepCache.findOne({
      where: {
        cadModelID: model.id,
        featureID: `${feature.id}#${li}`,
        paramHash,
        upstreamHash,
        namingVersion: NAMING_VERSION,
      },
    });

    if (cached) {
      // Touch the access timestamp so the idle eviction job ignores us.
      cached.lastAccessedAt = new Date();
      await cached.save();
      mergedFaces.push(...(cached.tessellatedFaces.faces || []));
      continue;
    }

    allCached = false;
    const signedDistance = feature.flipped ? -feature.distance : feature.distance;
    const rpc = await client.call('buildExtrude', {
      featureId: `${feature.id}#${li}`,
      profile,
      plane: sketch.plane,
      distance: Math.abs(signedDistance),
      flipped: signedDistance < 0,
    });

    await dbClient.DesignBRepCache.upsert({
      cadModelID: model.id,
      featureID: `${feature.id}#${li}`,
      paramHash,
      upstreamHash,
      brepBytes: Buffer.from(rpc.brepBytes || '', 'base64'),
      tessellatedFaces: { faces: rpc.faces, topology: rpc.topology },
      namingVersion: NAMING_VERSION,
      lastAccessedAt: new Date(),
    });
    mergedFaces.push(...(rpc.faces || []));
  }

  return { merged: mergedFaces, cached: allCached };
}

/**
 * Stable hash over an arbitrary JSON-serializable object. SHA-256 truncated
 * to 32 hex chars — enough collision resistance for cache keying, short
 * enough to read in logs.
 */
function _hashParams(obj) {
  const json = _canonicalJson(obj);
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 32);
}

function _canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(_canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _canonicalJson(value[k])).join(',') + '}';
}

module.exports = {
  regenerateModel,
  NAMING_VERSION,
};
