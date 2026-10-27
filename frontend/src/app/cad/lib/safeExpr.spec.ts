import { describe, it, expect, afterEach } from 'vitest';
import { compileCurveExpr, curveExprError, normalizeCurveExpr } from './safeExpr';
import { tessellateEquationCurve } from './tessellator';

// REQ 941 — equation-curve expressions are untrusted (shared sketch docs) and
// must be evaluated in a sandbox, never via new Function / eval.
describe('safeExpr (REQ 941)', () => {
  afterEach(() => { delete (globalThis as any).__pwned; });

  it('evaluates ordinary curve expressions', () => {
    const fx = compileCurveExpr('5*cos(t)')!;
    const fy = compileCurveExpr('5*sin(t)')!;
    expect(fx(0)).toBeCloseTo(5);
    expect(fy(Math.PI / 2)).toBeCloseTo(5);
    expect(compileCurveExpr('t^2 + 2*t')!(3)).toBeCloseTo(15);
    expect(compileCurveExpr('PI * t')!(1)).toBeCloseTo(Math.PI);
    expect(compileCurveExpr('max(t, 1)')!(0.5)).toBe(1);
  });

  it('accepts legacy JS-style syntax (Math. prefix, **)', () => {
    expect(normalizeCurveExpr('5*Math.cos(t) + t**2')).toBe('5*cos(t) + t^2');
    expect(compileCurveExpr('Math.cos(t)')!(0)).toBeCloseTo(1);
    expect(compileCurveExpr('Math.PI*t')!(1)).toBeCloseTo(Math.PI);
  });

  it.each([
    ['fetch("https://evil.example")'],
    ["alert('x')"],
    ['constructor(1)'],
    ['toString(t)'],
    ['t.constructor.constructor("globalThis.__pwned=1")()'],
    ['this'],
    ['window'],
    ['x = 1'],
    ['f(x) = x'],
    ['map(t, t)'],
    ['[1, 2]'],
  ])('rejects %s without executing anything', (expr) => {
    expect(compileCurveExpr(expr)).toBeNull();
    expect(curveExprError(expr)).toMatch(/not allowed|parsed|quotes/);
    expect((globalThis as any).__pwned).toBeUndefined();
  });

  it('tessellateEquationCurve renders valid curves and nothing for hostile input', () => {
    const circle = tessellateEquationCurve('5*cos(t)', '5*sin(t)', 0, 2 * Math.PI, 16);
    expect(circle.length).toBe(17);
    for (const p of circle) expect(Math.hypot(p.x, p.y)).toBeCloseTo(5);
    const hostile = tessellateEquationCurve('(globalThis.__pwned = 1, t)', 't', 0, 1, 8);
    expect(hostile).toEqual([]);
    expect((globalThis as any).__pwned).toBeUndefined();
  });
});
