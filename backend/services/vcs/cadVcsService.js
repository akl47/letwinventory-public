'use strict';

// Phase 1 (REQ 677-688) — CAD-facing VCS operations over the working copy.
// The DesignCADModel row is the editable working copy; this service maps
// checkout / check-in / lock / history onto the generic vcsService object store
// and the cadSerializer binding. No HTTP here — the controller wraps these.

const RestError = require('../../util/RestError');
const vcs = require('./vcsService');
const { makeWorkingCopy } = require('./vcsWorkingCopy');
const { makeRelease } = require('./vcsRelease');
const { cadSerialize, cadDeserialize } = require('./cadSerializer');
const freeze = require('./cadFreezeService');
const { NAMING_VERSION } = require('../cadRegenService');
const { resolveEdgeRef } = require('../cadExternalRef');
const { transformPoint } = require('../cadTransform');

const DEFAULT_LOCK_TTL_MS = Number(process.env.CAD_LOCK_TTL_MS) || 30 * 60 * 1000; // 30 min

function dbOf(db) { return db || global.db; }
// `at` lets tests drive time deterministically; production passes nothing.
function nowAt(at) { return at ? new Date(at) : new Date(); }

/** Kernel + naming versions stamped into every commit (REQ 683 / VC-15). */
function cadVersionInfo() {
  return { kernelVersion: `occt-naming-${NAMING_VERSION}`, namingVersion: NAMING_VERSION };
}

/** The repo for a model = (cad, lineage-root partID). Walks Part
 * previousRevisionID so history is continuous across Part revisions (VC-20). */
async function repoForModel(model, db) {
  const D = dbOf(db);
  let part = await D.Part.findByPk(model.partID);
  const seen = new Set();
  while (part && part.previousRevisionID && !seen.has(part.id)) {
    seen.add(part.id);
    const prev = await D.Part.findByPk(part.previousRevisionID);
    if (!prev) break;
    part = prev;
  }
  return { repoType: 'cad', repoId: String(part ? part.id : model.partID) };
}

/** Zero-padded 2-digit numeric revision string (matches partRevisionService). */
function padNumeric(n) { return String(n).padStart(2, '0'); }

/** Highest RELEASED numeric revision in the lineage = the max numeric revision
 * among LOCKED `Parts` rows for this name. Releasing a revision locks its Part
 * (`revisionLocked=true`) — for both CAD and assembly — so locked rows are the
 * released ones. A freshly-created part carries an UNLOCKED initial revision
 * ("01" for internal parts, "00" for external) which must NOT count, otherwise
 * the first release skips a number (internal "01" → "02"). Kind-agnostic (no
 * repo needed, unlike tags whose repoType differs for assemblies). 0 when
 * nothing has been released yet. */
async function highestReleasedNumeric(model, db) {
  const D = dbOf(db);
  const part = await D.Part.findByPk(model.partID);
  if (!part) return 0;
  const rows = await D.Part.findAll({ where: { name: part.name, revisionLocked: true }, attributes: ['revision'] });
  const nums = rows.map((p) => p.revision).filter((s) => /^\d+$/.test(s)).map((s) => parseInt(s, 10));
  return nums.length ? Math.max(...nums) : 0;
}

/** The numeric revision a draft branch would release as = highest part revision
 * + 1. Derived, not stored — so every concurrent draft branch shows the SAME
 * number, and it bumps as soon as a new revision is released/created. */
async function derivedDraftRev(model, db) {
  return padNumeric((await highestReleasedNumeric(model, db)) + 1);
}

/** Seed a brand-new repo: commit the model's current doc to `main` with no
 * parent and create the `main` ref. No-op (returns the existing head) if `main`
 * already exists. `main` is protected thereafter — it only advances via the
 * submit → approve → release path. Returns the main head commit hash. */
function docOf(model) {
  return {
    featureTree: model.featureTree,
    sketchDoc: model.sketchDoc,
    equations: model.equations || { entries: {} },
  };
}

// Working-copy ops (seed / checkout / undo / check-in / lock / history) are
// written once in vcsWorkingCopy; bind them here to the CAD document shape.
const wc = makeWorkingCopy({
  noun: 'model',
  repoFor: repoForModel,
  docOf,
  serialize: cadSerialize,
  deserialize: cadDeserialize,
  applyDoc: (model, doc) => ({ featureTree: doc.featureTree, sketchDoc: doc.sketchDoc, equations: doc.equations }),
  commitMeta: cadVersionInfo,
});

