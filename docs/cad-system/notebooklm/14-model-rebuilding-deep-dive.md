# Model Rebuilding: A Deep Dive

This document is a deep technical examination of regeneration — the process that replays a part's feature tree into solid bodies. The features overview covers what the pipeline does; this document covers how it holds up under load and change: what triggers a rebuild and what suppresses one, the guard rails that run before the first feature, the content-addressed cache in full detail (including the hashing subtleties that make or break it), how results stream to the editor feature-by-feature, the rollback bar, the failure-isolation machinery, and an honest engineering comparison against how Onshape solves the same problem with the opposite architecture. The single orchestrator is `regenerateModel` in `backend/services/cadRegenService.js` — roughly four thousand lines that are the heart of the CAD system.

---

## What Triggers a Rebuild

Regeneration is HTTP-driven and stateless: the frontend posts to a regenerate endpoint with a reason, the backend replays the tree, and results stream back. Nothing about a regen persists in server memory between requests — every request re-derives everything it needs from the stored document plus the cache.

The editor requests regens with distinct reasons, and the cadence differs by reason: a **save** regen is debounced (edits made in quick succession collapse into one rebuild); **load**, **undo/redo**, and **kernel-recovered** regens fire immediately; a **rollback** regen fires when the rollback bar moves and the cache cannot cover the move (more below). Two suppressions matter as much as the triggers: while the user is in sketch mode, 2D edits do not trigger 3D rebuilds at all — sketching is a 2D solve that defers its 3D consequences until the sketch closes; and saves flagged `skipRegen` (camera views, datum visibility, renames — anything non-geometric) persist without touching the pipeline. The backend cooperates by only marking the model dirty, and only stamping the content-save timestamp, when the feature tree, sketches, or equations actually changed.

---

## Before the First Feature: The Guard Rails

`regenerateModel` runs four setup stages before touching any feature, in a fixed order.

**The naming handshake.** The backend pings the kernel and compares the kernel's reported naming-schema version against its own compiled-in constant (currently 45). On mismatch, regeneration refuses to run. This guard exists because the failure it prevents is uniquely nasty: a stale kernel binary producing output under an old naming scheme would write rows into the content-addressed cache under the *new* version key — poisoning the cache with data that every subsequent regen would happily reuse, with warm access timestamps that defeat the eviction sweep. A hard stop at the door is the only reliable defense.

**Equation and configuration resolution.** Every drivable parameter is overwritten with its resolved numeric value — global variables, dotted target paths, and any active configuration's overrides (variable values and per-feature suppression), including the per-instance configuration an assembly may request. Everything downstream, including the cache hashing, sees only settled numbers.

**Text and external-reference resolution.** Sketch text placeholders (part number, revision, equation globals) are resolved through a per-regen resolver, and cross-part in-context references are projected into per-sketch edge maps once, up front. Both are per-request state — deliberately not module state, so concurrent regens of different models cannot bleed into each other.

**The rollback cutoff.** If a rollback bar position accompanies the request, features at or past that index are excluded from the walk entirely — no kernel calls, no cache lookups, no emitted results.

---

## The Cache, In Full

The cache is the difference between "edit a dimension, wait one second" and "edit a dimension, wait ninety." Its design decisions repay close attention.

### The key

Each cached row is keyed by five values: the model id, the feature id, a `paramHash`, an `upstreamHash`, and the naming version. `paramHash` is a truncated SHA-256 over a canonical JSON serialization of the feature's *fully resolved* inputs — profile geometry, sketch plane, distances, flags, end conditions. `upstreamHash` chains the dependency structure: a composition step (fusing a prism into the running body, cutting a hole, combining bodies) keys its `upstreamHash` off the body it operates on, so an upstream edit invalidates precisely the downstream chain and nothing else. Per-region prism builds — which depend only on their own sketch and parameters — carry an empty upstream hash, which is why editing feature eight never rebuilds feature three's prism.

There is no explicit invalidation anywhere. Rows are never deleted on edit; they simply stop being *reachable* because the current computation's key no longer matches. Old rows age out through a timestamp-based eviction sweep (every cache hit bumps a last-accessed timestamp). The table is disposable by construction — dropping it entirely loses nothing but time.

### The hashing subtlety that mattered: float quantization

Content addressing lives or dies on "same meaning, same bytes." A real bug class emerged from double-precision noise: profile coordinates and sketch-plane vectors derived from projections and centroid computations carried differences on the order of 10⁻¹², producing distinct hashes for geometrically identical inputs — and one spuriously-changed prism hash invalidates its entire downstream composition chain. The canonical serializer now quantizes non-integer numbers to nine decimal places before hashing (and normalizes negative zero), so equivalent geometry hashes identically. It is a mitigation with an honest boundary: values that genuinely straddle a quantization boundary can still flap.

### The fuse cache

