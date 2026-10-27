# cadFreezeService — CAD Geometry Freeze Binding

> **System** ▸ [Overview](../../00-overview.md) ▸ [VCS](../00-overview.md) ▸ [Freeze Geometry](../freeze-geometry.md) ▸ **cadFreezeService**
> Related: [vcsFreeze](./vcsFreeze.md) · [cadVcsService](./cadVcsService.md) · [cadDiffService](./cadDiffService.md) · [assemblyFreezeService](./assemblyFreezeService.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 684 | unapproved | On release: store each body's BRep and mesh as immutable objects |
| 685 | unapproved | Released commit reconstructs geometry with zero kernel calls |

### REQ 685 — Zero-kernel-call reconstruction

- **Description:** Checking out a released commit shall load its frozen geometry directly without a kernel regeneration; checking out a draft commit shall regenerate geometry live.
- **Rationale:** Released revisions are frozen (fast, immutable); drafts are live and must reflect the current recipe and kernel.
- **Verification:** Integration test: loading a frozen commit reconstructs geometry from stored objects with zero kernel calls; loading a draft calls the kernel.
- **Validation:** Opening a released revision is fast and identical to what was released; opening a draft shows current geometry.

---

## Succinct description

The CAD binding for the generic `vcsFreeze` factory: provides the `regen`, `snapshot`, and `reconstruct` callbacks specific to CAD part geometry, wiring `cadRegenService` and the `meshSnapshot` shape.

## How it works — for everyone (non-technical)

This is the CAD-specific half of the freeze system. It tells the generic freeze storage layer: "call the CAD geometry engine to get the 3D shapes, use this specific format to store the mesh, and reassemble them in this format when loading from storage." The generic freeze layer handles the actual storing and retrieving.

## How it works — in detail (technical)

`backend/services/vcs/cadFreezeService.js` binds `makeFreeze` and exports the resulting methods directly.

### `meshSnapshot(regen)`

Strips the regeneration result down to the content-addressable, stable subset the viewer consumes:

```js
{
  features: [{
    featureId, bodyId,
    faces,       // [{faceId, positions, indices, persistentName, ...}]
    topology,    // { vertices, edges }
    error,
  }],
  bodies: [{ id, name }],
  errors,
}
```

Explicitly excluded: BRep strings, per-feature cache flags, anything that is not content-stable or that is stored separately as binary.

### Freeze binding

```js
makeFreeze({
  regen: (model, { kernelClient, db }) =>
    cadRegen.regenerateModel(model, { kernelClient, includeBodyBreps: true, db }),
  snapshot: meshSnapshot,
  reconstruct: (snap, brepByBody) => ({
    ...snap,
    bodies: snap.bodies.map(b => ({ ...b, brep: brepByBody.get(b.id) || null })),
    frozen: true,
  }),
})
```

`reconstruct` merges the stored binary BRep bytes back into each body entry by `body.id` and marks the result `frozen: true`.

### Exported surface

The module re-exports the three `makeFreeze` products:

| Export | Description |
|---|---|
| `freezeGeometry(repo, model, {kernelClient}, db)` | Regen + store; returns `{ meshHash, bodies }` |
| `loadFrozenGeometry(repo, frozen, db)` | Reconstruct from stored objects |
| `geometryForCommit(repo, model, commitHash, {kernelClient}, db)` | Dispatch frozen vs. live |

`cadFreezeService` is the `freeze` binding in `cadVcsService.makeRelease` and in `cadDiffService.regenCommitGeometry`.

## Key files

- `backend/services/vcs/cadFreezeService.js` — `meshSnapshot`, `freezeGeometry`, `loadFrozenGeometry`, `geometryForCommit`
- `backend/services/vcs/vcsFreeze.js` — `makeFreeze` (storage plumbing)
- `backend/services/cadRegenService.js` — `regenerateModel` (kernel call)
