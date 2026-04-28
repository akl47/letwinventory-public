# Security Audit — Consolidated Findings & Remediation Plan

## Context
Full-codebase security audit of the Letwinventory application (Node.js/Express 5 + Angular 19 + PostgreSQL). Three independent reviews covered auth/API, frontend/data, and injection/logic. Findings below are deduplicated and verified.

**Note:** `.env.development` and `.env.production` are in `.gitignore` and NOT tracked in git. Several agents flagged "credentials committed to repo" — this is **not the case**. The files exist locally only.

---

## CRITICAL

### C1. JWT `algorithms` option not specified
**File:** `backend/middleware/checkToken.js:7`
```js
jwt.verify(token, process.env.JWT_SECRET, (err, jwtUser) => { ... })
```
jsonwebtoken 9.0.0 blocks `alg: "none"` by default, so the "none" attack doesn't work. But specifying `{ algorithms: ['HS256'] }` is still best practice to prevent algorithm confusion if the library behavior changes.
**Fix:** Add `{ algorithms: ['HS256'] }` to all `jwt.verify` calls.

### C2. No rate limiting on unauthenticated endpoints
**Files:** `backend/api/auth/user/routes.js:8`, `backend/api/auth/api-key/routes.js:9`
- `POST /api/auth/user/refresh` — no auth, no rate limit
- `POST /api/auth/api-key/token` — no auth, no rate limit
**Fix:** Add `express-rate-limit` middleware to these endpoints (e.g., 10 req/min per IP).

### C3. XSS via `bypassSecurityTrustHtml` in SVG pipe
**File:** `frontend/src/app/components/tools/tool-outline/svg-sanitize.pipe.ts:10`
```ts
return this.sanitizer.bypassSecurityTrustHtml(cleaned);
```
Only strips XML declaration, does not sanitize SVG content. SVG can contain `<script>`, event handlers, etc.
**Fix:** Use DOMParser to strip all scripts/event handlers, or use a proper SVG sanitizer lib. Alternatively, render SVGs as `<img src="data:image/svg+xml,...">` which sandboxes scripts.

---

## HIGH

### H1. Race conditions in quantity operations (split, merge, kit, unkit)
**File:** `backend/api/inventory/trace/controller.js` — splitTrace, mergeTrace, kitTrace, unkitTrace
Read-then-write with no transaction or locking. Two concurrent splits could both succeed and duplicate inventory.
**Fix:** Wrap each operation in `db.sequelize.transaction()` with `SELECT ... FOR UPDATE` (pessimistic locking) on the trace row.

### H2. Mass assignment — `req.body` passed directly to `Model.update()`
**Files:**
- `backend/api/inventory/order/controller.js:139` — `db.Order.update(req.body, ...)`
- `backend/api/inventory/part/controller.js:244` — `db.Part.update(req.body, ...)`
- `backend/api/inventory/location/controller.js:117` — `db.Location.update(req.body, ...)`
- `backend/api/inventory/box/controller.js` — similar pattern
Attacker can set `createdAt`, `activeFlag`, foreign keys, etc.
**Fix:** Whitelist allowed fields with destructuring or `_.pick()` before update.

### H3. Unbounded recursive `findChildrenBarcodes` — DoS via stack overflow
**File:** `backend/api/inventory/location/controller.js:63-72`
No depth limit or cycle detection. Circular parent references crash the server.
**Fix:** Add `visited` Set and max depth (e.g., 50).

### H4. No pagination on list endpoints
**Files:** Multiple controllers use `findAll()` with no `limit`/`offset`:
- `backend/api/manufacturing/work-order/controller.js:97` (getAll)
- `backend/api/inventory/part/controller.js` (getAll)
- N+1 query in WO getAll (per-WO step count query)
**Fix:** Add default pagination (limit=100) to all list endpoints. Resolve N+1 with subquery or include.

### H5. Missing security headers
**File:** `backend/index.js`
No CSP, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, Referrer-Policy.
**Fix:** Add `helmet` middleware (one line: `app.use(helmet())`).

### H6. 50MB body-parser limit
**File:** `backend/index.js:42`
```js
app.use(bodyParser.json({ limit: '50mb' }));
```
Enables trivial DoS by posting large payloads.
**Fix:** Reduce global limit to 1MB. For file upload routes that need more, apply a higher limit at the route level.