A multi-region extrude — the nine letters of an engraved word — builds one prism per region, each individually cached. But the *fusion* of those prisms into one compound used to re-run on every regen even when every prism was a cache hit: eight sequential boolean operations at roughly a second each, purely wasted. The fused result is now cached under a synthetic feature id (`<featureId>#fused`) whose parameter hash is simply the list of the region prisms' hashes — if every input hash matches, the fused output is served from cache, and a warm regen of a text-engraved part touches the kernel zero times. On a miss, the fuse itself uses the kernel's fuse-many operation (one N-way boolean instead of N−1 pairwise ones), named to produce byte-identical face names to the pairwise chain it replaced, with an automatic fallback for older kernel binaries.

### The body-volume cache

The editor's mass readout uses exact OCCT volumes, not mesh integration (chord-tolerance tessellation systematically under-counts curved surfaces). Those exact-volume queries were being re-sent on every regen even for fully cached bodies; an in-process memo keyed by each body's parameter hash (capped, oldest-evicted) eliminated them. It is the one deliberately in-memory cache in an otherwise database-backed design — safe because a volume is a pure function of the body's content hash.

### What the cache does *not* fix

A cache hit still requires the walk to reach it: every regen iterates from feature zero, computing hashes and consulting the cache per feature. Skipping the walk for an unchanged prefix looks tempting and was explicitly rejected — the walk populates the vertex and face maps that up-to-face end conditions and external references resolve against, and a skipped walk silently breaks them. The sanctioned optimization is batching: prefetch cache rows in bulk and batch the access-timestamp bumps, keeping the walk but shrinking its per-feature latency.

---

## Streaming Results to the Editor

The response is not one blob at the end. As each feature completes, a per-feature result event is broadcast over a WebSocket channel — bracketed by started/complete events and tagged with a regen id so a superseded regen's stragglers are discarded. The editor maintains geometry *per body*: each event carries the latest state of the body the feature contributed to, keyed by a stable body id and stamped with the body's parameter hash. Two consequences:

- **The tree lights up in real time.** Feature errors and completions appear feature-by-feature during a long rebuild rather than all at once at the end. The final HTTP response is the canonical truth the editor reconciles against.
- **Redundant repaints are skipped.** A feature whose body hash matches the last emitted state for that body emits nothing — downstream cache hits do not repaint the viewer.