const seedMain = (model, userId, opts = {}, db) => wc.seedMain(model, userId, opts, db);
const checkout = (model, userId, opts = {}, db) => wc.checkout(model, userId, opts, db);
const releaseLock = (model, userId, opts = {}, db) => wc.releaseLock(model, userId, opts, db);
const undoCheckout = (model, userId, db) => wc.undoCheckout(model, userId, db);
// REQ 774 — pin every cross-part in-context reference to the source part's CURRENT
// commit so a historical/released revision of THIS part reconstructs the referenced
// geometry exactly as it was at check-in. Mutates the refs' pinnedSourceCommit in
// place (so the pin lands in the serialized blob) and persists the working copy.
// Returns the pinned refs for the post-commit component/usage records.
async function pinCrossPartRefs(model, db) {
  const D = dbOf(db);
  const sketchDoc = model.sketchDoc;
  if (!sketchDoc || !sketchDoc.sketches || !D || !D.DesignCADModel) return [];
  const pinned = [];
  let changed = false;
  for (const sketch of Object.values(sketchDoc.sketches)) {
    for (const c of (sketch.state && sketch.state.constraints) || []) {
      const er = c.externalRef;
      if (c.type !== 'on-edge' || !er || er.scope !== 'cross-part') continue;
      const sourceModel = await D.DesignCADModel.findOne({ where: { partID: er.sourcePartId, activeFlag: true, isAssembly: false } });
      if (!sourceModel) continue;
      const repoB = await repoForModel(sourceModel, D);
      const ref = await vcs.getRef(repoB, sourceModel.branchName || 'main', D);
      if (!ref) continue;
      if (er.pinnedSourceCommit !== ref.targetHash) { er.pinnedSourceCommit = ref.targetHash; changed = true; }
      pinned.push({ repoB, commitHash: ref.targetHash, instanceId: er.sourceInstanceId || null });
    }
  }
  if (changed) { model.changed('sketchDoc', true); await model.update({ sketchDoc }); }
  return pinned;
}

// Check-in (REQ 680) + cross-part pinning (REQ 774): pin source commits, commit,
// then record a content-addressed `component` object and a `VcsUsage` edge per
// referenced source so impact analysis ("which parts pin B?") and exact historical
// reconstruction both work.
const checkin = async (model, userId, message, opts = {}, db) => {
  const D = dbOf(db);
  const pinned = await pinCrossPartRefs(model, D);
  const result = await wc.checkin(model, userId, message, opts, D);
  if (pinned.length) {
    const repoA = await repoForModel(model, D);
    for (const p of pinned) {
      await vcs.putObject(repoA, { kind: 'component', content: {
        childRepoType: p.repoB.repoType, childRepoId: p.repoB.repoId,
        instanceId: p.instanceId, ref: { commitHash: p.commitHash },
      } }, D);
      if (D.VcsUsage) {
        await D.VcsUsage.create({
          childRepoType: p.repoB.repoType, childRepoId: p.repoB.repoId,
          parentRepoType: repoA.repoType, parentRepoId: repoA.repoId,
          parentCommitHash: result.commitHash, instanceId: p.instanceId,
        });
      }
    }
  }
  return result;
};

// REQ 774 — resolve a cross-part ref at its PINNED source commit (zero kernel when
// that commit is frozen), used when reconstructing a historical/released revision
// of the dependent part rather than the live working copy.
function makePinnedResolver({ db, kernelClient } = {}) {
  return async (externalRef) => {
    const D = dbOf(db);
    const commitHash = externalRef && externalRef.pinnedSourceCommit;
    if (!commitHash || !D || !D.DesignCADModel) return null;
    const sourceModel = await D.DesignCADModel.findOne({ where: { partID: externalRef.sourcePartId, activeFlag: true, isAssembly: false } });
    if (!sourceModel) return null;
    const repoB = await repoForModel(sourceModel, D);
    let geo;
    try { geo = await freeze.geometryForCommit(repoB, sourceModel, commitHash, { kernelClient }, D); } catch (e) { return null; }
    const m = resolveEdgeRef((geo && geo.bodies) || [], externalRef.sourceGeomRef || {}, externalRef.fallback);
    if (!m) return null;
    const edge = m.edge;
    const poly = edge.polyline && edge.polyline.length >= 2 ? edge.polyline
      : (edge.endpoints && edge.endpoints.length === 2 ? edge.endpoints : null);
    if (!poly) return null;
    const rel = externalRef.cachedProjection && externalRef.cachedProjection.relPlacement;
    return rel
      ? { polyline: poly.map((p) => transformPoint(rel, p)), isStraight: edge.isStraight }
      : { polyline: poly, isStraight: edge.isStraight };
  };
}

