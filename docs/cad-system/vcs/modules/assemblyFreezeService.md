# assemblyFreezeService — Assembly Geometry Freeze Binding

> **System** ▸ [Overview](../../00-overview.md) ▸ [VCS](../00-overview.md) ▸ [Freeze Geometry](../freeze-geometry.md) ▸ **assemblyFreezeService**
> Related: [vcsFreeze](./vcsFreeze.md) · [assemblyVcsService](./assemblyVcsService.md) · [cadFreezeService](./cadFreezeService.md)

---

## Requirements

Requirements governed by [Freeze Geometry](../freeze-geometry.md) — REQs 684 and 685 apply equally to assemblies.

---

## Succinct description

The assembly binding for the generic `vcsFreeze` factory: provides `regen`, `snapshot`, and `reconstruct` callbacks specific to composed assembly geometry, wiring `assemblyRegenService` and the `assemblySnapshot` / `assemblyReconstruct` shapes.

## How it works — for everyone (non-technical)

An assembly's 3D geometry is the result of placing all its parts together and solving how they connect. This module tells the generic freeze storage layer: "call the assembly renderer to get the composed geometry, store it in this format, and rebuild it in this format when loading from storage." The result is that a released assembly always loads instantly, just like a released individual part.

## How it works — in detail (technical)

`backend/services/vcs/assemblyFreezeService.js` binds `makeFreeze` and exports the resulting methods.

### `assemblySnapshot(composed)`

Produces the content-addressable snapshot from a composed assembly regeneration result:

```js
{
  bodies: [{
    id, name, instanceId, partID,
    placement,     // { position, quaternion }
    faces, vertices, edges,
  }],
  instances,         // from composed.instances
  constraintState,   // mate solver result (null if unconstrained)
  errors,
}
```

BReps are excluded (stored separately as binary objects).

### `assemblyReconstruct(snap, brepByBody)`

Merges BRep bytes back by `body.id`:

```js
{
  faces,      // flattened from all bodies
  vertices,   // flattened
  edges,      // flattened
  bodies,     // each with brep merged back
  instances,
  constraintState,
  errors,
  frozen: true,
}
```

The flattened face/vertex/edge arrays reconstruct the `AssemblyRegenResponse` shape that the assembly editor consumes.

### Freeze binding

```js
makeFreeze({
  regen: (assembly, { kernelClient, db }) =>
    assemblyRegen.regenerateAssembly(assembly, { db: dbOf(db), kernelClient }),
  snapshot: assemblySnapshot,
  reconstruct: assemblyReconstruct,
})
```

### Exported surface

| Export | Description |
|---|---|
| `freezeGeometry(repo, assembly, {kernelClient}, db)` | Regen + store; returns `{ meshHash, bodies }` |
| `loadFrozenGeometry(repo, frozen, db)` | Reconstruct from stored objects |
| `geometryForCommit(repo, assembly, commitHash, {kernelClient}, db)` | Dispatch frozen vs. live |

## Key files

- `backend/services/vcs/assemblyFreezeService.js` — `assemblySnapshot`, `assemblyReconstruct`, `freezeGeometry`, `loadFrozenGeometry`, `geometryForCommit`
- `backend/services/vcs/vcsFreeze.js` — `makeFreeze`
- `backend/services/assemblyRegenService.js` — `regenerateAssembly`
