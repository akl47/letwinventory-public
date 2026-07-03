# 3D feature test cases

A comprehensive, checkable enumeration of every **3D feature** — additive,
subtractive, dress-up, pattern/transform, reference geometry, and multi-body /
boolean — with the normal case and the edge cases worth verifying. The
companion to [sketch-test-cases.md](./sketch-test-cases.md): same idea, one
level up (solids instead of profiles).

Each case has a stable id (`B##` boss/additive, `U##` cut/subtractive, `D##`
dress-up, `P##` pattern/transform, `R##` reference geometry, `M##` multi-body /
boolean). Each case is its **own standalone part** — `scripts/gen-3d-test-part.mjs`
emits a self-contained `{featureTree, sketchDoc}` per case (built at the origin),
and `scripts/provision-3d-test-parts.mjs` creates one Part + CAD model per case,
named `CADTEST <id>` (CAD model `<id> — <title>`). Open each from the CAD list
and confirm it regenerates as planned.

Status legend: ✅ generated & regenerates · 🟡 generated, needs eyeball / partial ·
⬜ catalog-only (not yet generated) · ✋ needs interactive picks (no static build).

---

## 1. Boss / additive — `B`

| id | Title | What to verify | Edge cases |
|----|-------|----------------|------------|
| **B01** ✅ | Extrude — blind | profile → prism of `distance` along plane normal | zero distance rejected |
| **B02** ✅ | Extrude — mid-plane | symmetric, half each side of the sketch plane | |
| **B03** | Extrude — through all | spans the whole body envelope | nothing to pass through |
| **B04** | Extrude — two-direction | direction 1 + direction 2, each its own length/end | |
| **B05** | Extrude — flipped | grows along −normal | |
| **B06** | Extrude — start offset | profile starts at `offset` along the normal, not the sketch plane | |
| **B07** | Extrude — up-to-vertex | terminates at a model vertex | |
| **B08** | Extrude — up-to-surface | terminates on a target face | non-planar target |
| **B09** | Extrude — offset-from-surface | terminates `offset` past a target face | |
| **B10** | Extrude — up-to-body | terminates at the next body it meets | |
| **B11** | Extrude — up-to-next | terminates at the next face along the path | |
| **B12** | Extrude — multi-region | `regionIndices` picks ≥2 disjoint regions in one sketch | donut region (outer−inner) |
| **B13** | Extrude — new body | `merge:false` → independent body, not fused | |
| **B14** ✅ | Revolve — full 360° | profile + axis → solid of revolution | profile crossing axis rejected |
| **B15** | Revolve — partial angle | sweep < 360° | |
| **B16** | Revolve — two-direction / mid-plane | symmetric about the profile plane | |
| **B17** | Sweep — along open path | profile swept down a path sketch | profile not ⟂ path start |
| **B18** | Sweep — along arc/closed path | curved/closed path | self-intersecting sweep |
| **B19** ✅ | Loft — two profiles | blended solid between 2 sections on parallel planes | |
| **B20** | Loft — three+ profiles | multi-section blend | mismatched vertex counts |
| **B21** | Loft — closed / guide curves | closed loop or guide-curve-controlled | ⬜ if unsupported |

## 2. Cut / subtractive — `U`

| id | Title | What to verify | Edge cases |
|----|-------|----------------|------------|
| **U01** ✅ | Cut-extrude — blind | pocket of `distance` | cut fully through (== through all) |
| **U02** | Cut-extrude — through all | hole/slot all the way | cut that removes the whole body |
| **U03** | Cut-extrude — up-to-surface | pocket floor lands on a face | |
| **U04** | Cut-extrude — flipped | cut along −normal | |
| **U05** | Cut-revolve | revolved groove / bore | |
| **U06** | Cut-sweep | swept channel | |
| **U07** ✅ | Hole — drill, through all | straight drilled hole | |
| **U08** | Hole — drill, blind | blind drill of given depth | |
| **U09** ✅ | Hole — counterbore | stepped bore | |
| **U10** ✅ | Hole — countersink | conical seat | |
| **U11** | Hole — tapped | tapped (cosmetic thread) | |
| **U12** | Hole — multiple placements | several holes in one feature | |

## 3. Dress-up — `D`

