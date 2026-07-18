// SolidWorks-style equations resolver (REQ 634).
//
// All equation entries live in a single map keyed by either:
//  - a bare global name (no dot in the key) — referenced from expressions
//  - a target path (`feature.<id>.distance`, `sketch.<id>.constraint.<id>`,
//    …) — identifies which CAD parameter is driven; not referenced from
//    expressions, the value is just consumed at regen time.
//
// Globals and target-driven entries share the same map so the equations
// panel can render them all in one place. The resolver builds a dependency
// graph from the expressions' identifier references (via expr-eval's
// .variables()), topologically sorts, evaluates in order, and surfaces
// any cycles / parse errors / undefined identifiers as per-entry errors
// without taking down the rest of the document.

import { Parser } from 'expr-eval';

/** Document persisted on DesignCADModels.equations (REQ 635). */
export interface EquationDoc {
  entries: Record<string, EquationEntry>;
}

export interface EquationEntry {
  /** Raw expression text the user typed (e.g. `length / 10`). */
  expression: string;
  /** Last successfully-resolved numeric value. Updated by the resolver;
   * surfaces in UI so the user can see "what this evaluates to" without
   * re-running the resolver. NaN when the entry errors. */
  lastValue?: number;
  /** Human-readable error: cycle / undefined identifier / parse failure /
   * non-finite result. Absent when the entry resolved cleanly. */
  error?: string;
  /** REQ 918 — the assembly model id that PUSHED this value (shared-push
   * variables). The next push from that assembly overwrites the entry;
   * local edits are allowed in between. Absent for locally-defined
   * entries. */
  fromAssembly?: number;
}

export interface ResolveResult {
  /** name → numeric value for every cleanly-resolved entry. Keys for
   * entries that errored are absent from this map. Consumers that need
   * "is this value present?" should check map.has(name). */
  values: Record<string, number>;
  /** key → error string for every entry that failed (cycle, parse, etc.). */
  errors: Record<string, string>;
  /** Topological order used during evaluation; useful for UI grouping
   * (later entries depend on earlier ones). Cycle members appear in the
   * order they were first visited. */
  order: string[];
}

/** Build a fresh document with one entry added or updated. Pure. */
export function setEquation(doc: EquationDoc, key: string, expression: string): EquationDoc {
  return {
    ...doc,
    entries: { ...doc.entries, [key]: { expression } },
  };
}

/** Build a fresh document with the named entry removed. Pure. No-op when
 * the key is absent. */
export function removeEquation(doc: EquationDoc, key: string): EquationDoc {
  if (!(key in doc.entries)) return doc;
  const next: Record<string, EquationEntry> = {};
  for (const [k, v] of Object.entries(doc.entries)) {
    if (k !== key) next[k] = v;
  }
  return { ...doc, entries: next };
}

/** Single-expression evaluation for live UI preview. Returns either the
 * numeric value or a human-readable error. Pure: doesn't mutate the
 * provided values map. */
