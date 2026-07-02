# Sketch Test-Case Catalog

> **System** ▸ [CAD Modeler](../10-cad-modeler.md) ▸ [Sketching](./sketching.md) ▸ **Test-Case Catalog**
> Related: [Constraints](./constraints.md) · [Profiles and arrangement](./profiles-arrangement.md)

---

A comprehensive, checkable enumeration of every sketch **element**, **constraint**, **operation**, and **sketch-level concept** — with the normal case and the edge cases worth verifying. Each case has a stable id (`E##` element, `C##` constraint, `O##` operation, `S##` sketch-level). The companion test part (`scripts/gen-sketch-test-part.mjs`) creates **one sketch per case id**, named `<id> — <title>`, so you can walk the sketch list and confirm each behaves as planned.

Legend: ✅ implemented · 🟡 partial / storage-only · ⬜ declared, not implemented.

---

## 1. Elements (entities)

| id | Title | What to verify | Edge cases |
|----|-------|----------------|------------|
| **E01** | Point | Place a free point; drag it | Origin point is immovable & undeletable; cascade-delete when its owner curve is deleted |
| **E02** | Line (2-pt) | Segment between two points | Zero-length guard; axis-aligned orientation preserved on edit |
| **E03** | Construction line / centerline | Line with `construction=true` | Excluded from profiles, still solves; dashed render |
| **E04** | Circle — center + radius | ✅ center point + radius | Degenerate radius (`r<1e-9`); full 2π sweep |
| **E05** | Circle — 3-point | ✅ circumscribed through 3 pts | Returns null on collinear input |
| **E06** | Arc — center + endpoints | ✅ center/start/end (+`ccw`) | End snapped onto radius; start==end (degenerate full circle) |
| **E07** | Arc — 3-point | ✅ circumarc + CCW/CW detect | Collinear → null; near-2π sweep |
| **E08** | Ellipse | ✅ center + major-axis end + minor radius | `minor==major` (circle); major < minor |
| **E09** | Elliptical arc | ✅ angles in local frame, `ccw`; tessellated + rendered | Full ellipse; zero-length sweep |
| **E10** | Spline (B-spline) | ✅ N control points, degree (default 3) | `N < degree+1` rejected; degree 1/2/≥4 |
| **E11** | Conic — parabola | ✅ vertex + focus + sample point | vertex==focus degenerate; sample collinear with axis |
| **E12** | Conic — hyperbola | ⬜ schema only, no tessellation | placeholder |
| **E13** | Text box | ✅ 4-corner bounded box; justify/font/mirror/rotation | outline vs single-line font; legacy anchor+size; glyph voids (inner loops) |
| **E14** | Picture | ✅ anchor + src + w/h/rotation/opacity | data-URL vs http; opacity 0..1; background-only picking |
| **E15** | Equation curve | ✅ parametric `x(t),y(t)` over `[tMin,tMax]`, samples 8..2000 | `tMin==tMax` empty; divide-by-zero sample skipped |
| **E16** | Spline-on-surface | 🟡 UV control points on a face; storage-only | no solver / no profile contribution |
| **E17** | Intersection curve | 🟡 project a 3D body onto the plane | source body deleted → empty; closed loop can bound a profile |
| **E18** | Rectangle — corner | ✅ corner-to-corner (4 lines, auto h/v + equal) | |
| **E19** | Rectangle — center | ✅ center + corner | |
| **E20** | Rectangle — 3-point (corner / center) | ✅ rotated rectangle | |
| **E21** | Rounded rectangle | ✅ corners + fillet arcs | |
| **E22** | Parallelogram | ✅ 3-point (4th derived) | |
| **E23** | Polygon (regular) | ✅ N-sided inscribed in circle | inscribed vs circumscribed |
| **E24** | Slot — straight | ✅ 2 parallel lines + 2 arc caps | |
| **E25** | Slot — straight centerpoint | ✅ | |
| **E26** | Slot — arc (3-pt / centerpoint) | ✅ curved slot | |
| **E27** | Construction-flag cascade | ✅ flagging an arc cascades to its centre + both endpoints | per-kind cascade (line/circle/arc/ellipse/spline) |

---

## 2. Constraints

Geometric (no value) and dimensional (carry `value`, can be `driven`). Multiple-dispatch variants matter — verify each entity-kind combination.

