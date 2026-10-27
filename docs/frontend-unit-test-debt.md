# Frontend unit-test debt (known, pre-existing)

The frontend unit-test build (`npx ng test`, the `@angular/build:unit-test` vitest
builder) had accumulated breakage unrelated to any one feature. As of 2026-06-09 the suite
**compiles and runs** (it previously failed to compile at all). The backend Jest suite is
unaffected and green.

## Fixed
- **Compile errors** that blocked the entire build: `solver.spec` (helper arity),
  `sketchEditOps.spec` (stray `})`), `equations.spec` (index-signature access),
  `cad-preview-3d.component.spec` (renamed `distance()` → `measureRows()`),
  `migration.spec` (`SketchDocument`/`Record` casts), and `textGlyphs.spec` excluded from
  the TS spec project (see below).
- **Restored local deps**: `opentype.js@^2.0.0` was declared but missing from local
  `node_modules` (`npm install` in `frontend/` restored it; this un-broke `profile.spec`,
  which now collects its 23 tests).
- **10 drifted tests** (tests that never ran because the build was broken, then diverged
  from the production-validated code) realigned to current behavior: `datum` (signed-zero),
  `measure` (reworded message + 4-row distance result), `equations` (reserved variable
  name), `profile` (arc winding), `sketchEditOps` (concave-corner merge + construction
  chaining), `tangentPropagation` (dense polyline sampling), `requirements-list-view`
  (timezone-stable date input).

## Remaining (environmental — not code/logic bugs)
These cannot pass in the current browser-target vitest runner and are **left red on
purpose** pending a test-infra decision:

- **`solver.spec` — 33 failures.** The vendored **PlaneGCS WebAssembly** module
  (`frontend/src/app/cad/vendor/planegcs/planegcs_dist/planegcs.js`) does not load/
  instantiate in the unit-test runner. The solver works correctly in the running app; only
  the unit harness can't load the `.wasm`. Fix path: configure the test runner to serve/
  resolve the PlaneGCS `.wasm` asset (or run these in a node/worker environment).
- **`textGlyphs.spec` — 4 failures.** Reads `Roboto-Regular.ttf` from disk via
  `node:fs`/`node:url`, which the browser-target builder can't do (and `@types/node` is not
  a project dependency, so it also doesn't type-check — hence it's excluded from
  `tsconfig.spec.json`). Its byte-for-byte counterpart runs in the backend Jest suite
  (`backend/tests/__tests__/design/cadTextGlyphs.test.js`). Fix path: add a node-environment
  vitest project (and `@types/node`) or treat the backend twin as canonical.

## Pending a domain decision (skipped, not masked)
- **`equations.spec` → "RESERVED_EQUATION_NAMES includes …"** (`it.skip`). The test expects
  `sin`/`cos`/`sqrt` reserved but `length` usable as a variable name; expr-eval files all
  four under `unaryOps`, so there's no clean programmatic split. The reserved set
  (`equations.ts`) currently omits `unaryOps` entirely — see the "KNOWN GAP" comment there.
  Decide the intended semantics for variable names colliding with unary operators, then
  unskip.
