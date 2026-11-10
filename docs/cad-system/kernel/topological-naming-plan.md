# Topological naming — design (REQs 1035–1039)

> **System** ▸ [Kernel](../20-kernel.md) ▸ [Persistent naming](./persistent-naming.md) ▸ **Topological naming plan**

## Problem

Face ids today are positional. After every boolean / fillet / shell / pattern,
`tessellate_generic` renames **every** face of the result
`{"feature_id":"<feature>#body#body0","role":"side","sub_index":N}` where `N` is
the face's rank in a centroid-lexicographic sort. Adding or removing any face
with a smaller X renumbers every face after it. Edge ids (`eN`) and vertex ids
(`vN`) are positional too.

Everything that stores a face/edge reference therefore misbinds after an
upstream edit: sketch hosts (`hostId`), extrude Up-to-Surface, datum
plane/point face refs, on-edge sketch constraints, assembly mates (exact id
lookup, no fallback). The codebase grew per-feature geometric fallbacks
(`fallbackPlane`, nearest-parallel-face) to paper over it. Real case: sketch
`s0x08290j0` on part 1554 was hosted on "side 93" (the top face); a later
upstream change made #93 a side wall and regen moved the sketch onto it.

## Goal

A face keeps its identity for as long as any part of it exists, independent of
its position in any list. New faces get identities derived from what created
them, not enumeration order. Edge and vertex ids derive from face identities.

## Design

### 1. Names travel with the geometry (BRep trailer)

Every BRep the kernel emits carries its face names as a trailer appended to the
BinTools bytes, inside the same base64 string:

```
[BinTools bytes][names JSON array][u64 length][8-byte magic "LWNAMES1"]
```

The array is aligned with `TopExp::MapShapes(shape, TopAbs_FACE)` order (stable
across a BinTools round trip — verified). `brep_from_base64` strips and returns
it; BReps without a trailer (pre-change cache rows, frozen geometry) read as
unnamed. Because the names ride inside `brepBytes`, every backend call site,
the BRep cache and frozen commits carry them with **no backend plumbing**.
BReps never leave the system raw (STEP/STL exports go through the kernel).

### 2. Name transfer (`naming.cpp`)

Each op registers its named inputs, builds its result, then calls one
`name_result()` pass that assigns every result face a name in priority order:

1. **Inherit (same surface + overlap).** A result face that lies on the same
   underlying surface as an input face (unoriented: cut-tool walls come back
   reversed) and overlaps it inherits that input's name. Overlap = an interior
   point of the result face lies in the input face, or an interior point of the
   input face lies in the result face (catches merges). Surface equality is
   analytic for planes/cylinders/cones/spheres/tori, sampled for the rest.
   No OCCT history needed, so it covers every op, including steps OCCT keeps
   no history for (blend-corner refit, the shell hole-tube fallback).
   - **Split:** several result faces inherit the same name → each gets
     `"split":k` (k by interior-point order). References to the unsplit name
     resolve to the piece nearest the stored fallback geometry.
   - **Merge:** a result face inheriting several names keeps the smallest as
     its id and lists the rest in `aliases`.
2. **Op-specific generator.** Shell: an inner wall that is the offset of input
   face X is `{feature, "offset", upstream_refs:[h(X)]}`. Pattern / mirror /
   copy: each instance's input names are transformed with the instance and
   qualified `"instance":"<feature>#k"`.
3. **Neighbors.** Remaining new faces (blend faces, cut floors not on a tool
   cap, …) are `{feature, "new", upstream_refs: sorted h(named neighbors)}`,
   with `sub_index` disambiguating identical neighbor sets (by interior point).
   Iterates to a fixpoint so faces adjacent only to new faces get named next.
4. **Last resort:** positional within the feature (faces with no named
   neighbor at all — only happens for a body built entirely from nothing).

`h(x)` = 12-hex FNV-1a of the name string, so names stay bounded in length.

**Base features** (extrude/revolve/sweep/loft) name their prisms as today
(`cap-top`, `cap-bottom`, `side`), except extrude side faces are keyed by the
**sketch entity** of their profile segment (`upstream_refs:[entityId]`, plus a
segment ordinal when one entity yields several segments) instead of the
in-plane angle sort, so adding a line to a sketch no longer renumbers every
side wall. Revolve/sweep/loft keep their positional side naming in v1.

**Cross-body uniqueness.** The viewer keys faces globally by id, so a cut
through two bodies must not put the same tool-wall name in both. Compose ops
(`buildBoolean` with `bodyId`) qualify names inherited from operand B with
`"body":"<bodyId>"`. This replaces the backend's `_scopeComposedFaceIds` /
`_scopeFeatureFaceIds` rewrites.

### 3. Edges and vertices

- Edge id = `e:` + h(sorted names of its two faces) + `:k` when several edges
  share the same face pair (k by midpoint order).
- Vertex id = `v:` + h(sorted names of its adjacent faces) + `:k`.

Stable whenever the adjacent faces are, which is the whole point.

### 4. Ownership

`faceOwners` (REQ 892) becomes the root feature of the name (`instance`
feature for copies), replacing the centroid+normal carry and its documented
approximation.

### 5. Migration (legacy ids)

Every face/edge/vertex the kernel emits also carries `legacyId` — the id the
old positional scheme would have produced for the same shape (same scope
string). The backend:

- registers legacy ids as aliases in `faceMap` / `vertexMap` / edge lookup, so
  an un-migrated doc regenerates exactly as it did before;
- applies the old body-scoping rewrite to legacy ids, so they match what was
  stored;
- returns `idMigration: { faces }` (legacy → stable) in the regen result.

The editor rewrites stored face references found in `idMigration` (extrude
start/end faces, datum refs, shell and hole face ids, assembly mates) and
saves. A sketch whose host id is legacy takes the face the backend actually
resolved it onto (`sketchHostFaces`), because a legacy id may already have
drifted onto another face.

**Edges and vertices are not migrated.** A legacy face id names the feature
that produced it, so it means exactly one face. A legacy edge/vertex id
(`<body>/e19`) is positional within the body and means a different element
after every feature — a single legacy → stable map picks the wrong stage
(found on part 1554: it re-pointed a sketch's on-edge refs). Those refs keep
resolving through the legacy aliases, exactly as before; migrating them needs
per-reference resolution at the feature that consumes them (follow-up).

`NAMING_SCHEMA_VERSION` / `NAMING_VERSION` 50 → 51 (cache rebuild).

## Limits (v1)

- Revolve/sweep/loft side faces stay positional within their own feature
  (their faces are stable downstream once created).
- A face that is entirely removed and a new one created in the same place is a
  new face (correct — the old reference reports dangling instead of silently
  rebinding).
- Region indices (`#m0`, `#3`) still scope multi-region extrude names, so
  changing a multi-region selection renames that extrude's faces.

## Verification

- Kernel smoke tests: top face name survives a cut added at smaller X; split
  face pieces carry `split`; merged coplanar faces alias; blend face name
  stable when another fillet is added elsewhere; edge id stable across an
  unrelated cut; trailer round trip; legacy ids match the old scheme.
- Backend: owners from names; legacy aliases in faceMap; `idMigration` shape.
- Frontend: reference healing from `idMigration`.
- Real model: part 1554 sketch host stays on the top face; a regen of the
  face-migrated doc matches the unmigrated one volume-for-volume.
