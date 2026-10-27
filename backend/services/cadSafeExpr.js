'use strict';

// REQ 941 — validation twin of frontend/src/app/cad/lib/safeExpr.ts.
// Equation-curve expressions (x(t), y(t)) in shared sketch documents are
// untrusted. A save is rejected unless every expression parses under the
// restricted expr-eval grammar: no member access, assignment, function
// definition, or arrays, and identifiers limited to `t`, math functions, and
// math constants. KEEP IN SYNC with the frontend module.

const { Parser } = require('expr-eval');

const parser = new Parser({
  allowMemberAccess: false,
  operators: { assignment: false, fndef: false, array: false, concatenate: false },
});

const BLOCKED_FUNCTIONS = new Set(['map', 'fold', 'filter', 'indexOf', 'join', 'random']);

const ALLOWED = new Set([
  't',
  ...Object.keys(parser.unaryOps),
  ...Object.keys(parser.functions).filter((f) => !BLOCKED_FUNCTIONS.has(f)),
  ...Object.keys(parser.consts),
]);

function normalizeCurveExpr(expr) {
  return String(expr == null ? '' : expr)
    .replace(/\bMath\s*\.\s*/g, '')
    .replace(/\*\*/g, '^');
}


/** Lexical pre-check: no string literals, and every identifier is allow-listed.
 * (expr-eval resolves inherited Object keys such as `constructor` as operators,
 * so its own symbol list is not enough.) */
function lexicalError(src) {
  if (/["'`]/.test(src)) return 'must not contain quotes or text';
  const bad = (src.match(/[A-Za-z_$][\w$]*/g) || []).filter((id) => !ALLOWED.has(id));
  if (bad.length) return `uses names that are not allowed: ${[...new Set(bad)].join(', ')} (only t, math functions, and PI/E)`;
  return null;
}

/** Why an expression is rejected, or null when it is valid. */
function curveExprError(expr) {
  const lex = lexicalError(normalizeCurveExpr(expr));
  if (lex) return lex;
  let parsed;
  try {
    parsed = parser.parse(normalizeCurveExpr(expr));
  } catch (e) {
    return `could not be parsed (${e.message})`;
  }
  const bad = parsed.symbols({ withMembers: false }).filter((s) => !ALLOWED.has(s));
  if (bad.length) return `uses names that are not allowed: ${bad.join(', ')} (only t, math functions, and PI/E)`;
  return null;
}

/**
 * Check every equation-curve entity in a sketch document. Returns the first
 * problem as a human-readable message naming the sketch and entity, or null.
 */
function validateSketchDocExpressions(sketchDoc) {
  const sketches = (sketchDoc && sketchDoc.sketches) || {};
  for (const [sketchId, sketch] of Object.entries(sketches)) {
    const entities = (sketch && sketch.state && sketch.state.entities) || [];
    for (const e of entities) {
      if (!e || e.kind !== 'equation') continue;
      for (const field of ['xExpr', 'yExpr']) {
        const err = curveExprError(e[field]);
        if (err) {
          const name = (sketch && sketch.name) || sketchId;
          return `Equation curve ${e.id} in sketch "${name}": ${field === 'xExpr' ? 'x(t)' : 'y(t)'} ${err}`;
        }
      }
    }
  }
  return null;
}

module.exports = { normalizeCurveExpr, curveExprError, validateSketchDocExpressions };
