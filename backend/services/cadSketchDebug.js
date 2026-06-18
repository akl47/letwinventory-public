// CAD sketch-change diagnostic logger.
//
// Every live sketch edit in the editor lands here: onSketchChanged → debounced
// save() → PUT /api/design/cad-model/:id with the full sketchDoc. This module
// diffs the previously-persisted sketchDoc against the incoming one and logs a
// concise, human-readable summary of exactly what changed — which entities and
// constraints were added, removed, or modified — instead of dumping the whole
// JSON blob on every keystroke-batch.
//
// Quiet by default: it only emits when a sketch actually changed (no output when
// a save carries only featureTree/equations changes). Disable with
// CAD_SKETCH_DEBUG=0 in the environment.

const ENABLED = process.env.CAD_SKETCH_DEBUG !== '0' && process.env.CAD_SKETCH_DEBUG !== 'false';
const PREFIX = '[sketch-debug]';

function sketchesOf(doc) {
  return (doc && doc.sketches && typeof doc.sketches === 'object') ? doc.sketches : {};
}

function stateOf(sketch) {
  const state = sketch && sketch.state ? sketch.state : {};
  return {
    entities: Array.isArray(state.entities) ? state.entities : [],
    constraints: Array.isArray(state.constraints) ? state.constraints : [],
  };
}

function byId(arr) {
  const map = new Map();
  for (const item of arr) {
    if (item && item.id != null) map.set(item.id, item);
  }
  return map;
}

const round = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);

// Short geometry summary for a single entity.
function entitySummary(e) {
  if (!e) return '?';
  const c = e.construction ? ' (construction)' : '';
  switch (e.kind) {
    case 'point': return `point#${e.id} (${round(e.x)}, ${round(e.y)})${c}`;
    case 'line': return `line#${e.id} ${e.startId}→${e.endId}${c}`;
    case 'circle': return `circle#${e.id} center=${e.centerId} r=${round(e.radius)}${c}`;
    case 'arc': return `arc#${e.id} center=${e.centerId} ${e.startId}→${e.endId} r=${round(e.radius)} ${e.ccw ? 'ccw' : 'cw'}${c}`;
    default: return `${e.kind}#${e.id}${c}`;
  }
}

function targetsSummary(targets) {
  if (!Array.isArray(targets)) return '';
  return targets
    .map((t) => (t && t.sub ? `${t.entityId}.${t.sub}` : (t && t.entityId) || JSON.stringify(t)))
    .join(', ');
}

function constraintSummary(c) {
  if (!c) return '?';
  const val = c.value != null ? ` =${round(c.value)}${c.unit ? c.unit : ''}` : '';
  const driven = c.driven ? ' (driven)' : '';
  return `${c.type}#${c.id} [${targetsSummary(c.targets)}]${val}${driven}`;
}

// Keys whose change is worth reporting per entity kind. Falls back to comparing
// every own enumerable key for unknown kinds.
function changedFields(prev, next) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  keys.delete('id');
  keys.delete('kind');
  const out = [];
  for (const k of keys) {
    const a = JSON.stringify(prev ? prev[k] : undefined);
    const b = JSON.stringify(next ? next[k] : undefined);
    if (a !== b) {
      out.push(`${k}: ${a ?? '∅'} → ${b ?? '∅'}`);
    }
  }
  return out;
}

// Diff two arrays of {id,...} items keyed by id. Returns { added, removed, modified }.
function diffById(prevArr, nextArr) {
  const prev = byId(prevArr);
  const next = byId(nextArr);
  const added = [];
  const removed = [];
  const modified = [];
  for (const [id, item] of next) {
    if (!prev.has(id)) added.push(item);
    else if (JSON.stringify(prev.get(id)) !== JSON.stringify(item)) {
      modified.push({ before: prev.get(id), after: item });
    }
  }
  for (const [id, item] of prev) {
    if (!next.has(id)) removed.push(item);
  }
  return { added, removed, modified };
}

function logSketchDiff({ modelId, userId, prevDoc, nextDoc }) {
  if (!ENABLED) return;

  const prevSketches = sketchesOf(prevDoc);
  const nextSketches = sketchesOf(nextDoc);
  const ids = new Set([...Object.keys(prevSketches), ...Object.keys(nextSketches)]);

  const lines = [];

  for (const sid of ids) {
    const before = prevSketches[sid];
    const after = nextSketches[sid];

    if (before && !after) {
      lines.push(`  sketch ${sid}: DELETED`);
      continue;
    }
    if (!before && after) {
      const s = stateOf(after);
      lines.push(`  sketch ${sid}: CREATED (${s.entities.length} entities, ${s.constraints.length} constraints) host=${after.hostId}`);
      continue;
    }

    const a = stateOf(before);
    const b = stateOf(after);
    const ents = diffById(a.entities, b.entities);
    const cons = diffById(a.constraints, b.constraints);

    // Sketch-level metadata changes (name, visibility) with identical geometry.
    const metaChanged = changedFields(
      { name: before.name, visible: before.visible },
      { name: after.name, visible: after.visible },
    );

    const nothing =
      !ents.added.length && !ents.removed.length && !ents.modified.length &&
      !cons.added.length && !cons.removed.length && !cons.modified.length &&
      !metaChanged.length;
    if (nothing) continue;

    lines.push(`  sketch ${sid}:`);
    for (const e of ents.added) lines.push(`    + ${entitySummary(e)}`);
    for (const e of ents.removed) lines.push(`    - ${entitySummary(e)}`);
    for (const { before: pe, after: ne } of ents.modified) {
      lines.push(`    ~ ${entitySummary(ne)} { ${changedFields(pe, ne).join('; ')} }`);
    }
    for (const c of cons.added) lines.push(`    +constraint ${constraintSummary(c)}`);
    for (const c of cons.removed) lines.push(`    -constraint ${constraintSummary(c)}`);
    for (const { before: pc, after: nc } of cons.modified) {
      lines.push(`    ~constraint ${constraintSummary(nc)} { ${changedFields(pc, nc).join('; ')} }`);
    }
    for (const m of metaChanged) lines.push(`    ~sketch-meta ${m}`);
  }

  if (!lines.length) return; // save carried no sketch change

  // eslint-disable-next-line no-console
  console.log(`${PREFIX} model=${modelId} user=${userId}\n${lines.join('\n')}`);
}

module.exports = { logSketchDiff };