The kernel side cooperates on tessellation cost. Composition operations request per-solid tessellation only (the compose pipeline never consumes the top-level result's faces), halving meshing work. And meshing itself is one parallel whole-shape pass rather than sequential per-face invocations — watertight, since shared edges are discretized once.

---

## The Rollback Bar and Instant Rollback

The rollback bar is a movable marker in the feature tree: features below it are temporarily excluded, exactly as in SolidWorks. The insight worth recording is what moving the bar should *cost*. In the stateless design, a naive implementation regenerates on every bar move — punishing for precisely the exploratory "scrub through history" gesture the bar exists to serve.

The fix is a coverage check on the client: given the set of features whose results the editor already holds from the last regeneration, moving the bar *up* requires no new geometry at all if every visible solid feature above the new cutoff is in that set — origin, datums, suppressed, and hidden features are excluded from the requirement. When coverage holds, the editor repaints entirely from held per-body results, kernel untouched, and the bar move is instant; only when coverage fails (the bar exposes a feature whose result the editor never received, or a prior regen errored) does it fall back to a real rollback regen. The bar position still rides along on subsequent saves so the backend excludes rolled-past features from future walks.

This intentionally mirrors Onshape's semantics: rollback is a *marker move*, not a rebuild.

---

## Failure Isolation

A four-thousand-line pipeline orchestrating a crash-prone geometry engine earns its keep in the failure paths.

**Per-feature error capture.** Each feature's error is recorded on its own result; errors accumulate and stream, and the walk continues. One broken fillet does not abort the part.

**Per-region skip.** Within a multi-region extrude, each region's kernel build is individually guarded. A region the kernel cannot build — a pinched, self-touching arrangement face — is skipped with a warning while the remaining regions build. Before this isolation, one bad region cascaded: broken body, up-to-condition failures downstream, face-hosted sketches reporting their host gone. The honest cost: a feature can now "succeed" with a region silently missing except for a toast warning.

**Reference healing.** End conditions and sketch hosts survive the kernel's face re-tagging. Up-to-body targets resolve by stable body id at regen time (with an actionable error if the target does not exist yet at that tree position: "pick a body that already exists before this feature"). Start conditions, offset surfaces, and second directions carry frozen plane snapshots as fallbacks, so a re-tagged reference face still resolves to a plane instead of failing.

**Dangling host-face detection.** After the walk, every face-hosted sketch is checked against the final face map. An exact hit is resolved; a *coincident, parallel* face within tight tolerance is treated as a mere re-tag (same geometry, new name — the boolean-merge case) and silently re-bound; anything else marks the sketch dangling, and the backend's dangling list is authoritative — the frontend does not second-guess it with its own geometry checks. The user gets a warning naming the sketch and asking them to re-pick the reference face, and a map of resolved host faces powers the 3D highlight.

**The kernel's own resilience** — input validation, restart-on-abort, watchdog-on-hang — is covered in the kernel deep dive; from the pipeline's perspective it means a kernel call either returns, fails with a readable error, or fails with a disconnect that the next regen recovers from.

---

## The Onshape Comparison: Stateless vs. Resident

The system's regeneration architecture was deliberately benchmarked against Onshape's, and the comparison is documented as an engineering roadmap rather than a scorecard.

**Onshape's model:** a resident geometry session per document. The B-rep lives in kernel memory and is mutated in place, feature by feature; nothing serializes between features; rollback is a pointer move; rebuilds resume from the edit point; tessellation is lazy. **This system's model:** a stateless kernel where every boolean re-parses both operands from serialized bytes and re-serializes the result — a ~700 KB body round-trips as base64 JSON per feature — and every regen walks from feature zero.

What the stateless design already matches: the per-feature content-hash cache is *finer-grained* than whole-document validity and survives server restarts; edit previews repaint from cache; sketch editing defers 3D; rollback is now instant when covered. What it concedes: on a deep part, the serialize/deserialize tax on every downstream boolean is the dominant regeneration cost — measured at multiple seconds per downstream feature on the motivating part.

The ranked plan, from cheapest to most invasive: batch the cache reads (keep the walk, shrink its latency); add a chained-boolean kernel operation that applies an ordered list of operations against a body deserialized *once* — run only when a downstream tail is all cache misses, and constrained to produce byte-identical per-step topology so persistent-name references do not drift; and only if still needed, a true resident-session API where the kernel holds open body handles. Two shortcuts are explicitly rejected: skipping the unchanged-prefix walk (breaks the face/vertex maps external references depend on) and delta-only responses (silently corrupt topological-naming-dependent features). The rejections are as load-bearing as the plans — they encode where correctness beats speed.

---

## Honest Limitations

- **Positional persistent naming is the deepest constraint.** Face names for generic operations are centroid-sort positional — stable under parameter tweaks, not across topology changes. It blocks per-face mesh reuse, it is why every optimization must prove byte-identical topology, and it is the fragility the whole reference-healing apparatus compensates for.
- **The backend and frontend arrangement extractors are hand-synchronized.** Region indices stored by the picker are positional; if the server-side port of the planar arrangement ever diverges from the frontend's, the wrong regions get extruded, silently. A shared test corpus asserts parity; discipline does the rest.
- **The merged-region hole fix has a shape worth remembering.** Merging selected regions used to rebuild holes only from the selected loop set — but a letter's counter (the hole in an "O") is never itself selected, so engraved text filled in. Standalone loops now keep their containment-derived holes from full region extraction; only face-sourced arrangement selections are re-fused. The general lesson: hole ownership comes from containment analysis of the *whole* sketch, not from the selection.
- **Coverage-based instant rollback trusts the last regen.** If the previous regeneration was partial or errored, coverage fails conservatively and a real regen runs — correct, but it means an errored tree scrubs slowly.
- **Quantized hashing is a mitigation, not a proof.** Values near the nine-decimal boundary can still flap between hashes.
- **A skipped region is a quiet failure.** Isolation keeps the part building, but the only signal that a region went missing is a warning toast.

---

## Key Points

- Regeneration is stateless and HTTP-driven: reasoned triggers (debounced save, immediate load/undo/rollback), sketch-mode suppression, and `skipRegen` for non-geometric saves; every request re-derives its state from the document plus the cache.
- Four guard rails run before the first feature: the kernel naming-schema handshake (refuses to regen against a stale binary rather than poison the cache), equation-and-configuration resolution to plain numbers, per-request text/external-reference resolvers, and the rollback cutoff.
- The cache key is (model, feature, `paramHash`, `upstreamHash`, naming version); `upstreamHash` chains composition steps to the body they operate on while per-region prisms stay independent; invalidation is purely by unreachability plus timestamp eviction.
- Float quantization (nine decimals, minus-zero normalized) in the canonical hasher kills the double-precision-noise bug class where identical geometry hashed differently and spuriously invalidated whole downstream chains.
- The fuse cache stores a multi-region feature's fused result keyed by its region hashes — a warm regen of an engraved-text part makes zero kernel calls — and the fuse-many kernel operation replaces N−1 pairwise booleans with one, named byte-identically to the chain it replaced.
- Results stream per feature over WebSocket, keyed by body and body-hash so redundant repaints are skipped; the HTTP response is the canonical reconciliation point.
- Rollback is a marker move, not a rebuild: a client-side coverage check repaints from held per-body results when every visible solid feature above the bar is covered, falling back to a real regen only when it is not.
- Failure is isolated at every level: per-feature error capture, per-region skip inside multi-region extrudes, frozen-plane fallbacks for re-tagged references, and backend-authoritative dangling-host-face detection that distinguishes "re-tagged, same geometry" from "genuinely gone."
- Against Onshape's resident-session architecture, the dominant conceded cost is the serialize/deserialize tax on every downstream boolean; the roadmap is batch cache reads → chained-boolean kernel op → resident session, with prefix-skipping and delta responses explicitly rejected because they silently break topological-naming-dependent features.
- The deepest structural limitation is positional persistent naming — stable under parameter changes, not topology changes — which shapes both the healing machinery and which optimizations are permissible.