| id | Title | What to verify | Edge cases |
|----|-------|----------------|------------|
| **D01** ✅ | Fillet — single edge | constant-radius round on one edge | radius > local geometry rejected |
| **D02** | Fillet — multiple edges | several edges, one radius | |
| **D03** | Fillet — all edges of a face | every boundary edge of a face | |
| **D04** | Fillet — multi-radius | per-edge `value` override in one feature | |
| **D05** | Fillet — tangent chain | tangent-continuous edges rounded together | |
| **D06** ✅ | Chamfer — equal | symmetric 45° bevel | |
| **D07** | Chamfer — two-distance | asymmetric legs | |
| **D08** | Chamfer — distance-angle | one leg + angle from reference face | |
| **D09** | Chamfer — multiple edges | several edges, one setting | |
| **D10** ✅ | Shell — inward, one face open | hollow body, one wall removed | |
| **D11** | Shell — multiple faces open | several walls removed | |
| **D12** | Shell — outward | material added outside | thin walls / self-intersection |

## 4. Pattern & transform — `P`

| id | Title | What to verify | Edge cases |
|----|-------|----------------|------------|
| **P01** | Linear pattern — 1 direction | N instances at spacing along an axis | |
| **P02** | Linear pattern — 2 directions | grid (dir1 × dir2) | |
| **P03** | Circular pattern — full | N instances equally spaced 360° | |
| **P04** | Circular pattern — partial | N instances over an angle | |
| **P05** | Mirror feature — datum plane | feature reflected across a datum | |
| **P06** | Mirror feature — planar face | feature reflected across a face | |
| **P07** | Mirror body | whole body reflected (keep + copy) | |
| **P08** | Move/Copy body — translate | body moved/copied by a vector | |
| **P09** | Move/Copy body — rotate | body rotated about an axis | |

## 5. Reference geometry — `R`

| id | Title | What to verify | Edge cases |
|----|-------|----------------|------------|
| **R01** ✅ | Datum plane — offset | parallel plane at `distance` from a plane/face | flipped side |
| **R02** | Datum plane — parallel through point | parallel to a plane, through a vertex | |
| **R03** | Datum plane — angle through edge | angled `angleDeg` about an edge | |
| **R04** | Datum plane — three points | through 3 vertices | collinear → rejected |
| **R05** | Datum plane — mid-plane | halfway between two planes/faces | |
| **R06** | Datum plane — line + ⟂ face | through an edge, ⟂ to a face | |
| **R07** | Datum axis — edge / two points / intersection | a construction axis | |
| **R08** | Datum point — vertex / edge-mid / face-center | a construction point | |
| **R09** | Sketch on datum plane → extrude | a user datum used as a sketch host | |

## 6. Multi-body & boolean — `M`

| id | Title | What to verify | Edge cases |
|----|-------|----------------|------------|
| **M01** ✅ | Combine — add (union) | two bodies fused into one | |
| **M02** | Combine — subtract | tool body removed from main | |
| **M03** | Combine — intersect | only the overlap remains | no overlap → empty |
| **M04** ✅ | Multi-body — independent bodies | two non-touching bodies coexist in one part | |

---

## Coverage checklist

Each case is its own part (`CADTEST <id>`). Open it from the CAD list and tick
the id once it regenerates. Each part contains a base boss (and any helper
bodies) plus the feature under test, all at the origin — dress-up / pattern /
boolean cases include their own base boss so the feature has something to act on.

> **Automated:** `scripts/verify-cad-kernel.mjs` regenerates every case against the real OCCT kernel over HTTP (create → checkout → PUT → regenerate → assert). It runs via `./scripts/run-tests.sh --kernel` locally and the `cad-kernel-e2e` CI job (pulls the prebuilt kernel image published by `publish-kernel.yml`) on every PR.
>
> Regenerate the parts with: `node scripts/gen-3d-test-part.mjs` →
> `node scripts/provision-3d-test-parts.mjs` (idempotent — reuses existing
> `CADTEST <id>` parts) → run `/tmp/upd3d_all.sql` in psql → POST
> `…/cad-model/<id>/regenerate` per model in `/tmp/3d-models.json`. Geometry refs
> (fillet/chamfer edges, hole placements, shell faces, datum/mirror planes) are
> stored **geometrically** (3D coords + fallback snapshots) computed from each
> case's known base-box dimensions — so they resolve without interactive picking
> and survive id renumbering. Cases needing genuine interactive picks are marked ✋.