| id | Title | Targets / variants | Edge cases |
|----|-------|--------------------|------------|
| **C01** | Coincident — point/point | merges x,y (2 residuals) | duplicate-point merge (redundant) |
| **C02** | Coincident — point on line | point rides line (1 residual) | degenerate (zero-len) line |
| **C03** | Coincident — point on circle/arc/ellipse | point on curve | |
| **C04** | Fixed | pin one point | origin always re-pins to (0,0); fix then coincident-to-moving |
| **C05** | Horizontal — line / two points | `Δy=0` | nearly-horizontal redundant |
| **C06** | Vertical — line / two points | `Δx=0` | |
| **C07** | Distance (p–p) | Euclidean | `value=0` conflict; driven reads back |
| **C08** | Horizontal-distance / "Equal X" | signed Δx (Equal-X ⇒ value 0) | negative input |
| **C09** | Vertical-distance / "Equal Y" | signed Δy | |
| **C10** | Perpendicular — line/line | `d1·d2=0` | self / nearly-perpendicular redundant |
| **C11** | Perpendicular — line ⟂ model edge | external-ref (synthetic fixed line) | edge not resolved → constraint dropped |
| **C12** | Parallel — line/line | `d1×d2=0` | |
| **C13** | Parallel — line ∥ model edge | external-ref | **(was a determinacy gap — analyzer now counts it)** |
| **C14** | Tangent — line/circle | dist(center,line)=r | line through center (no tangent) |
| **C15** | Tangent — line/arc · line/ellipse | per-kind dispatch | |
| **C16** | Tangent — circle/circle (external) | centers = sumR | |
| **C17** | Tangent — circle/circle (internal) | centers = |diffR| | auto-pick by current state; concentric → undefined |
| **C18** | Tangent — arc/arc · circle/arc | | |
| **C19** | Equal — line/line (length) | | zero-length |
| **C20** | Equal — circle/circle · arc/arc · circle/arc (radius) | | chain A=B=C propagation |
| **C21** | Midpoint — point on line center | point-on-line + perp-bisector (2 residuals) | |
| **C22** | Symmetric — 2 points about a line | midpoint-on-axis + perpendicular (2 residuals) | degenerate axis |
| **C23** | Concentric — circle/arc | shared center, radii free | |
| **C24** | Coradial — circle/arc | shared center + radius (3 residuals) | |
| **C25** | Coradial — to circular model edge | external-ref `sub:center` pins center **and radius** | radius tracks edge each regen |
| **C26** | Collinear — line/line | parallel + point-on-line (2 residuals) | gap (not touching) |
| **C27** | Radius dim | `r=value` (driven reads back) | two radius dims = over-constraint |
| **C28** | Diameter dim | `2r=value` | |
| **C29** | Angle dim — line/line | `value` rad; `angleRays` lock quadrant | 0°/180° ambiguity; no shared vertex (direction-vector angle); placement quadrant (interior vs exterior) |
| **C30** | Point-line-distance (sketch) | perpendicular dist | point already on line + value≠0 |
| **C31** | Point-line-distance — to model edge | external-ref (synthetic line) | driven reference dim |
| **C32** | Arc-length dim | `r·sweep=value` | full circle = 2πr |
| **C33** | Chord-distance dim | `|start−end|=value` | 180° arc ⇒ chord=2r |
| **C34** | Radial-distance dim | `r_outer−r_inner=value` (not in toolbar) | negative gap |
| **C35** | On-edge — line (convert entities) | both endpoints pinned to projected edge | axis-aligned line keeps h/v |
| **C36** | On-edge — circle / arc | center + radius pinned to edge | |
| **C37** | On-edge — point rides edge | 1-DOF slide (live `externalEdges`) vs pinned (fallback) | |
| **C38** | Center reference — `sub:center` | point pinned to projected edge center | on a straight edge: invalid, treated as plain ride |
| **C39** | Vertex reference | point pinned to a model vertex | |
| **C40** | Cross-part on-edge | reference another component's edge (assembly) | source moved → projection updates; stale fallback |
| **C41** | Driven / reference dimension | solver skips, geometry reads back | muted color + parentheses |
| **C42** | Over-constraint / conflict rejection | adding a conflicting constraint is rejected | redundant-but-consistent accepted |

---

## 3. Operations (sketch-editing tools)