// Release-the-revision is written once in vcsRelease; bind it to the CAD doc.
const { release } = makeRelease({
  repoFor: repoForModel,
  serialize: cadSerialize,
  docOf,
  freeze,
  commitMeta: cadVersionInfo,
});

/** Development release (REQ 715-718): self-service. The design must be checked
 * in; freeze + write-once-tag the current numeric Part revision, then lock the
 * design read-only (releaseLocked) and the Part (revisionLocked). No approval. */
async function devRelease(model, userId, { kernelClient, at } = {}, db) {
  const D = dbOf(db);
  if (model.releaseLocked) throw new RestError('This revision is already released and locked', 409);
  if (model.dirty || !model.baseCommitHash) {
    throw new RestError('Check in the design before releasing it', 409);
  }
  const part = await D.Part.findByPk(model.partID);
  const revision = part && part.revision;
  if (!revision) throw new RestError('Part has no revision to release as', 400);
  const { commitHash, tag } = await release(model, userId, revision, { kernelClient, at }, db);
  await model.update({ releaseLocked: true });
  if (!part.revisionLocked) await part.update({ revisionLocked: true });
  return { commitHash, tag };
}

/** Flag the working copy as having uncommitted edits (autosave path, VC-13). */
async function markDirty(model, db) {
  if (!model.dirty) await model.update({ dirty: true });
  return model;
}

/** Ordered commit history for the model's branch (newest first), or []. */
const history = (model, db) => wc.history(model, db);

/** Clear locks whose expiry has passed (stale-lock sweep, REQ 679). */
async function sweepExpiredLocks(at, db) {
  const D = dbOf(db);
  const { Op } = D.Sequelize;
  const [count] = await D.DesignCADModel.update(
    { lockedByUserID: null, lockedAt: null, lockExpiresAt: null },
    { where: { lockedByUserID: { [Op.ne]: null }, lockExpiresAt: { [Op.lt]: nowAt(at) } } },
  );
  return count;
}

// ── Commit thumbnails (REQ 710) ───────────────────────────────────────────────
// A low-resolution PNG captured client-side from the model's default view at
// check-in. Stored as a binary object keyed by a synthetic `thumb-<commit>`
// address (deterministic per commit, not content-addressed) so the version
// history can show each commit instantly without a kernel regeneration.

// Thumbnails are keyed by their commit but must fit VcsObject.hash (varchar 64).
// A literal `thumb-<64-char-hash>` is 70 chars and silently fails to insert on
// Postgres, so derive a 64-char key by hashing. Deterministic per commit.
function thumbKey(commitHash) {
  return require('crypto').createHash('sha256').update(`thumb:${commitHash}`).digest('hex');
}

/** Decode a `data:image/...;base64,...` URL (or a raw base64 string) to a Buffer. */
function decodeThumbnail(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 && dataUrl.startsWith('data:') ? dataUrl.slice(comma + 1) : dataUrl;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

/** Store the thumbnail PNG for a commit (no-op on empty/invalid input). */
async function storeThumbnail(model, commitHash, dataUrl, db) {
  const buf = decodeThumbnail(dataUrl);
  if (!buf) return null;
  const D = dbOf(db);
  const repo = await repoForModel(model, db);
  await D.VcsObject.findOrCreate({
    where: { repoType: repo.repoType, repoId: String(repo.repoId), hash: thumbKey(commitHash) },
    defaults: { kind: 'thumbnail', content: null, bytes: buf, size: buf.length },
  });
  return commitHash;
}

/** Load a commit's thumbnail PNG bytes, or null if none was captured. */
async function loadThumbnail(model, commitHash, db) {
  const D = dbOf(db);
  const repo = await repoForModel(model, db);
  const row = await D.VcsObject.findOne({
    where: { repoType: repo.repoType, repoId: String(repo.repoId), hash: thumbKey(commitHash) },
  });
  return row && row.bytes != null ? Buffer.from(row.bytes) : null;
}

module.exports = {
  DEFAULT_LOCK_TTL_MS,
  cadVersionInfo,
  repoForModel,
  padNumeric,
  highestReleasedNumeric,
  derivedDraftRev,
  seedMain,
  checkout,
  releaseLock,
  undoCheckout,
  checkin,
  release,
  devRelease,
  markDirty,
  history,
  sweepExpiredLocks,
  storeThumbnail,
  loadThumbnail,
  // cross-part in-context pinning + historical resolution (REQ 774)
  pinCrossPartRefs,
  makePinnedResolver,
};
