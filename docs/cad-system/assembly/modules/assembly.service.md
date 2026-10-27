# assembly.service

> **System** ▸ [Overview](../../00-overview.md) ▸ [Assembly](../../40-assembly.md) ▸ [Subsystem map](../00-overview.md) ▸ **assembly.service**
> Related: [assembly.types](./assembly.types.md) · [assembly-edit.controller](./assembly-edit.controller.md) · [routes](./routes.md)

---

## Requirements

Governed by the assembly group. See [40-assembly.md](../../40-assembly.md). This service is pure HTTP infrastructure — every REQ in the assembly group is exercised through it.

---

## Succinct description

Angular `Injectable` HTTP client service that wraps every `/api/design/assembly` endpoint as a typed `Observable`. The single integration layer between the browser and the backend for all assembly operations.

## How it works — for everyone (non-technical)

Every network call the assembly editor makes goes through this service. It translates button clicks and form inputs into HTTP requests and returns the results back to the controller as observable data streams.

## How it works — in detail (technical)

`frontend/src/app/services/assembly.service.ts` is a root-level Angular service (`providedIn: 'root'`). It injects `HttpClient` and sets `apiUrl = environment.apiUrl + '/design/assembly'`.

Every method is a thin wrapper over one HTTP call, returning a typed `Observable`. The method groupings mirror the backend route groups:

**CRUD + listing**
- `list()` → `GET /parts-with-assembly` → `AssemblyListItem[]`
- `eligibleParts()` → `GET /eligible-parts` → `EligiblePart[]`
- `getActiveByPart(partID)` → `GET /by-part/:partID/active` → `Assembly`
- `createForPart(partID, body?)` → `POST /by-part/:partID` → `Assembly`
- `getById(id)` → `GET /:id` → `Assembly`
- `delete(id)` → `DELETE /:id`

**Instances**
- `insertInstance(id, body)` → `POST /:id/instances`
- `updateInstance(id, instanceId, patch)` → `PUT /:id/instances/:instanceId` (patch is `Partial<Pick<AssemblyInstance, 'placement'|'grounded'|'suppressed'|'visible'>>`)
- `removeInstance(id, instanceId)` → `DELETE /:id/instances/:instanceId`
- `replaceInstance(id, instanceId, partID)` → `PUT /:id/instances/:instanceId/replace`

**Mates**
- `addMate(id, body)` → `POST /:id/mates` (body: `{ type, a:MateRef, b:MateRef, value?, flip? }`)
- `removeMate(id, mateId)` → `DELETE /:id/mates/:mateId`

**Patterns**
- `addPattern(id, body)` → `POST /:id/patterns`
- `removePattern(id, patternId)` → `DELETE /:id/patterns/:patternId`

**Visualization**
- `autoExplode(id, spread?)` → `POST /:id/explode/auto`
- `setExplode(id, factor)` → `PUT /:id/explode`
- `saveDisplayState(id, name)` → `POST /:id/display-states`
- `applyDisplayState(id, stateId)` → `POST /:id/display-states/:stateId/apply`
- `deleteDisplayState(id, stateId)` → `DELETE /:id/display-states/:stateId`

**Regen / BOM / analysis**
- `regenerate(id)` → `POST /:id/regenerate` → `AssemblyRegenResponse`
- `bom(id)` → `GET /:id/bom` → `BomLine[]`
- `massProperties(id)` → `GET /:id/mass-properties` → `MassProperties`
- `interference(id)` → `POST /:id/interference` → `{ pairs: InterferencePair[], errors: string[] }`
- `syncBom(id)` → `POST /:id/bom/sync`

**Export**
- `exportStep(id)` → `GET /:id/export/step` (responseType `'text'`)
- `exportStl(id)` → `GET /:id/export/stl` (responseType `'blob'`)
- `releaseStep(id)` / `releaseStl(id)` → frozen release downloads

**VCS / branches / workflow / release**
- `checkout`, `checkin`, `undoCheckout` → checkout/commit/discard cycle
- `getCommits`, `listBranches`, `createBranch`, `switchBranch`, `archiveBranch` → branch management
- `getWorkflow`, `transitionWorkflow` → review workflow
- `getGraph` → commit graph for the history panel
- `release`, `productionRelease` → two-tier release
- `commitDiff`, `reconcilePreview`, `reconcile` → diff + merge

Return types for VCS operations (`CadBranch`, `CadCommit`, `CadWorkflow`, `CadVersionGraph`, `CadCommitDiff`) are imported from `../models/cad-model.model` — the same types used by the single-part CAD service, reflecting the shared VCS machinery.

## Key files

- `frontend/src/app/services/assembly.service.ts` — this module
- `frontend/src/app/cad/lib/assembly.types.ts` — all request/response type definitions
- `frontend/src/app/components/cad/assembly-editor/assembly-edit.controller.ts` — primary consumer
- `frontend/src/app/components/cad/assembly-landing/assembly-landing.component.ts` — uses `list()` and `eligibleParts()`