| id | Title | Inputs / variants | Edge cases |
|----|-------|-------------------|------------|
| **O01** | Trim — line | click the wedge between intersections | 0/1/2+/many hits; T-junction endpoint touches; passenger-point re-attach; on-edge inheritance; **dimensional constraints NOT inherited** |
| **O02** | Trim — circle → arc | removes swept wedge, reuses center | |
| **O03** | Trim — arc | splits into 1–2 sub-arcs | |
| **O04** | Extend — line | extend nearer endpoint to a boundary | shared endpoint → new point; exclusive → moved in place; no boundary → error |
| **O05** | Split — line at point | insert interior point, two sub-segments | endpoint rejected; no constraint inheritance |
| **O06** | Mirror — entities about a line | symmetric (points) + equal (curves) | arc `ccw` flips; axis itself excluded |
| **O07** | Offset — single curve | line / circle (inward/outward) / arc | degenerate; collapse (`r≤EPS`); construction source allowed |
| **O08** | Offset — chain (connected) | open vs closed; corner reconcile | convex (arc/miter); concave (trim); tangent corner; auto-flip side; branching fallback |
| **O09** | Offset — chain linked to source | parallel + equal + perp-distance dims | fully-constrains offset if source was |
| **O10** | Fillet — line/line | round corner, radius | radius too large → error; collinear/parallel → error; tangent-point slide anchored; **orphan corner points if the corner was dimensioned/constrained** |
| **O11** | Fillet — line/arc | tangent to both | shared-corner detection; internal vs external tangency |
| **O12** | Fillet — keep removed as construction | trimmed stubs become dashed lines | |
| **O13** | Chamfer — equal distance | symmetric cut | distance > leg length → error |
| **O14** | Chamfer — distance/distance | independent legs | vertical-line reorder |
| **O15** | Chamfer — distance/angle | leg + angle | both rotation senses tried |
| **O16** | Move entities | translate in place, ids/constraints kept | origin never moves |
| **O17** | Rotate entities | about a pivot | non-finite angle → error |
| **O18** | Scale entities | scales points + radii | negative factor (flip); `ccw` NOT flipped |
| **O19** | Copy entities | fresh ids, **no constraints** | origin reused |
| **O20** | Linear pattern | count≥2, spacing | grid layout |
| **O21** | Circular pattern | pivot + total angle + count | 360° full ring |
| **O22** | Jog — line | Z-detour at t1<t2, perp offset | interior-only; **constraints dropped** |
| **O23** | Stretch — points | translate only point entities | curves stretch naturally |
| **O24** | Convert entities / project | project model edge/vertex onto plane | live re-projection; break-link; survives trim/extend |

---

## 4. Sketch-level concepts

| id | Title | What to verify | Edge cases |
|----|-------|----------------|------------|
| **S01** ✅ | Closed profile loop | a closed, non-self-intersecting loop extracts | open chain ⇒ no loop |
| **S02** ✅ | Nested loops | a hole loop inside an outer loop | both valid; profile has a void |
| **S03** ✅ | Self-intersection rejected | figure-eight is not a valid profile (bowtie quad, diagonals cross) | |
| **S04** ✅ | Construction excluded from profile | rectangle + dashed centerline; only the rectangle extrudes | |
| **S05** ✅ | Single-circle profile | a lone circle extrudes (special-cased) | |
| **S06** ✅ | Fully constrained | rectangle pinned at origin + W/H dims → DOF = 0, status black/defined | |
| **S07** ✅ | Under-constrained | bare line, 4 free DOF highlighted | |
| **S08** ✅ | Over-constrained / conflicting | two distance dims (20 vs 30) on one pair → solver inconsistent | |
| **S09** ✅ | Origin-anchored | distance dim referencing the origin | |
| **S10** ✅ | Datum-plane placement | rectangle hosted on the **XZ** datum plane (Z-up frame), no body needed | gravity-aligned canonical orientation |
| **S11** ✅ | Dimension off origin / datum plane | vertical-distance from origin = ⟂ distance to the XZ plane (y=0) | |
| **S12** ✅ | Legacy-doc migration | hand-built `{points,lines,constraints}` blob (legacy `point-on-line`) upgrades on load | |

---

## Coverage checklist

When walking the generated part, tick each id. An entry that needs a **base 3D body** (external refs: C11, C13, C25, C31, C35–C40, O24) is created against the part's base boss feature; the rest are standalone sketches. Most sit on the front (XY) plane; **S10** is hosted on the XZ datum plane to exercise non-front placement. **S08** is intentionally left **unsolved** (its constraints conflict) so the editor flags it; **S12** is stored in the legacy schema and upgrades on load.

> **Automated:** every case is defined once in `frontend/src/app/cad/lib/test-cases/sketch-cases.ts` (`SKETCH_CASES`) and asserted by `sketch-cases.spec.ts` (builds + solves; conflicts flagged) on every frontend test run / CI push. The generator below consumes the same list, so the part and the test never drift.
>
> Generated by `scripts/gen-sketch-test-part.mjs`. Re-run after changing the sketch lib to regenerate the part. Cases marked ⬜/🟡 above are included where a representative sketch is meaningful and skipped where the feature is storage-only.
>
> Sketches carrying a constraint are **pre-solved** by the generator (real PlaneGCS, run headless in Node) so the stored geometry already satisfies the constraint — coincident points coincide, tangent circles touch, dimensioned edges hit their value. Without this, a constraint case would open showing its unsolved initial layout (the editor only re-solves on edit, not on open), which reads as "the constraint isn't working."
