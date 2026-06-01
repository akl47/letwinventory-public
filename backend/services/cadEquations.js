/**
 * Backend mirror of frontend/src/app/cad/lib/equations.ts. Same JSON
 * shapes (EquationDoc / EquationEntry), same algorithm. We can't share
 * a single source file because the frontend is TypeScript ESM and the
 * backend is plain CJS — the cadProfile module follows this same
 * pattern. The test suite asserts both implementations produce
 * identical output for shared fixtures.
 *
 * The public API the regen pipeline consumes is `applyEquationsToModel`:
 * given a DesignCADModel (with featureTree, sketchDoc, equations), it
 * returns a NEW featureTree + sketchDoc with every drivable numeric
 * parameter overwritten by the resolved value, plus an `equationErrors`
 * array surfacing cycles and other resolution failures so they reach
 * the regen response.
 */

const { Parser } = require('expr-eval');

const parser = new Parser();

// Clear expr-eval's built-in math constants (E, PI, LN2, etc.) so
// user-defined variables aren't silently shadowed by them. Without
// this a user equation `E = 100` is ignored — `E` parses as
// Euler's number. Functions (sin, cos, sqrt, …) stay intact since
// they're callable and don't shadow variable lookups.
// Mirrors the frontend equations.ts; same set is exposed via
// `RESERVED_EQUATION_NAMES` there for the equations-panel warning.
parser.consts = {};

/** Resolve every entry in the equation document. See equations.ts for
 * the algorithm description. */
function resolveEquations(doc) {
  const values = {};
  const errors = {};
  const order = [];
  const entries = (doc && doc.entries) || {};

  const parsed = new Map();
  for (const [key, entry] of Object.entries(entries)) {
    try {
      const ast = parser.parse(entry.expression);
      parsed.set(key, { deps: ast.variables(), evaluate: ctx => ast.evaluate(ctx) });
    } catch (e) {
      errors[key] = e.message;
    }
  }

  const color = new Map();  // 0=WHITE, 1=GRAY, 2=BLACK
  const stack = [];
  const visit = (key) => {
    if (errors[key]) return;
    const c = color.get(key) || 0;
    if (c === 2) return;
    if (c === 1) {
      const cycleStart = stack.indexOf(key);
      const cyclePath = stack.slice(cycleStart).concat(key);
      const errMsg = `cycle: ${cyclePath.join(' → ')}`;
      for (const k of cyclePath) if (!errors[k]) errors[k] = errMsg;
      return;
    }
    color.set(key, 1);
    stack.push(key);
    const node = parsed.get(key);
    if (node) {
      for (const dep of node.deps) {
        if (parsed.has(dep)) visit(dep);
      }
    }
    stack.pop();
    color.set(key, 2);
    order.push(key);
  };
  for (const key of parsed.keys()) {
    if ((color.get(key) || 0) === 0) visit(key);
  }

  for (const key of order) {
    if (errors[key]) continue;
    const node = parsed.get(key);
    if (!node) continue;
    try {
      const result = node.evaluate(values);
      if (typeof result !== 'number' || !isFinite(result)) {
        errors[key] = `not a finite number (got ${JSON.stringify(result)})`;
        continue;
      }
      values[key] = result;
    } catch (e) {
      errors[key] = e.message;
    }
  }

  return { values, errors, order };
}

/** Look up a target key in the equations doc + resolved values map. If
 * the key has a resolved value, return it; if the key has an error,
 * return { error }; otherwise return undefined (no equation drives this
 * target — caller keeps the existing literal value). */
function _targetValue(equations, values, errors, key) {
  if (!equations || !equations.entries || !(key in equations.entries)) return undefined;
  if (key in errors) return { error: errors[key] };
  if (key in values) return { value: values[key] };
  return undefined;
}

/** Walk the model's featureTree + sketchDoc, applying any equation
 * matching a numeric parameter's target key. Returns a NEW tree + doc
 * with the resolved values written in (shallow-clones where mutation
 * happens). Equation errors that match a target key surface in the
 * returned `equationErrors` array, formatted with the parameter path
 * so the user can tell which feature failed. */
