// REQ 941 — sandboxed evaluator for equation-curve expressions x(t) / y(t).
//
// Expressions come from shared sketch documents, so they are untrusted: they
// must NEVER reach `new Function` / `eval`. They are parsed by expr-eval with
// member access, assignment, function definition and arrays disabled, and every
// identifier must be `t`, a math function, or a math constant. Legacy JS-style
// input (`Math.cos(t)`, `Math.PI`, `a ** b`) is normalised first so existing
// curves keep working.
//
// KEEP IN SYNC with backend/services/cadSafeExpr.js.

import { Parser } from 'expr-eval-fork';

// `array` is a real runtime option (expr-eval maps '[' → 'array') that its
// .d.ts omits, hence the cast.
const parser = new Parser({
  allowMemberAccess: false,
  operators: { assignment: false, fndef: false, array: false, concatenate: false } as Record<string, boolean>,
});

const BLOCKED_FUNCTIONS = new Set(['map', 'fold', 'filter', 'indexOf', 'join', 'random']);

const ALLOWED = new Set<string>([
  't',
  ...Object.keys(parser.unaryOps),
  ...Object.keys(parser.functions).filter((f) => !BLOCKED_FUNCTIONS.has(f)),
  ...Object.keys(parser.consts),
]);

/** Rewrite legacy JS-style syntax into the expr-eval grammar. */
export function normalizeCurveExpr(expr: string): string {
  return String(expr ?? '')
    .replace(/\bMath\s*\.\s*/g, '')
    .replace(/\*\*/g, '^');
}

/**
 * Compile an equation-curve expression into a function of `t`. Returns null
 * when the expression does not parse or uses anything outside the allowed
 * grammar (the caller renders nothing for that curve).
 */
export function compileCurveExpr(expr: string): ((t: number) => number) | null {
  if (lexicalError(normalizeCurveExpr(expr))) return null;
  let parsed;
  try {
    parsed = parser.parse(normalizeCurveExpr(expr));
  } catch {
    return null;
  }
  const symbols = parsed.symbols({ withMembers: false });
  if (!symbols.every((s: string) => ALLOWED.has(s))) return null;
  return (t: number) => {
    // Null-prototype scope: only `t` resolves; nothing inherited from Object.
    const scope = Object.assign(Object.create(null), { t });
    return Number(parsed.evaluate(scope));
  };
}


/** Lexical pre-check: no string literals, and every identifier is allow-listed.
 * (expr-eval resolves inherited Object keys such as `constructor` as operators,
 * so its own symbol list is not enough.) */
function lexicalError(src: string): string | null {
  if (/["'`]/.test(src)) return 'must not contain quotes or text';
  const bad = (src.match(/[A-Za-z_$][\w$]*/g) || []).filter((id) => !ALLOWED.has(id));
  if (bad.length) return `uses names that are not allowed: ${[...new Set(bad)].join(', ')} (only t, math functions, and PI/E)`;
  return null;
}

/** Why an expression is rejected, or null when it is valid. */
export function curveExprError(expr: string): string | null {
  const lex = lexicalError(normalizeCurveExpr(expr));
  if (lex) return lex;
  let parsed;
  try {
    parsed = parser.parse(normalizeCurveExpr(expr));
  } catch (e) {
    return `could not be parsed (${(e as Error).message})`;
  }
  const bad = parsed.symbols({ withMembers: false }).filter((s: string) => !ALLOWED.has(s));
  if (bad.length) return `uses names that are not allowed: ${bad.join(', ')} (only t, math functions, and PI/E)`;
  return null;
}
