# CAD System — Production-Readiness Review

_Date: 2026-07-13. Method: five parallel code audits (kernel/regen pipeline, backend VCS/API, frontend editor, testing/CI, documented-gap reconciliation) plus deployment/QMS checks, all against the working tree at kernel build cpp-14 / NAMING 48. Every finding carries file:line evidence in the underlying audit outputs; this doc keeps the load-bearing references only._

> **Remediation status (same day, REQs 900–905):** P1–P4 and the top HIGH items are FIXED — prod compose + deploy handshake (P1), supervisor path (P2 of P1), transactional VCS verbs + ref CAS + frozen-blob loud failure + object GC + scheduled lock sweep (P3/REQ 901-902), kernel connection pool + timeout ordering + connection cap + naming-handshake hardening + endpoint rate limits (H1-H3/H6, REQ 903), CI hard gates + PR-built kernels + push/tag triggers + in-image kernel geometry smoke tests (P4/REQ 904), and the editor data-loss trio: beforeunload/destroy-flush/checkin-flush + doc-version 409 on two-tab clobber (H4/REQ 905). Still open from this review: H5 structural (per-user working copies), H7 (topological naming), the MEDIUM table (except GC/lock-sweep/frozen-blob), QMS approvals, and all functional gaps.

## Verdict

The CAD system is a **strong single-user engineering tool that is not yet deployable, not yet multi-user-safe, and not yet regression-protected**. The geometry/editor layer is mature (robust lock recovery, correct Three.js lifecycle, well-surfaced regen errors, fork-isolated kernel crashes). What's missing clusters into six themes, in descending order of "would hurt in week one":

1. **It isn't deployed** — production compose has no kernel service at all.
2. **VCS writes are not atomic** — the corruption class already observed in dev is structural.
3. **The kernel service model caps at ~1 concurrent user** and has an unauthenticated network surface.
4. **CI cannot catch a geometry regression** — the only real-geometry gate silently skips itself.
5. **A handful of data-loss UX holes** (tab close, two tabs, check-in race).
6. **QMS state**: 388 unapproved CAD requirements.

Functional completeness (import, drawings, merge quality) is a separate, longer arc — inventoried at the end.

---

## BLOCKERS — cannot go to production at all

### P1. CAD is absent from the production deployment
`docker-compose.prod.yml` defines only the app image — **no `letwinventory-cad-kernel` service, no `CAD_KERNEL_ADDR`**, and `scripts/deploy-update.sh` never pulls or restarts a kernel image. `publish-kernel.yml` publishes the image to GHCR on master pushes, but nothing consumes it. As configured, CAD does not run in prod.
**Fix:** add the kernel service (pinned GHCR tag, `restart: unless-stopped`, internal network only) to prod compose + deploy script; deploy must verify the `ping` handshake (`build` + `namingSchemaVersion`) before declaring success — the build-without-swap footgun hit three times in dev.

### P2. Kernel supervisor autospawn points at the deleted Rust kernel
`cadKernelSupervisor.js:86` resolves `cad-kernel/target/release/cad-kernel` (old Rust path); the C++ kernel builds to `cad-kernel-cpp/build/cad-kernel`. The file's own docs say to enable autospawn in production — doing so launches a stale, NAMING-mismatched binary (cache-poison or hard failure).
**Fix:** repoint the default candidate, update comments; or delete autospawn in favor of compose-managed lifecycle. (Related cleanup: the retired `cad-kernel/` Rust tree still on disk is what makes this dangerous instead of merely broken.)

### P3. VCS mutations are non-transactional and race-prone
- `checkin` = createCommit → updateBranch → model.update as three independent writes (`vcsWorkingCopy.js:176-196`); `release` chains six (`vcsRelease.js:23-53`, acknowledged "not transactional" at `controller.js:244`). A crash mid-verb leaves refs/model/tags disagreeing — the orphan-release-commit corruption already seen in dev.
- `updateBranch` has **no compare-and-swap** (`vcsService.js:162-170`): two concurrent releases to `main` silently orphan one commit.
- `productionRelease`'s write-once tag escapes its surrounding transaction (`controller.js:657`) — a rollback strands a tag that blocks retry.
**Fix:** wrap every VCS verb in a transaction; conditional-update refs (`WHERE targetHash = :expected`); pass the txn into `createTag`.

### P4. CI's real-geometry gate can pass while testing nothing
`cad-kernel-e2e` warns-and-skips to **green** when the kernel image can't be pulled (`ci.yml:193-199`), and runs against the stale master image even for PRs that change kernel source. Meanwhile all 71 backend CAD suites mock the kernel on SQLite, the C++ kernel has **zero unit tests**, and CI runs only on PRs — merges and `v*` release tags execute no tests at all.
**Fix (minimum gate):** make the kernel job fail on missing image; build the PR's own kernel when `cad-kernel-cpp/` changed; add push/tag triggers. (Fuller program under "Testing" below.)

