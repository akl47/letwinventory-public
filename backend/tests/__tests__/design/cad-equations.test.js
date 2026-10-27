'use strict';

const { resolveEquations, applyEquationsToModel } = require('../../../services/cadEquations');

describe('cadEquations.resolveEquations', () => {
  test('resolves a literal global', () => {
    const r = resolveEquations({ entries: { length: { expression: '100' } } });
    expect(r.values).toEqual({ length: 100 });
    expect(r.errors).toEqual({});
  });

  test('resolves transitive references in dependency order', () => {
    const r = resolveEquations({
      entries: {
        c: { expression: 'b + 5' },
        a: { expression: '10' },
        b: { expression: 'a * 2' },
      },
    });
    expect(r.values).toEqual({ a: 10, b: 20, c: 25 });
  });

  test('detects 2-node cycles and isolates unrelated globals', () => {
    const r = resolveEquations({
      entries: {
        good: { expression: '42' },
        a: { expression: 'b' },
        b: { expression: 'a' },
      },
    });
    expect(r.values['good']).toBe(42);
    expect(r.errors['a']).toMatch(/cycle/);
    expect(r.errors['b']).toMatch(/cycle/);
  });

  test('rejects non-finite results (divide by zero)', () => {
    const r = resolveEquations({ entries: { bad: { expression: '1 / 0' } } });
    expect(r.errors['bad']).toMatch(/finite/);
  });

  test('reports undefined-identifier errors per entry', () => {
    const r = resolveEquations({
      entries: {
        ok: { expression: '5' },
        bad: { expression: 'undefined_thing * 2' },
      },
    });
    expect(r.values['ok']).toBe(5);
    expect(r.errors['bad']).toBeDefined();
  });

  test('does NOT inline `E` as Euler\'s number — user variable wins', () => {
    // Regression: matches the frontend behaviour. expr-eval's
    // default `E` constant must not pre-empt a user variable.
    const r = resolveEquations({
      entries: {
        E: { expression: '100' },
        double_E: { expression: '2 * E' },
      },
    });
    expect(r.values.E).toBe(100);
    expect(r.values.double_E).toBe(200);
    expect(r.errors).toEqual({});
  });

  test('does NOT inline `PI` either — user variable wins', () => {
    const r = resolveEquations({
      entries: {
        PI: { expression: '4' },
        circumference: { expression: '2 * PI * 5' },
      },
    });
    expect(r.values.PI).toBe(4);
    expect(r.values.circumference).toBe(40);
  });
});

describe('cadEquations.applyEquationsToModel', () => {
  test('overwrites feature.distance when an equation drives it', () => {
    const model = {
      featureTree: { features: [
        { id: 'f1', type: 'origin' },
        { id: 'f2', type: 'extrude', sketchId: 's1', distance: 5 },
      ] },
      sketchDoc: { sketches: {} },
      equations: { entries: {
        length: { expression: '100' },
        'feature.f2.distance': { expression: 'length / 4' },
      } },
    };
    const r = applyEquationsToModel(model);
    const f2 = r.featureTree.features.find(f => f.id === 'f2');
    expect(f2.distance).toBe(25);
    expect(r.equationErrors).toEqual([]);
  });

  test('leaves features without an equation untouched', () => {
    const model = {
      featureTree: { features: [
        { id: 'f1', type: 'extrude', sketchId: 's1', distance: 7 },
      ] },
      sketchDoc: { sketches: {} },
      equations: { entries: { length: { expression: '100' } } },
    };
    const r = applyEquationsToModel(model);
    expect(r.featureTree.features[0].distance).toBe(7);
  });

  test('drives revolve angle', () => {
    const model = {
      featureTree: { features: [
        { id: 'f1', type: 'revolve', sketchId: 's1', axisLineId: 'l1', angle: 90 },
      ] },
      sketchDoc: { sketches: {} },
      equations: { entries: {
        full: { expression: '360' },
        'feature.f1.angle': { expression: 'full' },
      } },
    };
    const r = applyEquationsToModel(model);
    expect(r.featureTree.features[0].angle).toBe(360);
  });

  test('drives direction-2 distance only when direction2 exists', () => {
    const model = {
      featureTree: { features: [
        {
          id: 'f1', type: 'extrude', sketchId: 's1', distance: 10,
          direction2: { distance: 5, endCondition: { kind: 'blind' } },
        },
        { id: 'f2', type: 'extrude', sketchId: 's2', distance: 10 },
      ] },
      sketchDoc: { sketches: {} },
      equations: { entries: {
        'feature.f1.direction2.distance': { expression: '15' },
        // f2 has no direction2 — equation shouldn't error or fire
        'feature.f2.direction2.distance': { expression: '99' },
      } },
    };
    const r = applyEquationsToModel(model);
    expect(r.featureTree.features[0].direction2.distance).toBe(15);
    expect(r.featureTree.features[1].direction2).toBeUndefined();
  });

  test('drives start-offset only when startCondition.kind === offset', () => {
    const model = {
      featureTree: { features: [
        {
          id: 'f1', type: 'extrude', sketchId: 's1', distance: 10,
          startCondition: { kind: 'offset', distance: 2 },
        },
      ] },
      sketchDoc: { sketches: {} },
      equations: { entries: { 'feature.f1.startCondition.distance': { expression: '7.5' } } },
    };
    const r = applyEquationsToModel(model);
    expect(r.featureTree.features[0].startCondition.distance).toBe(7.5);
  });

  test('drives a sketch constraint value', () => {
    const model = {
      featureTree: { features: [] },
      sketchDoc: { sketches: {
        s1: {
          id: 's1',
          state: {
            entities: [],
            constraints: [{ id: 'c1', type: 'distance', value: 5 }],
          },
        },
      } },
      equations: { entries: { 'sketch.s1.constraint.c1': { expression: '12' } } },
    };
    const r = applyEquationsToModel(model);
    expect(r.sketchDoc.sketches.s1.state.constraints[0].value).toBe(12);
  });

  test('surfaces equation errors with the parameter path prefix', () => {
    const model = {
      featureTree: { features: [
        { id: 'f1', type: 'extrude', sketchId: 's1', distance: 10 },
      ] },
      sketchDoc: { sketches: {} },
      equations: { entries: { 'feature.f1.distance': { expression: '1 / 0' } } },
    };
    const r = applyEquationsToModel(model);
    expect(r.equationErrors).toHaveLength(1);
    expect(r.equationErrors[0]).toMatch(/feature f1 distance/);
    // Distance was NOT overwritten — original value preserved.
    expect(r.featureTree.features[0].distance).toBe(10);
  });

  test('handles a model with no equations field', () => {
    const model = {
      featureTree: { features: [{ id: 'f1', type: 'extrude', sketchId: 's1', distance: 10 }] },
      sketchDoc: { sketches: {} },
    };
    const r = applyEquationsToModel(model);
    expect(r.featureTree.features[0].distance).toBe(10);
    expect(r.equationErrors).toEqual([]);
  });
});