---

## MEDIUM

### M1. Error messages leak internals
**Files:** Many controllers pass `error.message` to client:
```js
next(createError(500, `Error: ${error.message}`));
```
Sequelize errors reveal table/column names, constraint names, etc.
**Fix:** In production, return generic "Internal server error" for 500s. Log full details server-side.

### M2. No CSRF protection
The app uses JWT in Authorization header (not cookies) for most requests, which is inherently CSRF-safe. However, the refresh token uses an httpOnly cookie — this cookie IS sent cross-origin. The refresh endpoint itself only returns a new access token (not a state-changing action), so the CSRF risk is limited to token theft, which is mitigated by CORS.
**Fix:** Low urgency. Adding `SameSite=Strict` to the refresh cookie (if not already set) fully mitigates this.

### M3. No audit trail for admin impersonation
**File:** `backend/api/admin/user/controller.js:143-175`
Impersonation creates a JWT but doesn't log who impersonated whom.
**Fix:** Add an audit log entry when impersonation starts.

### M4. BOM cycle detection DFS has no depth limit
**File:** `backend/api/inventory/bom/controller.js:21-68`
Each recursive call hits the DB. Very deep graphs → resource exhaustion.
**Fix:** Add max depth (e.g., 20) and preload the graph.

### M5. Hardcoded printer IPs
**File:** `backend/api/inventory/barcode/controller.js:28-36`
Network topology disclosure; should be in config/DB.

### M6. Docker runs as root
**File:** `backend/Dockerfile` — no `USER` directive.
**Fix:** Add `USER node` after dependencies install.

### M7. Debug console.logs in production
**Files:** `backend/middleware/checkToken.js:32,37`, `backend/api/auth/user/controller.js:276`, `backend/index.js:36`
Logs request URLs, auth failures, cookie presence.
**Fix:** Use a logger with level control (e.g., `winston`), or gate with `NODE_ENV`.

---

## LOW / INFORMATIONAL

- **L1.** `pgAdmin` in docker-compose has default password `root` — dev-only, but should still be changed
- **L2.** `express@5.2.1` is pre-release — monitor for security patches
- **L3.** Auth token in localStorage (not httpOnly cookie) — XSS-accessible if XSS exists. Mitigated by fixing C3.
- **L4.** No file type validation on upload — relies on client-side. Should validate MIME type server-side.
- **L5.** File endpoints (`/api/files/:id/data`) use `checkToken` but not `checkPermission` — any authenticated user can access any file by ID. Low risk since file IDs are not guessable (auto-increment integers), but should add authorization if files contain sensitive data.

---

## Remediation Plan (ordered by priority)

### Phase 1 — Immediate (code changes, no infrastructure)

| # | Fix | Files |
|---|-----|-------|
| C1 | Add `{ algorithms: ['HS256'] }` to jwt.verify | `backend/middleware/checkToken.js`, `backend/api/auth/user/controller.js` |
| C2 | Add `express-rate-limit` to refresh + API key exchange | `backend/api/auth/user/routes.js`, `backend/api/auth/api-key/routes.js`, new `backend/middleware/rateLimiter.js` |
| C3 | Fix SVG sanitize pipe — strip scripts/events | `frontend/src/app/components/tools/tool-outline/svg-sanitize.pipe.ts` |
| H1 | Wrap split/merge/kit/unkit in transactions + FOR UPDATE | `backend/api/inventory/trace/controller.js` |
| H2 | Whitelist fields on all `.update(req.body)` calls | `backend/api/inventory/order/controller.js`, `part/controller.js`, `location/controller.js`, `box/controller.js` |
| H3 | Add depth limit + visited set to `findChildrenBarcodes` | `backend/api/inventory/location/controller.js` |
| H5 | Add `helmet` middleware | `backend/index.js`, `backend/package.json` |
| H6 | Reduce body-parser limit to 1MB default | `backend/index.js` |

### Phase 2 — Short-term

| # | Fix | Files |
|---|-----|-------|
| H4 | Add pagination to list endpoints | Multiple controllers |
| M1 | Generic error messages in production | All controllers with `error.message` in responses |
| M3 | Audit log for impersonation | `backend/api/admin/user/controller.js` |
| M4 | Depth limit on BOM cycle DFS | `backend/api/inventory/bom/controller.js` |
| M6 | Add `USER node` to Dockerfile | `backend/Dockerfile` |
| M7 | Remove or gate debug console.logs | Multiple files |

