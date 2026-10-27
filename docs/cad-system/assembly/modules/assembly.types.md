# assembly.types

> **System** ▸ [Overview](../../00-overview.md) ▸ [Assembly](../../40-assembly.md) ▸ [Subsystem map](../00-overview.md) ▸ **assembly.types**
> Related: [mateSolver](./mateSolver.md) · [assembly.service](./assembly.service.md) · [assembly-edit.controller](./assembly-edit.controller.md)

---

## Requirements

Governed by the assembly group. See [40-assembly.md](../../40-assembly.md). This module is shared infrastructure — the types directly support REQ 748, 750–753, 755–758, 764–769.

---

## Succinct description

TypeScript type definitions and pure utility functions for the assembly subsystem. Shared by the service, controller, and solver — no Angular dependencies.

## How it works — for everyone (non-technical)

This file is the vocabulary the entire assembly front-end speaks. It defines what an assembly, a component instance, a mate, a pattern, and a composed geometry result look like as data, so every layer of the code uses the same agreed-upon shape.

## How it works — in detail (technical)

`frontend/src/app/cad/lib/assembly.types.ts` exports types and functions organized around three concerns.

### Document types (what is stored in `assemblyDoc`)

| Type | Purpose |
|------|---------|
| `Placement` | `{ translate:[3], quaternion:[4] }` — rigid-body pose in world space |
| `AssemblyInstance` | One placed component: `instanceId`, `partID`, `ref?:{kind:'cad'|'assembly'}`, `pinnedCommitHash?`, `grounded?`, `placement`, `suppressed?`, `visible?` |
| `MateType` | String union of all eight mate types |
| `MateRef` | `{ instanceId, faceId }` — persistent face reference |
| `Mate` | `mateId`, `id?`, `type`, `a:MateRef`, `b:MateRef`, `value?`, `flip?`, `suppressed?` |
| `ConstraintState` | `{ state:'under'|'fully'|'over', dof, converged, residualNorm }` |
| `PatternKind` | `'linear'|'circular'|'mirror'` |
| `AssemblyPattern` | Pattern record with kind-specific fields: `count/spacing` (linear), `count/axisOrigin/axisDir/angleStep` (circular), `planeOrigin/planeNormal` (mirror) |
| `ExplodeConfig` | `{ offsets:Record<instanceId,[3]>, factor:number }` |
| `DisplayState` | `{ id, name, hidden:instanceId[] }` |
| `AssemblyDoc` | Root document: `nextInstanceSeq`, `nextMateSeq`, `nextPatternSeq?`, `nextDisplayStateSeq?`, `instances`, `mates`, `patterns?`, `explode?`, `displayStates?` |

### API model types (what is served over HTTP)

| Type | Purpose |
|------|---------|
| `Assembly` | Full assembly row including `assemblyDoc`, VCS fields (`branchName`, `dirty`, `releaseLocked`, `lockedByUserID`) |
| `EligiblePart` | `{ partID, part, hasAssembly }` from the `/eligible-parts` endpoint |
| `AssemblyListItem` | Landing-list row: `id`, `name`, `partID`, `part`, `instanceCount`, `updatedAt` |

### Composed geometry types (what `POST /regenerate` returns)

| Type | Purpose |
|------|---------|
| `ComposedFace` | `{ persistentName, faceId, positions, normals, indices, surface? }` |
| `ComposedBody` | `{ id, name, instanceId, partID, placement, faces, vertices, edges }` — ids are scoped `instanceId::bodyId` |
| `ComposedInstance` | `{ instanceId, partID, placement, bodyIds }` |
| `AssemblyRegenResponse` | `{ faces, vertices, edges, bodies, instances, errors, constraintState }` |

### Analysis + BOM types

`MassProperties`, `InterferencePair`, `BomLine` — response shapes for the three read-only analysis endpoints.

### Utility functions

**`validMateTypes(kindA, kindB): MateType[]`**
Returns the allowed mate types for a face pair based on surface kinds:
- `plane`+`plane` → `coincident`, `parallel`, `perpendicular`, `distance`, `angle`
- `cylinder`+`cylinder` → `concentric`
- `cylinder`+`plane` or `plane`+`cylinder` → `tangent`
- Always includes `lock`.
Used by `AssemblyEditController.chooserTypes` to filter the mate-type picker.

**`eulerToQuat(rxDeg, ryDeg, rzDeg): Quat`** and **`quatToEuler(q): [number, number, number]`**
ZYX intrinsic Euler (yaw Z → pitch Y → roll X) ↔ unit quaternion, in degrees. Used by the placement inspector in the editor.

**`IDENTITY_PLACEMENT`** — exported constant `{ translate:[0,0,0], quaternion:[0,0,0,1] }`.

## Key files

- `frontend/src/app/cad/lib/assembly.types.ts` — this module
- `frontend/src/app/cad/lib/mateSolver.ts` — consumes `MateGeom`, `SolverInstance`, `Mate`, `Pose`, `SolveResult`
- `frontend/src/app/services/assembly.service.ts` — all HTTP methods typed against these interfaces
- `frontend/src/app/components/cad/assembly-editor/assembly-edit.controller.ts` — imports most of these types