---

## HIGH — first multi-user week will hit these

### H1. Kernel throughput ceiling + timeout inversion
All geometry serializes through **one shared TCP connection**, and the kernel reads one request per connection at a time — concurrent regens from different users head-of-line block (`cadKernelClient.js:214`, `main.cpp:346-372`). Worse, the client's 30s timeout < kernel's 60s op timeout: a slow op gets a misleading client-side timeout while continuing to block the shared pipe for up to 60s, and its late response is silently dropped (`cadKernelClient.js:44,94-98,180-183`).
**Fix:** small connection pool (kernel is already thread-per-connection and stateless); client timeout ≥ kernel timeout + margin. Exports need their own timeout and size bounds (in-memory base64 of whole STL/STEP can OOM the parent — `op_boolean.cpp:316-376`, `main.cpp:251`).

### H2. Kernel network surface is open and uncapped
Binds `0.0.0.0:9876`, no auth/TLS, no connection cap (each accept detaches a thread) — anything that can reach the port can submit arbitrary ops (`main.cpp:395,420`). Fine on an isolated Docker network, but that isolation is currently an accident, not a policy.
**Fix:** document/enforce internal-network-only; cap concurrent connections; consider a shared-secret header.

### H3. Expensive endpoints under-gated
`regenerate`, `reconcile/preview`, and commit body-diff each drive full kernel regens but require only `cad.read`, with **no rate limiting** on any cad-model route (`routes.js:47,57,69`). A read-only user can saturate the kernel (which, per H1, starves everyone).
**Fix:** gate regen-class endpoints behind `cad.write` + per-user rate limits.

### H4. Data-loss UX holes in the editor
- **No `beforeunload`/`CanDeactivate` guard anywhere**, and `ngOnDestroy` never flushes the 500ms debounced save — closing the tab within the debounce silently drops the edit (`cad-editor:7082,13760`).
- **Check-in race:** `onCheckin()` doesn't flush the pending debounced save — a fast user commits a revision missing their last edit (`:14620`).
- **Same-user two-tab clobber:** both tabs hold the lock, PATCH carries no version/If-Match — last write wins undetected (`cad-model.service.ts:64`).
**Fix:** beforeunload + route guard + destroy-flush (S); await pending save before check-in (S); doc-version on PATCH (M).

### H5. Locking/collaboration model is single-editor by construction
One shared working-copy row per model: two users can't even *view* different branches concurrently; a branch switch in one window flips it under the other. Plus lock races: expiry sweep never scheduled (`sweepExpiredLocks` has no caller), force-unlock can interleave with an in-flight save (no row lock), and takeover inherits the prior user's dirty autosave.
**Fix (bounded):** schedule the sweep, make lock transitions conditional updates, record force-unlocks. **Fix (structural, later):** per-user working copies.

### H6. Cache-poison handshake bypass
The naming-version guard is skipped when a kernel's `ping` lacks a numeric `namingSchemaVersion` (`cadRegenService.js:276-287`) — an old kernel would regenerate and upsert stale geometry under the current NAMING, and cache hits keep such rows warm forever.
**Fix:** treat missing version as hard mismatch for non-mock clients.

### H7. Persistent naming is heuristic and will misbind after upstream edits
Edge ids are positional and reshuffle on merges; boolean results re-tag all faces with centroid+normal proximity matching; host-face fallback is "nearest parallel face" (`cadRegenService.js:411,3627-3728`). Sketches/features can silently latch onto the wrong physical face/edge after an upstream edit. Compounding it: parallel meshing is nondeterministic while face-owner matching keys off the first mesh vertex normal (`geom_io.cpp:228`, `cadRegenService.js:3641-3667`) — cold rebuilds can flip results run-to-run.
**Fix (near):** derive representative normals from analytic surfaces, not mesh order. **Fix (real):** kernel-side boolean history / stable topological naming — the known architectural debt.

---

## MEDIUM

