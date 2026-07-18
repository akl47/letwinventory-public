'use strict';

// Minimal in-memory per-user rate limiter (REQ 903) for expensive endpoints —
// the kernel-driving CAD routes each cost a full OCCT regeneration, and were
// previously callable without bound. Fixed-window counting per (user, key):
// simple, dependency-free, and sufficient for a single-process backend (this
// app deploys as one backend container; revisit if that ever changes).
//
// Usage: router.post('/x', checkToken, rateLimit('regen', { max: 30, windowMs: 60_000 }), handler)

const buckets = new Map(); // `${key}:${userId}` -> { windowStart, count }

function rateLimit(key, { max = 30, windowMs = 60_000 } = {}) {
  return function rateLimitMiddleware(req, res, next) {
    if (process.env.NODE_ENV === 'test') return next(); // don't throttle suites
    const userId = (req.user && req.user.id) || req.ip;
    const bucketKey = `${key}:${userId}`;
    const now = Date.now();
    let bucket = buckets.get(bucketKey);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { windowStart: now, count: 0 };
      buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterS = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfterS));
      return res.status(429).json({
        errorMessage: `Too many ${key} requests — limit is ${max} per ${Math.round(windowMs / 1000)}s. Retry in ${retryAfterS}s.`,
      });
    }
    // Opportunistic cleanup so the map doesn't grow with dead windows.
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) {
        if (now - b.windowStart >= windowMs) buckets.delete(k);
      }
    }
    return next();
  };
}

module.exports = { rateLimit };
