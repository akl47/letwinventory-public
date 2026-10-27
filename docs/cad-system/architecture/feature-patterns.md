# Feature-based Patterns & Mirror (SolidWorks-style)

## Goal

Extend Linear Pattern, Circular Pattern, and Mirror so they can repeat **features**
(re-applying the feature's add/cut at each instance), not only whole **bodies**. A
Features/Bodies toggle in each dialog selects the mode — matching SolidWorks / NX /
Onshape / Fusion. Body mode is unchanged.

Scope (confirmed): all seed feature types, **including** fillet / chamfer / shell, via a
universal geometry-delta approach (below).

## Why body patterns are wrong for features

Today `mirror` / `linearPattern` / `circularPattern` call the kernel `buildPattern` on a
finished body BREP — they copy the *result*. Patterning a cut that way copies the
already-cut body N times (N floating shells), instead of cutting the body N times. Feature
patterning must re-apply the *operation*.

## Universal geometry-delta model

Per-type "tool" logic doesn't generalize to fillet/chamfer/shell (no tool prism). Instead,
for **any** seed feature F we capture the affected body's BREP immediately **before** and
**after** F during regen, then:

- `removed = before − after`  → the solid F carved away (cut, hole, fillet round-off,
  chamfer corner, shell cavity)
- `added   = after − before`  → the solid F added (boss extrude, revolve, sweep, loft)

A feature is usually purely additive (removed = ∅) or purely subtractive (added = ∅), but
the model handles both at once, so it's correct for every feature type with one code path.

Pattern application, per seed, per copy transform `Tᵢ` (i = 1..N−1; the source instance is
already in the body):

```
body = body − Tᵢ(removed)        // re-cut
body = body ∪ Tᵢ(added)          // re-fuse
```

Mirror = the same, with a single mirror transform.

## Layers

### Kernel — new op `buildFeaturePattern`
`cad-kernel/src/ops/feature_pattern.rs`, dispatched in `server.rs`.

Params: `{ beforeBrep?: string, afterBrep: string, bodyBrep: string, transforms: PatternTransform[] }`
(reuses the existing `PatternTransform` enum). Steps:
1. `removed = before.subtract(after)`, `added = after.subtract(before)` (skip `removed`
   when `before` absent/empty — a body-seeding feature).
2. For each transform: `body = body.subtract(Tᵢ(removed)).union(Tᵢ(added))`.
3. Serialize + tessellate + `decompose_into_solids` (same result shape as `buildPattern`,
   so the backend composer is unchanged: multi-body fan-out for disjoint results).

One RPC per (seed × pattern). Reuses `apply_transform`, `subtract`, `union`,
`decompose_into_solids`, tessellation helpers from `ops/pattern.rs`.

### Backend — `cadRegenService.js`
1. **Snapshot plumbing.** In the main feature loop, record each feature's targeted body
   before/after BREP into `featureSnapshots: Map<featureId, { bodyId, before, after }>`.
   `before` is '' for a body-seeding feature. Captured for every feature (cheap — the BREPs
   already exist on the `bodies` array); only read when a pattern references the seed.
2. **New dispatch path.** When a pattern/mirror feature has `seedKind === 'features'`,
   route to `_dispatchFeaturePattern` instead of `_dispatchPattern`. It:
   - resolves `seedFeatureIds` → their snapshots (error if a seed is missing/downstream),
   - computes the copy-transform list via the existing `_computePatternTransforms`
     (excluding identity),
   - for each seed in tree order, calls `buildFeaturePattern(before, after, targetBody,
     transforms)` and adopts the result solids into `bodies` (reusing the
     `adoptSolid` / multi-body fan-out from `_dispatchPattern`),
   - face names scoped `${patternId}#seed${F}#inst${i}` for stability.
3. **Cache key** over: op, transforms, `seedFeatureIds`, each seed snapshot hash, target
   body hash.
4. `NAMING_VERSION` bump (new face provenance).

### Frontend — `cad-editor` + `types.ts`
1. **Types.** `LinearPatternFeature` / `CircularPatternFeature` / `MirrorFeatureFeature`
   gain `seedKind?: 'bodies' | 'features'` (default `'bodies'` for back-comat) and
   `seedFeatureIds?: string[]`. (Body mode keeps the implicit/most-recent-body behavior.)
2. **Dialogs.** Each of the three pattern/mirror sidebars gets a Bodies/Features toggle.
   In Features mode, a seed-feature multi-select (from the feature tree, upstream features
   only) replaces the body target. Commit gating requires ≥1 seed in Features mode.
3. **Preview.** Feature-mode preview is best-effort: show the body-pattern ghost as an
   approximation (exact result on commit), or skip — TBD; correctness is on regen.

## Phasing

- **P1**: kernel op + backend snapshots + `_dispatchFeaturePattern` + types + a minimal
  Features/Bodies toggle on **Linear** pattern, end-to-end. Validates the delta engine on
  extrude/cut/hole.
- **P2**: extend the toggle to Circular + Mirror (transform-list only; engine unchanged).
- **P3**: verify fillet/chamfer/shell seeds (should "just work" via the delta) + edge cases
  (multi-body seeds, seed ordering, suppressed seeds).
- **P4**: preview polish, requirements coverage, tests.

## Known limitations (v1)

- **Geometry pattern semantics**: instances copy the seed's resolved delta geometry; they
  do **not** re-evaluate end conditions (e.g. an Up-To-Body cut won't re-solve its cap at
  each instance — it copies the original capped tool). This matches SolidWorks' "Geometry
  pattern" option, which is the common/fast mode.
- Per-instance seed interaction follows tree order, all instances per seed (not interleaved
  per instance) — differs only for seeds that interact, which is rare.