| Area | Finding | Fix direction |
|---|---|---|
| VCS | No garbage collection: archived branches/stashes/failed releases leave commits + frozen BReps forever; no repo-repair CLI for the known corruption modes | Mark-and-sweep GC over refs + repair tool |
| VCS | Missing frozen blob → **silently empty** released geometry (`vcsFreeze loadFrozenGeometry` defaults to `{}`) | Throw on missing referenced objects |
| VCS | Audit trail misses checkout/checkin/force-unlock/branch ops/workflow transitions (`controller.js:108-115`) — force-unlock especially, for a QMS system | Emit history rows for all verbs |
| API | `featureTree`/`sketchDoc` persisted with zero schema validation and no size ceiling (50MB global body limit only) | Validate shape + per-doc byte cap with clear 413 |
| Kernel | Numeric input validation inconsistent (`op_extrude` accepts 1e300 distances; shell/blend ops do guard) | Central finite+range-checked accessor |
| Kernel | Backstop watchdog is a single global deadline that concurrent ops clobber and that kills the whole server if it fires | Per-op deadline or remove (fork-wait is the real enforcement) |
| Kernel | Timeout-killed export children leak `/tmp/cad-export-*` files | unlink-on-create or startup sweep |
| Frontend | Cherry-pick UI = two `window.prompt`s for commit hash + feature id (dev-only usability); prompts also used for rename/branch/dimension flows | MatDialog pickers |
| Frontend | WS `auth-failed` only console.warn'd (silently degrades to HTTP regens) | Surface a banner |
| Testing | VCS concurrency untested (and untestable on SQLite); no Postgres-backed race suite | `Promise.all` race tests against Postgres |
| Ops | No metrics/alerting: kernel restarts, regen latency, cache size, lock takeovers are all `docker logs` archaeology | Minimal counters + a restart alert |

---

## QMS / process gate

- **388 unapproved requirements** in the CAD category (category 37). Under the project's own design-controls process, production means approve → link verification → validate. This is a review-and-approve campaign, not code work, but it is on the critical path if "production" carries its QMS meaning.
- The ~60-case 3D feature catalog has only ~14 automated; the rest are documented as manual browser verification. Validation evidence for a release would today be mostly manual.

---

## Functional gaps (inventoried; distinct from the engineering gaps above)

Full detail lives in `sketch-feature-gap-analysis.md`, `sw-onshape-divergence-review.md`, `sketch-constraints-review-2026-07-09.md`, `assembly-feature-gap-analysis.md`, `regen-onshape-parity.md`. The deduplicated top of the list:

**Blockers-by-workflow (users hit these immediately):**
1. **No CAD import** (STEP/IGES/STL) — every vendor part must be remodeled by hand. The docs' own #1 critical gap. Needs a "body-only, no feature tree" model kind.
2. **No 2D drawings** — no sheets/views/GD&T/title blocks. Partly offset by the EngineeringMasters work-instruction system, but there is no manufacturing-drawing path. Docs class it a large separate subsystem.
3. **Merge has no 3-way base** — two-way diff with all-ticked defaults can revert main-only edits and silently drops branch equation changes.
4. Checkout/branch model is single-editor (see H5).

**Significant but not blocking:** sweep/loft guide curves + twist; variable fillet UI, face/full-round fillets; draft, rib, thin-feature; split/scale body; sketch-driven & curve-driven patterns; STEP assembly export is flat (no product structure); STL tolerance not exposed; exploded views are a dead backend stub; BOM sync destructively replaces curated rows; four mate types wired but unverified end-to-end (all 8 are creatable in UI; concentric/parallel/perpendicular/tangent lack test coverage); curve entities (ellipse/spline) not solver-constrainable or extrudable; regen performance re-serializes the body per op (~2-3s/boolean on large parts — phased fix designed in `regen-onshape-parity.md`).

**Intentional non-goals (per docs):** sheet metal, surface modeling, external PDM integration, 3D sketch, hyperbola/derived sketches.

---

## Suggested path to production (phased)

**Phase 0 — deployability (days):** P1 prod compose + deploy verification; P2 supervisor path (or removal); H2 network isolation policy; H6 handshake hardening.

**Phase 1 — integrity (1-2 weeks):** P3 transactional VCS verbs + ref CAS; H4 editor data-loss guards (all three are small); scheduled lock sweep + audited force-unlock; frozen-blob loud failure; doc validation/size caps.

**Phase 2 — regression protection (1-2 weeks):** P4 CI gates (fail-on-missing-kernel, push/tag triggers, PR-built kernel); C++ test target (Catch2) in the kernel image build; grow golden-geometry cases from 14 toward the 60-case catalog with volume/bbox assertions; one real-kernel Playwright smoke (sketch→extrude→assert solid); Postgres race suite.

**Phase 3 — multi-user scale (2-4 weeks):** H1 connection pool + timeout sanity; H3 endpoint gating/rate limits; H5 structural (per-user working copies) if concurrent editing is actually required; VCS GC; minimal observability.

**Phase 4 — workflow completeness (ongoing):** STEP import → 3-way merge → drawings, in whatever order the actual users' workflow demands; QMS approval campaign for the 388 open requirements in parallel.