function applyEquationsToModel(model) {
  const equations = model.equations || { entries: {} };
  const { values, errors } = resolveEquations(equations);

  const equationErrors = [];
  const featureTree = model.featureTree || { features: [] };
  const sketchDoc = model.sketchDoc || { sketches: {} };

  // Track which equation entry keys we actually CONSUMED so we can
  // surface only errors for keys that drive something. Pure globals
  // (consumed by other equations) appear in `errors` too — those are
  // pushed without a path prefix because they're not parameter-bound.
  const consumedTargetKeys = new Set();

  const resolvedFeatures = featureTree.features.map(f => {
    if (!f || f.type === 'origin') return f;
    const next = { ...f };

    // ExtrudeFeature / CutExtrudeFeature: distance.
    if (typeof next.distance === 'number') {
      const key = `feature.${next.id}.distance`;
      const hit = _targetValue(equations, values, errors, key);
      if (hit) {
        consumedTargetKeys.add(key);
        if (hit.error) {
          equationErrors.push(`feature ${next.id} distance equation: ${hit.error}`);
        } else {
          next.distance = hit.value;
        }
      }
    }

    // RevolveFeature / CutRevolveFeature: angle.
    if (typeof next.angle === 'number') {
      const key = `feature.${next.id}.angle`;
      const hit = _targetValue(equations, values, errors, key);
      if (hit) {
        consumedTargetKeys.add(key);
        if (hit.error) {
          equationErrors.push(`feature ${next.id} angle equation: ${hit.error}`);
        } else {
          next.angle = hit.value;
        }
      }
    }

    // ExtrudeStartCondition (kind=offset) carries a distance. Only
    // drivable when the start condition is the offset variant.
    if (next.startCondition && next.startCondition.kind === 'offset') {
      const key = `feature.${next.id}.startCondition.distance`;
      const hit = _targetValue(equations, values, errors, key);
      if (hit) {
        consumedTargetKeys.add(key);
        if (hit.error) {
          equationErrors.push(`feature ${next.id} start-offset equation: ${hit.error}`);
        } else {
          next.startCondition = { ...next.startCondition, distance: hit.value };
        }
      }
    }

    // ExtrudeDirection (direction 2) carries a distance.
    if (next.direction2 && typeof next.direction2.distance === 'number') {
      const key = `feature.${next.id}.direction2.distance`;
      const hit = _targetValue(equations, values, errors, key);
      if (hit) {
        consumedTargetKeys.add(key);
        if (hit.error) {
          equationErrors.push(`feature ${next.id} direction-2 equation: ${hit.error}`);
        } else {
          next.direction2 = { ...next.direction2, distance: hit.value };
        }
      }
    }

    return next;
  });

  // Sketch constraints: walk each visible sketch's state.constraints
  // and overwrite the `value` field of any constraint that has a
  // matching equation entry.
  const resolvedSketches = {};
  for (const [sid, sketch] of Object.entries(sketchDoc.sketches || {})) {
    if (!sketch || !sketch.state || !Array.isArray(sketch.state.constraints)) {
      resolvedSketches[sid] = sketch;
      continue;
    }
    let mutated = false;
    const nextConstraints = sketch.state.constraints.map(c => {
      if (!c || typeof c.value !== 'number' || !c.id) return c;
      const key = `sketch.${sid}.constraint.${c.id}`;
      const hit = _targetValue(equations, values, errors, key);
      if (!hit) return c;
      consumedTargetKeys.add(key);
      if (hit.error) {
        equationErrors.push(`sketch ${sid} constraint ${c.id} equation: ${hit.error}`);
        return c;
      }
      mutated = true;
      return { ...c, value: hit.value };
    });
    resolvedSketches[sid] = mutated
      ? { ...sketch, state: { ...sketch.state, constraints: nextConstraints } }
      : sketch;
  }

  // Surface remaining (pure-global) errors so the user sees them in the
  // panel as well as in the regen response.
  for (const [key, msg] of Object.entries(errors)) {
    if (consumedTargetKeys.has(key)) continue;  // already pushed with parameter-path prefix
    // Only surface top-level (no-dot) entries as "global" errors —
    // dotted target keys without a matching parameter mean a stale
    // equation pointing at a deleted feature, which we treat as a
    // benign condition (no error surfaced; UI panel still shows them).
    if (!key.includes('.')) {
      equationErrors.push(`equation ${key}: ${msg}`);
    }
  }

  return {
    featureTree: { ...featureTree, features: resolvedFeatures },
    sketchDoc: { ...sketchDoc, sketches: resolvedSketches },
    equationErrors,
    resolvedValues: values,
  };
}

module.exports = {
  resolveEquations,
  applyEquationsToModel,
};
