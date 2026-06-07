# ops/pattern.rs — Pattern operations (Mirror / Linear / Circular)

> **System** ▸ [Overview](../../00-overview.md) ▸ [Kernel](../../20-kernel.md) ▸ [Operations](../operations.md) ▸ **ops/pattern.rs**
> Related: [ops-boolean.md](./ops-boolean.md) · [ops-shape_io.md](./ops-shape_io.md) · [Operations](../operations.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 658 | unapproved | Pattern features — linear, circular, mirror; N copies of a body |

### REQ 658 — Pattern features

- **Description:** The CAD editor shall provide three pattern features that replicate one or more existing features by applying transforms: Linear (translate along one or two axes), Circular (rotate about an axis), Mirror (reflect across a plane). REQ 658.
- **Rationale:** Repeating geometry without re-creating each instance is essential for symmetric parts and regularly-spaced features.
- **Verification:** A linear pattern of a cylinder produces N evenly-spaced cylinders; a mirror of an L-bracket produces its mirror image.
- **Validation:** A user creates a bolt-hole pattern and the holes appear at the correct spacing.

---

## Succinct description

`ops/pattern.rs` applies a list of rigid-body transforms (translate / rotate / mirror) to a source BRep, fuses each transformed copy via `Shape::union`, and optionally includes the source in the result. All three pattern kinds reduce to "list of transforms + fuse" at the kernel level; the frontend computes the transforms from each feature's parameters.

## How it works — for everyone (non-technical)

This module is a copy-and-combine machine. You give it a solid and a list of moves (shift by X, rotate by Y°, mirror across Z plane) and it applies each move to make a copy, then glues all the copies together into one solid. The source can be included in the result (default) or left out (for when you want just the copies as a separate body). The three pattern types — linear repeat, circular repeat, mirror — all use this same mechanism.

## How it works — in detail (technical)

### `build(params: &BuildPatternParams) -> Result<BuildPatternResult>`

1. Validate: `transforms` must be non-empty.
2. `deserialize_brep_from_base64(a_brep)` → source shape.
3. `apply_transform(&source, t)` for each transform:
   - `Translate { dx, dy, dz }` → `source.translate_xyz(dx, dy, dz)`
   - `Rotate { origin, direction, angle_rad }` → `source.rotate_around(origin, dir, angle_rad)`
   - `Mirror { origin, normal }` → `source.mirror_plane(origin, normal)`
4. Fuse accumulator:
   - `merge_with_source: true` (default): start from `source.union(copies[0])`, fold remaining copies.
   - `merge_with_source: false`: start from `copies[0]`, fold the rest. The source stays as its own upstream body.
   - Result is `.clean()` after all fusions to merge co-domain faces.
5. `serialize_brep` → guard empty bytes.
6. `extract_topology`, `tessellate_faces_generic_with_topology`.
7. `decompose_into_solids` for multi-body split tracking.

### PatternTransform enum

```rust
enum PatternTransform (tag = "kind"):
  Translate { dx, dy, dz: f64 }
  Rotate    { origin: [f64;3], direction: [f64;3], angleRad: f64 }
  Mirror    { origin: [f64;3], normal: [f64;3] }
```

The frontend maps each feature kind to this list:
- Mirror → 1 `Mirror` entry.
- Linear (N copies, 1 axis) → N–1 `Translate` entries; 2-axis → (N–1)×(M–1) entries (grid).
- Circular (N copies) → N–1 `Rotate` entries at equal angular steps.

### Sequential fuse strategy

Copies are accumulated one at a time (source ∪ copy₁, result ∪ copy₂, …) rather than fused pairwise into a tree. For phase-1 correctness this is simpler; for large N a tree-balanced fuse would be faster but the difference is not noticeable for typical pattern counts (≤ 20 copies).

```mermaid
flowchart TD
    A[BuildPatternParams\naBrep + transforms] --> B[deserialize source]
    B --> C[apply_transform per entry\ntranslate / rotate / mirror]
    C --> D{mergeWithSource?}
    D -- true --> E[acc = source.union first_copy\nfold remaining copies]
    D -- false --> F[acc = copies[0]\nfold remaining copies]
    E & F --> G[acc.clean]
    G --> H[serialize_brep]
    H --> I[extract_topology + tessellate]
    I --> J[decompose_into_solids]
    J --> K[BuildPatternResult]
```

## Key files

- `cad-kernel/src/ops/pattern.rs` — this module
- `cad-kernel/src/ops/shape_io.rs` — `deserialize_brep_from_base64`, `extract_topology`, `tessellate_faces_generic_with_topology`, `decompose_into_solids`, `serialize_brep`
- `cad-kernel/src/protocol.rs` — `BuildPatternParams`, `BuildPatternResult`, `PatternTransform`
