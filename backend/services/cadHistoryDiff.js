'use strict';

// REQ 959 — autosave history records WHAT changed (ids/names), not two full
// copies of the document per save. The version-control store already holds
// full content at every check-in; this summary is the audit trail between.

const { canonicalJson } = require('./vcs/canonicalJson');

function same(a, b) { return canonicalJson(a === undefined ? null : a) === canonicalJson(b === undefined ? null : b); }

function diffKeyed(prevMap, nextMap) {
  const prev = prevMap || {}; const next = nextMap || {};
  const added = []; const removed = []; const modified = [];
  for (const k of Object.keys(next)) {
    if (!(k in prev)) added.push(k);
    else if (!same(prev[k], next[k])) modified.push(k);
  }
  for (const k of Object.keys(prev)) if (!(k in next)) removed.push(k);
  return { added, removed, modified };
}

const byId = (list) => Object.fromEntries((list || []).filter((x) => x && x.id).map((x) => [x.id, x]));

/** Summarize a content save. Fields absent from `next` were not saved. */
function summarizeDocChange(prev, next) {
  const out = {};
  if (next.featureTree !== undefined) {
    out.features = diffKeyed(byId(prev.featureTree && prev.featureTree.features), byId(next.featureTree && next.featureTree.features));
  }
  if (next.sketchDoc !== undefined) {
    out.sketches = diffKeyed(prev.sketchDoc && prev.sketchDoc.sketches, next.sketchDoc && next.sketchDoc.sketches);
  }
  if (next.equations !== undefined) {
    out.equations = diffKeyed(prev.equations && prev.equations.entries, next.equations && next.equations.entries);
  }
  if (next.name !== undefined && next.name !== prev.name) out.name = { from: prev.name || null, to: next.name };
  return out;
}

/** Parse ?limit/&offset for history endpoints (default 100, max 500). */
function historyPage(query) {
  const limit = Math.min(500, Math.max(1, parseInt(query && query.limit, 10) || 100));
  const offset = Math.max(0, parseInt(query && query.offset, 10) || 0);
  return { limit, offset };
}

module.exports = { summarizeDocChange, historyPage };
