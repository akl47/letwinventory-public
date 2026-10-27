# Regeneration parity with Onshape

Where our 3D-reconstruction / cache model sits relative to Onshape, what already
matches, and the remaining gap plus a phased plan to close it. Written after the
part-573 slowness investigation (REQ 878–880).

## How Onshape regenerates (from docs + Parasolid-class behaviour)

- **Resident modeling session.** Each Part Studio holds a live Parasolid model
  server-side. An operation mutates the resident B-rep in place — no
  serialize/deserialize of the whole body between features.
- **Whole-Part-Studio cache validity.** "If the cache is valid, then there is no
  regeneration of the Part Studio."
- **Rollback is a marker move.** "Roll to here" / "Roll to end" scrub over
  already-computed rollback states — zero server recompute to view an earlier
  state.
- **Resume from the edit point.** Editing feature *k* recomputes *k → end*
  against the resident state left after *k-1*; upstream features are untouched.
- **Lazy tessellation.** Graphics refine on demand ("selecting an instance
  forces its tessellation to be refined first, before any others").

## How we regenerate today

- **Stateless kernel.** Every `buildBoolean` re-parses both operands from base64
  and re-serializes the result. The downstream compose chain re-ships the full
  body (~670 KB for the text-cut part) per feature.
- **Content-hash cache** (`DesignBRepCache`, keyed `paramHash` + chained
  `upstreamHash`). Upstream-of-edit features hit; the edit + downstream miss.
- **Full walk from index 0 every regen.** No "start-from" index — only
  `rollbackBeforeIndex`, an *end* cutoff.
- Triggers: 500 ms-debounced save→regen, immediate for undo/load/kernel-recover,
  sketch-mode suppression, cache-only repaint when an edit sidebar opens.

## What already matches Onshape

- **Kernel-level "cache valid → no regen":** the per-feature content-hash cache
  means an unchanged feature does **zero kernel work** — the same observable
  outcome as Onshape's cache-validity skip, at finer grain and durable across
  restarts (Onshape's session is per-open-document).
- **Edit-sidebar preview** repaints from cache with no kernel call.
- **Sketch editing** is a 2D solve; 3D regen defers to sketch exit.
- **Instant rollback** — *now implemented* (REQ 878): a rollback-bar move paints
  from the cached response and only calls the kernel when the newly-visible
  range was never computed. Previously every bar move fired a full walk.

## The remaining gap (ranked by impact)

### 1. Stateless kernel re-serializes the body per op — the dominant cost
Each downstream boolean on part 573 costs ~2–3 s, and the body round-trips as
JSON every call. Onshape mutates the resident model in place. This is the one
that explains the wall-clock, and it's a **kernel** change.

**Fix — a regen-scoped resident session / boolean chain.** Two shapes:

- **Phase A (contained, lower risk): `buildBooleanChain` RPC.** One call takes
  the base body BRep **once** plus an ordered list of `{op, toolBrep}` steps and
  applies them sequentially in-kernel (deserialize the body once, keep it live
  between steps), returning per-step `{solids, faces, topology}` so the backend
  still populates `vertexMap`/`faceMap` and emits per feature. Collapses the
  N-downstream-compose deserialize/serialize into one. Precedent: the pattern op
  already builds a compound tool and runs a single BOP (`op_pattern.cpp`).
  - *Caching interaction:* the chain runs only when the downstream tail is a
    cache **miss** (an edit invalidated it); cache the final body under the last
    feature's compose key. Partial-hit runs keep the current per-feature path.
    So the chain is the "cold downstream" fast path, not a replacement.
  - *Risk:* moderate. The per-step topology must match today's per-feature
    output exactly (persistent face names) or selections/refs drift.

- **Phase B (full resident session): body-handle API.** `openBody(brep)→handle`,
  ops take handles, `closeBody`/session teardown. Deserialize once per regen,
  reuse across every op. Biggest win, biggest change: handle lifecycle, per-
  connection isolation (thread-per-connection kernel), leak/OOM guards, and the
  cache layer (which stores BReps) must `openBody` a cache-hit BRep into the
  session. This is a design-doc-then-phased effort, not a single PR.

### 2. Re-walking the unchanged upstream prefix
Even with cache hits, each upstream feature costs a DB read + JSONB parse + face
re-scope. Onshape skips them entirely. **Safe** partial fix: batch-prefetch the
model's cache rows in one query and batch the `lastAccessedAt` bumps (removes N
reads + N writes per regen). The **unsafe** fix (skip the walk / send only
changed features) breaks `vertexMap`/`faceMap` population that up-to-face /
external refs depend on — do **not** attempt without the resident session, which
is what legitimately holds that state.

### 3. Tessellation cost per boolean
- **Double tessellation removed** (`wantFaces:"solids"`, REQ 878) — was meshing
  the whole body twice per boolean.
- **Whole-shape parallel meshing** (`ensure_meshed`, cpp-12) — *done*: replaced
  165 sequential single-face meshers with one parallel `BRepMesh_IncrementalMesh`
  over the shape. Faster and watertight (shared edges discretized once).
- **Still open — face-level mesh reuse:** we re-mesh every face even though only
  a few change. True reuse needs stable per-face identities carried across
  regens (persistent names are currently positional) — couple with Phase B.

## Recommended sequence

1. **Ship now:** instant rollback (done, REQ 878) + the safe cache-read/write
   batching (item 2, safe half).
2. **Next, deliberate:** `buildBooleanChain` (Phase A) — the biggest safe-ish
   kernel win; verify geometry byte-identical via `verify-cad-kernel.mjs` and
   the 3D-feature suite before trusting it.
3. **Later, if regen speed still hurts:** the full resident-session body-handle
   API (Phase B) — the true Onshape architecture.

Deliberately **not** doing the "skip the walk / delta-only response" shortcut:
it silently corrupts topological-naming-dependent features, which is exactly the
class of bug this subsystem is most fragile to.