### Phase 3 — Longer-term

| # | Fix | Files |
|---|-----|-------|
| M2 | SameSite=Strict on refresh cookie | `backend/api/auth/user/controller.js` |
| M5 | Move printer IPs to config | `backend/api/inventory/barcode/controller.js` |
| L4 | Server-side MIME validation on upload | `backend/api/files/controller.js` |
| L5 | Add permission check to file endpoints | `backend/api/files/routes.js` |

---

## Dependency Vulnerabilities (npm audit)

### Backend — 17 vulnerabilities (3 low, 3 moderate, 11 high)

| Package | Severity | Issue | Fix |
|---------|----------|-------|-----|
| **sequelize 6.x** | HIGH | SQL Injection via JSON Column Cast Type (GHSA-6457) | `npm audit fix` |
| **lodash <=4.17.23** | HIGH | Code Injection via `_.template`, Prototype Pollution via `_.unset`/`_.omit` | `npm audit fix` |
| **path-to-regexp 8.0-8.3** | HIGH | ReDoS via sequential optional groups and multiple wildcards | `npm audit fix` |
| **picomatch <=2.3.1** | HIGH | Method Injection in POSIX classes, ReDoS via extglob | `npm audit fix` |
| **minimatch <=3.1.3** | HIGH | Multiple ReDoS vectors | `npm audit fix` |
| **qs 6.7-6.14** | LOW | arrayLimit bypass DoS | `npm audit fix` |
| **dottie 2.0.4-2.0.6** | MODERATE | Prototype Pollution bypass in `set()`/`transform()` | `npm audit fix` |
| **bn.js <4.12.3** | MODERATE | Infinite loop | `npm audit fix` |
| **brace-expansion** | MODERATE | Zero-step sequence hang | `npm audit fix` |
| **tar <=7.5.10** | HIGH | Multiple path traversal / hardlink attacks | Needs `--force` (breaks sqlite3) |
| **sqlite3 5.0-5.1.7** | — | Depends on vulnerable tar/node-gyp | Needs `--force` → sqlite3@6.0.1 |

**Note:** `tar`/`sqlite3` vulnerabilities are in *build-time* dependencies (node-gyp for native compilation). They don't affect runtime. sqlite3 is only used in tests (production uses PostgreSQL). Low actual risk.

### Frontend — 27 vulnerabilities (1 low, 7 moderate, 19 high)

| Package | Severity | Issue | Fix |
|---------|----------|-------|-----|
| **undici 7.0-7.23** | HIGH | Unbounded decompression, WebSocket overflow, HTTP smuggling, CRLF injection | `npm audit fix` |
| **vite 7.0-7.3** | HIGH | Path traversal in dev server, `server.fs.deny` bypass, WebSocket file read | `npm audit fix` |
| **tar** | HIGH | Same as backend | `npm audit fix` |
| Others | MODERATE | Various (brace-expansion, minimatch, picomatch, etc.) | `npm audit fix` |

**Note:** Vite vulnerabilities are dev-server only (not in production builds). Undici issues affect Node.js fetch API — relevant if SSR is used.

### Recommended Action
1. Run `npm audit fix` in both `backend/` and `frontend/` — fixes all non-breaking issues
2. For sqlite3/tar: consider `npm audit fix --force` (upgrades sqlite3 to 6.x — may need test adjustments)
3. The **sequelize SQL injection** (GHSA-6457) is the most concerning runtime vulnerability — verify the fix lands

## Verification
1. After C1: Craft a JWT with `alg: "none"` → should be rejected
2. After C2: Hit refresh/exchange endpoints >10 times in 1 min → should get 429
3. After C3: Create SVG with `<script>alert(1)</script>` → should not execute
4. After H1: Send two concurrent split requests for same trace → only one should succeed
5. After H2: Send `{ "activeFlag": false }` in a part update → should be ignored
6. After H3: Create circular barcode hierarchy → should return error, not crash
7. After H5: Check response headers for CSP, X-Frame-Options, etc.
8. After H6: POST >1MB JSON body → should get 413