export function evalExpression(
  expression: string,
  values: Record<string, number>,
): { value?: number; error?: string } {
  if (!expression.trim()) return { error: 'empty expression' };
  try {
    const parsed = parser.parse(expression);
    const result = parsed.evaluate(values);
    if (typeof result !== 'number' || !isFinite(result)) {
      return { error: `not a finite number (got ${JSON.stringify(result)})` };
    }
    return { value: result };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Resolve every entry in the document into a numeric value map. Handles
 * dependencies between entries, cycle detection, undefined identifiers,
 * and parse errors. Each errored entry is reported independently so a
 * single bad expression doesn't take down the whole document.
 *
 * Algorithm:
 *   1. Parse every expression and extract its identifier dependencies.
 *      Parse failures land in `errors` and the entry is skipped.
 *   2. DFS from each entry, three-color (WHITE/GRAY/BLACK) to detect
 *      cycles. A GRAY-ancestor encounter records every key on the
 *      cycle path with `cycle: a → b → a`.
 *   3. Topological order = reverse post-order over BLACK nodes.
 *   4. Evaluate each in order. Successful → values; throw → errors. */
export function resolveEquations(doc: EquationDoc): ResolveResult {
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const order: string[] = [];

  type Parsed = { deps: string[]; evaluate: (ctx: Record<string, number>) => unknown };
  // User-defined names win over built-in expr-eval operators/functions, the
  // same way clearing `parser.consts` makes them win over built-in constants.
  // expr-eval spreads built-ins across several surfaces — `length`, `sin`,
  // `abs`, … are unary operators; `min`, `max`, … are functions — so a variable
  // named after any of them otherwise tokenizes as that built-in and an
  // expression like `length / 4` fails to parse ("unexpected TOP: /"). The
  // shadow stays in effect for the WHOLE resolve (parse AND eval): expr-eval
  // re-resolves operator tokens at evaluate time, so restoring before evaluation
  // would turn a name like `length` back into an operator mid-eval. The finally
  // guard restores the built-ins even if resolution throws, so a stray error
  // never leaves the shared parser corrupted. resolveEquations runs
  // synchronously, so the parser is never observed mid-mutation. (Symbol
  // operators like `+`/`/` can never collide with identifier-shaped entry keys.)
  const p = parser as unknown as {
    functions: Record<string, unknown>;
    unaryOps: Record<string, unknown>;
    binaryOps: Record<string, unknown>;
  };
  const opSurfaces = [p.functions, p.unaryOps, p.binaryOps];
  const shadowed: { surface: Record<string, unknown>; name: string; value: unknown }[] = [];
  for (const name of Object.keys(doc.entries)) {
    for (const surface of opSurfaces) {
      if (Object.prototype.hasOwnProperty.call(surface, name)) {
        shadowed.push({ surface, name, value: surface[name] });
        delete surface[name];
      }
    }
  }

  const parsed = new Map<string, Parsed>();
  try {
    for (const [key, entry] of Object.entries(doc.entries)) {
      try {
        const ast = parser.parse(entry.expression);
        parsed.set(key, { deps: ast.variables(), evaluate: ctx => ast.evaluate(ctx) });
      } catch (e) {
        errors[key] = (e as Error).message;
      }
    }

  // DFS with three-color state. WHITE = unvisited; GRAY = in the current
  // recursion stack (cycle target); BLACK = fully processed.
  const color = new Map<string, 0 | 1 | 2>();  // 0=WHITE, 1=GRAY, 2=BLACK
  const stack: string[] = [];

  const visit = (key: string): void => {
    if (errors[key]) return;  // skip parse-failed entries
    const c = color.get(key) ?? 0;
    if (c === 2) return;
    if (c === 1) {
      // Cycle detected — record the cycle path from where `key` first
      // appears in the stack to the end.
      const cycleStart = stack.indexOf(key);
      const cyclePath = stack.slice(cycleStart).concat(key);
      const errMsg = `cycle: ${cyclePath.join(' → ')}`;
      for (const k of cyclePath) {
        if (!errors[k]) errors[k] = errMsg;
      }
      return;
    }
    color.set(key, 1);
    stack.push(key);
    const node = parsed.get(key);
    if (node) {
      for (const dep of node.deps) {
        // Only chase deps that actually exist as entries — unresolved
        // identifiers surface as eval-time errors when this key is
        // evaluated, not as graph errors.
        if (parsed.has(dep)) visit(dep);
      }
    }
    stack.pop();
    color.set(key, 2);
    order.push(key);
  };

  for (const key of parsed.keys()) {
    if ((color.get(key) ?? 0) === 0) visit(key);
  }

  // Evaluate in topological order. Cycle members already have errors
  // recorded; skip them so they don't pollute `values`.
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
      errors[key] = (e as Error).message;
    }
  }
  } finally {
    for (const s of shadowed) s.surface[s.name] = s.value;
  }

  return { values, errors, order };
}

const parser = new Parser();

// expr-eval ships with built-in math constants (`E`, `PI`, `LN2`,
// `LN10`, `LOG2E`, `LOG10E`, `SQRT1_2`, `SQRT2`, `true`, `false`)
// that get inlined at parse time. That means a user-defined
// variable named `E` is silently treated as Euler's number — the
// resolver's dependency graph never sees it as a real variable.
// We clear the constants so user names always win; functions
// (`sin`, `cos`, `sqrt`, …) stay intact since those are valuable
// and aren't shadowed by variable lookups (they're callable, not
// values). Names that would still conflict (functions + the
// just-removed constants) are exported for the UI warning.
// KNOWN GAP (REQ TBD): expr-eval files `sin`/`cos`/`sqrt`/`length` under
// `unaryOps`, not `functions`, so they're absent from this set even though
// a variable with those names breaks `evalExpression` (which doesn't shadow
// like `resolveEquations` does). Fixing requires a domain decision —
// `length` in particular is expected usable as a variable name — so the
// reserved set is left as-is pending that call. See equations.spec.ts:233.
export const RESERVED_EQUATION_NAMES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(parser.consts),
  ...Object.keys(parser.functions),
]);
parser.consts = {};
