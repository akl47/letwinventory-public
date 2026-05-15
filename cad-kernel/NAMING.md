# Topological Naming

This is the actual hard problem in parametric CAD — not booleans.

The naming scheme decides what happens when a user fillets "the edge between
face 3 and face 7" and an upstream change re-numbers faces. If face IDs come
from OCCT's internal numbering, the fillet silently jumps to the wrong edge
after every regen. We need persistent IDs derived from generative history.

This file is the source of truth for the algorithm. Update it whenever the
naming scheme changes, because retrofitting names later is agony.

## Identifier shape

Each face and edge gets a `PersistentName` — a structured tuple that uniquely
and stably identifies the entity across regenerations. Encoded as JSON for
storage, indexed by hash for fast lookups.

```rust
pub struct PersistentName {
    feature_id: String,          // which feature produced this entity
    role: Role,                  // what role within the feature
    sub_index: u32,              // disambiguates when role isn't unique
    upstream_refs: Vec<String>,  // names of upstream entities, in stable order
}

pub enum Role {
    CapTop, CapBottom, Side,
    EdgeTop, EdgeBottom, EdgeVertical,
    FilletFace, FilletCap,       // Phase 2
    // ... extended as features land
}
```

## Naming rules per feature kind

### Extrude (Phase 0)

For a profile with N edges:

- Top cap face: `role="cap-top", sub_index=0, upstream_refs=()`
- Bottom cap face: `role="cap-bottom", sub_index=0, upstream_refs=()`
- Lateral face from profile edge `i`: `role="side", sub_index=i, upstream_refs=()`

Edges:
- Top cap perimeter, segment `i`: `role="edge-top", sub_index=i`
- Bottom cap perimeter, segment `i`: `role="edge-bottom", sub_index=i`
- Vertical (cap-to-cap) edges: `role="edge-vertical", sub_index=i`

### Cut-Extrude (Phase 2)

Same as Extrude, except:
- `upstream_refs` lists the names of the faces the cut intersected (so the
  same cut on a different upstream body produces different persistent IDs).

### Fillet (Phase 2)

- The filleted face: `role="fillet-face", upstream_refs=(edge_name,)` where
  `edge_name` is the persistent name of the edge being filleted.
- The cap/blended faces it creates: `role="fillet-cap", sub_index=i,
  upstream_refs=(edge_name,)`.

### Pattern (Phase 2)

For each pattern instance `j` of a feature `F`:
- Every face of the original `F` gets a sibling with the same role, the same
  sub_index, but `upstream_refs=(..., f"instance:{j}")`.

## Stability claims

Operations that preserve persistent IDs:
- Changing extrude distance
- Changing fillet radius
- Adding a feature *after* the named entity in the tree
- Linear pattern with the same input feature (instance index `j` is part of
  the name, so each instance has a distinct stable ID)

Operations that *invalidate* persistent IDs (downstream features error and
prompt the user to re-bind):
- Changing the sketch profile so a previously-named face no longer exists
- Reordering features so the named feature is no longer upstream
- Boolean-cutting a body where the named face used to be

## Algorithm

When a feature regenerates:
1. The kernel runs the operation (OCCT/CadQuery).
2. The kernel walks the resulting BRep and assigns each new face/edge a
   `PersistentName` per the rules above.
3. The name is stored on the OCCT shape via a side-table keyed by
   `TopoDS_Shape.HashCode()` (because TopoDS handles aren't hashable for
   Python dicts directly; OCCT provides a stable shape-hash).

Look-up by persistent name uses a reverse map from each session.

## Versioning

The naming scheme is itself versioned (`NAMING_SCHEMA_VERSION` in code). If
we change the rules, BRep cache entries from the old version are invalid and
the kernel recomputes. The version is stored alongside cached BRep bytes.

Current version: **1** (Phase 0).
