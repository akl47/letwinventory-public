'use strict';

// REQ 963 — every kernel-driving CAD endpoint carries a per-user rate limit.
// The limiter is a no-op under NODE_ENV=test, so this asserts the middleware
// is mounted on each route, plus the limiter's own 429 behavior.

const cadRoutes = require('../../../api/design/cad-model/routes');
const asmRoutes = require('../../../api/design/assembly/routes');
const { rateLimit } = require('../../../middleware/rateLimit');

function hasLimiter(router, method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack.some((s) => s.handle && s.handle.name === 'rateLimitMiddleware');
}

describe('Kernel-driving routes are rate-limited (REQ 963)', () => {
  test.each([
    ['post', '/:id/regenerate'],
    ['get', '/:id/export/step'],
    ['post', '/:id/reconcile/preview'],
    ['post', '/:id/commits/:a/diff/:b/regen'],
    ['get', '/:id/commits/:a/diff/:b/faces'],
    ['get', '/:id/commits/:hash/geometry'],
    ['get', '/:id/release/step'],
    ['get', '/:id/release/stl'],
  ])('part CAD %s %s', (method, path) => {
    expect(hasLimiter(cadRoutes, method, path)).toBe(true);
  });

  test.each([
    ['post', '/:id/regenerate'],
    ['post', '/:id/interference'],
    ['get', '/:id/mass-properties'],
    ['get', '/:id/export/step'],
    ['get', '/:id/export/stl'],
  ])('assembly %s %s', (method, path) => {
    expect(hasLimiter(asmRoutes, method, path)).toBe(true);
  });

  test('the limiter returns 429 with Retry-After once the budget is spent', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const mw = rateLimit(`test-${Date.now()}`, { max: 2, windowMs: 60_000 });
      const req = { user: { id: 1 } };
      const results = [];
      for (let i = 0; i < 3; i++) {
        const res = { headers: {}, set(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
        let passed = false;
        mw(req, res, () => { passed = true; });
        results.push(passed ? 'next' : res.code);
        if (!passed) expect(res.headers['Retry-After']).toBeDefined();
      }
      expect(results).toEqual(['next', 'next', 429]);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
