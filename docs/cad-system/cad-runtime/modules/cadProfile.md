# cadProfile — Profile Extractor

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Regeneration Pipeline](../regen-pipeline.md) ▸ **cadProfile**
> Related: [cadRegenService](./cadRegenService.md) · [cadTextGlyphs](./cadTextGlyphs.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 548 | unapproved | Extract a single closed loop from sketch line segments |
| 612 | unapproved | Single non-construction circle is a valid extrude profile |
| 617 | unapproved | Typed ProfileLoop preserving curve identity (line/arc/circle/bezier edges) |
| 621 | unapproved | Multiple independent closed loops in one sketch (multi-region) |

### REQ 548 — Closed-loop extraction

- **Description:** Given a sketch, the CAD module shall extract a single closed loop of connected line segments from the sketch's non-construction geometry.
- **Rationale:** A closed boundary is the minimal requirement for defining an extrudable cross-section.
- **Verification:** Test — `frontend/src/app/cad/lib/profile.spec.ts` covers the core extraction; `backend/tests/__tests__/design/cad-profile.test.js` covers the server-side port.
- **Validation:** A user can close a polygon sketch and extrude it without error.

---

## Succinct description

`cadProfile.js` is the server-side port of `frontend/src/app/cad/lib/profile.ts`. It converts a sketch's persisted `state` (entities + constraints) into typed `ProfileRegion` objects (outer loop + holes) that the regeneration service passes directly to the kernel RPC.

## How it works — for everyone (non-technical)

A sketch contains a collection of lines, arcs, and circles. Before the geometry engine can build a solid, it needs to know: which of these form closed outlines, and which are holes inside those outlines? The profile extractor does that classification — it finds all the closed chains, tests which loops contain other loops (making them holes), and hands the result to the kernel as a ready-to-extrude cross-section blueprint.

## How it works — in detail (technical)

### Exports

```javascript
module.exports = { extractClosedLoop, extractClosedLoops, extractRegions };
```

### `canonicalizePoints(state)`

Pre-processes the entity list before any loop walking. Two sources merge point ids: explicit `coincident` constraints between two points, and spatial proximity within `1e-4` sketch units. Without this pass, a four-line square would appear to the walker as eight disconnected degree-1 vertices (the sketch editor stores fresh endpoint ids per line and links them via coincident constraints rather than sharing ids directly).

### `extractClosedLoop(state) → { loop, error? }`

Single-component walker. Special cases:

- Exactly one non-construction circle and no lines/arcs → returns a `[{ kind:'circle', center, radius }]` loop directly (REQ 612).
- Otherwise: builds a segment adjacency map (lines + arcs), rejects any vertex of degree ≠ 2 (open chain or fork), then walks the chain from an arbitrary start segment until it returns to the start point. Produces a `ProfileLoop` array of typed `ProfileEdge` objects: `line`, `arc` (with `center`, `radius`, `startAngle`, `endAngle`, `ccw`), or `circle`.

### `extractClosedLoops(state, resolve?) → { loops, errors }`

Handles multi-region sketches (REQ 621). Steps:

1. Iterates non-construction `text` entities first — calls `bezierLoopsFromTextEntity` from `cadTextGlyphs.js` to turn each glyph contour into a `bezier`-edge loop.
2. Iterates non-construction circles — each is its own loop.
3. Runs BFS over lines + arcs to find connected components, then calls `extractClosedLoop` on each component's sub-state.

### `extractRegions(state, resolve?) → { regions, errors }`

Partitions loops into planar regions (REQ 621). After extracting all loops:

- Tessellates each loop into a 2D polygon (chord tolerance 1.0) via `tessellateProfileLoopJS`.
- For each loop, samples an interior point (`interiorSample`) and tests it against every other loop's polygon using a ray-casting `pointInPolygon`.
- Builds a parent array: each loop's direct parent is the innermost containing loop.
- A loop with no parent and having zero or more direct-child loops becomes one `ProfileRegion`: `{ outer: loop, holes: [childLoops] }`.
- Returns `{ regions, errors }`.

The interior sample uses a 1%-nudge toward the centroid from vertex `poly[0]` to avoid misclassifying two concentric loops (centroid-only sampling fails for the concentric case because both centroids coincide).

```mermaid
flowchart LR
    A[sketch state\nentities + constraints] --> B[canonicalizePoints\nmerge coincident/spatial point ids]
    B --> C[extractClosedLoops\ntext glyphs + circles + BFS line/arc components]
    C --> D[extractRegions\ntessellate → pointInPolygon containment → parent tree]
    D --> E[ProfileRegion[]\nouter loop + holes]
    E --> F[cadRegenService\n→ kernel RPC]
```

### Tessellation helpers (for containment only)

- `tessellateProfileLoopJS` — coarse chord tolerance (1.0), used only for point-in-polygon classification, not for the kernel's edge geometry.
- `tessellateCircleJS`, `tessellateArcJS` — build polygon approximations.
- `sampleBezierJS` — de Casteljau sampler for bezier segments.

---

## Key files

- `backend/services/cadProfile.js` — this module
- `backend/services/cadTextGlyphs.js` — `bezierLoopsFromTextEntity` called for text entities
- `frontend/src/app/cad/lib/profile.ts` — frontend mirror (must stay in sync)
