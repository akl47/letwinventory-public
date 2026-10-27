# naming.rs — Persistent face/edge identifiers

> **System** ▸ [Overview](../../00-overview.md) ▸ [Kernel](../../20-kernel.md) ▸ [Persistent naming](../persistent-naming.md) ▸ **naming.rs**
> Related: [ops-extrude.md](./ops-extrude.md) · [ops-shape_io.md](./ops-shape_io.md) · [Persistent naming](../persistent-naming.md)

---

## Requirements

Governed by [Persistent naming](../persistent-naming.md).

| REQ | Status | Summary |
|-----|--------|---------|
| 517 | unapproved | Each face shall have a unique identifier stable across regenerations |

### REQ 517 — Persistent face names

- **Description:** The CAD module shall assign each face of a rendered solid a unique identifier that remains constant for the life of the feature that produced it.
- **Rationale:** Selections, fillet/chamfer edge picks, and diff coloring must survive regeneration; positional indices are unstable.
- **Verification:** Pick a face, edit an unrelated parameter, regenerate, confirm the selection still resolves.
- **Validation:** A fillet placed on a face survives edits to upstream features.

---

## Succinct description

`naming.rs` defines `PersistentName` — a serde-serializable struct that encodes a face or edge's identity as `(feature_id, role, sub_index, upstream_refs)` and renders to a compact JSON string used as the face ID on the wire.

## How it works — for everyone (non-technical)

When the kernel builds a box from an extrude, it needs to give each of the six faces a name that doesn't change if you later adjust the box's height. This module provides that naming system. The bottom face is always "the bottom cap of feature X," the top face is "the top cap of feature X," and the four side faces are "side 0 of X," "side 1 of X," etc. These names are stable because they come from the shape's role in the feature (bottom/top/side) not from OCCT's internal numbering (which can shift).

## How it works — in detail (technical)

### PersistentName struct

```rust
pub struct PersistentName {
    pub feature_id: String,
    pub role: Role,
    pub sub_index: u32,         // disambiguates multiple faces with the same role
    pub upstream_refs: Vec<String>,  // empty for primitives; populated for derived faces
}
```

`encode()` calls `serde_json::to_string(self)` — the struct uses serde's declaration-order field serialization, making the output deterministic. A cap-bottom face on feature `"f1"` encodes as `{"feature_id":"f1","role":"cap-bottom","sub_index":0,"upstream_refs":[]}`.

### Role enum

```rust
pub enum Role {
    CapTop, CapBottom,         // the two planar end-caps of an extrude
    Side,                       // lateral faces; sub_index = profile edge index
    EdgeTop, EdgeBottom, EdgeVertical,  // edge roles (reserved)
    FilletFace, FilletCap,     // blend results (reserved)
}
```

Roles serialize as `kebab-case` strings. Renaming any variant is a naming-schema breaking change that requires bumping `NAMING_SCHEMA_VERSION` in `main.rs` (currently at 20).

### Convenience constructors

- `PersistentName::cap_top(feature_id)` — zero-indexed, no upstream refs
- `PersistentName::cap_bottom(feature_id)` — same
- `PersistentName::side(feature_id, profile_edge_index)` — `sub_index` is the 0-based profile edge index from the centroid-sorted side face list

### Usage in tessellators

`tessellate_and_name` in `ops/extrude.rs` calls these constructors per face after classifying each OCCT face as CapBottom / Side / CapTop by axial position. `tessellate_faces_generic` in `ops/shape_io.rs` uses `PersistentName::side(feature_id, i)` with a centroid-lexicographic sort order for ops (boolean, revolve, sweep) that don't have the cap/side distinction.

### Schema versioning

`NAMING_SCHEMA_VERSION` in `main.rs` must be bumped whenever the naming rules change (role renames, new constructors that alter existing IDs, or mesh output format changes). The backend's `cadRegenService.js` mirrors this constant and invalidates cache entries tagged with an older version.

## Key files

- `cad-kernel/src/naming.rs` — this module
- `cad-kernel/src/main.rs` — `NAMING_SCHEMA_VERSION` (currently 20)
- `cad-kernel/src/ops/extrude.rs` — primary consumer (`tessellate_and_name`)
- `cad-kernel/src/ops/shape_io.rs` — generic consumer (`tessellate_faces_generic_with_topology`)
