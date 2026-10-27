# assembly routes

> **System** ▸ [Overview](../../00-overview.md) ▸ [Assembly](../../40-assembly.md) ▸ [Subsystem map](../00-overview.md) ▸ **routes**
> Related: [controller](./controller.md)

---

## Requirements

Governed by the assembly group. See [40-assembly.md](../../40-assembly.md). Routes are pure infrastructure — no REQ maps directly to the route file itself.

---

## Succinct description

Express router at `backend/api/design/assembly/routes.js` that wires every assembly URL to its controller handler under the `cad` permission resource.

## How it works — for everyone (non-technical)

This file is the directory board that matches an incoming URL to the right handler function and checks that the caller has permission before letting them in.

## How it works — in detail (technical)

All routes apply `checkToken` then `checkPermission('cad', <action>)`. The router is mounted at `/api/design/assembly` by the API auto-discovery in `backend/api/index.js`.

| Method | Path | Permission | Handler |
|--------|------|-----------|---------|
| GET | `/parts-with-assembly` | read | `listPartsWithAssembly` |
| GET | `/eligible-parts` | read | `listEligibleParts` |
| GET | `/by-part/:partID/active` | read | `getActiveByPart` |
| POST | `/by-part/:partID` | write | `createForPart` |
| GET | `/:id` | read | `getById` |
| PUT | `/:id` | write | `update` |
| DELETE | `/:id` | delete | `delete` |
| POST | `/:id/instances` | write | `insertInstance` |
| PUT | `/:id/instances/:instanceId` | write | `updateInstance` |
| DELETE | `/:id/instances/:instanceId` | write | `removeInstance` |
| PUT | `/:id/instances/:instanceId/replace` | write | `replaceInstance` |
| POST | `/:id/mates` | write | `addMate` |
| DELETE | `/:id/mates/:mateId` | write | `removeMate` |
| POST | `/:id/patterns` | write | `addPattern` |
| DELETE | `/:id/patterns/:patternId` | write | `removePattern` |
| POST | `/:id/explode/auto` | write | `autoExplode` |
| PUT | `/:id/explode` | write | `setExplode` |
| POST | `/:id/display-states` | write | `saveDisplayState` |
| POST | `/:id/display-states/:stateId/apply` | write | `applyDisplayState` |
| DELETE | `/:id/display-states/:stateId` | write | `deleteDisplayState` |
| POST | `/:id/regenerate` | read | `regenerate` |
| GET | `/:id/bom` | read | `getBom` |
| POST | `/:id/interference` | read | `interference` |
| GET | `/:id/mass-properties` | read | `massProperties` |
| POST | `/:id/bom/sync` | write | `syncBom` |
| GET | `/:id/export/step` | read | `exportStep` |
| GET | `/:id/export/stl` | read | `exportStl` |
| GET | `/:id/history` | read | `getHistory` |
| POST | `/:id/checkout` | write | `checkout` |
| POST | `/:id/checkin` | write | `checkin` |
| POST | `/:id/undo-checkout` | write | `undoCheckout` |
| POST | `/:id/force-unlock` | **approve** | `forceUnlock` |
| GET | `/:id/commits` | read | `getCommits` |
| GET | `/:id/graph` | read | `getGraph` |
| GET | `/:id/branches` | read | `listBranches` |
| POST | `/:id/branches` | write | `createBranch` |
| POST | `/:id/switch-branch` | write | `switchBranch` |
| DELETE | `/:id/branches/:name` | write | `archiveBranch` |
| GET | `/:id/workflow` | read | `getWorkflow` |
| POST | `/:id/workflow` | read | `transitionWorkflow` |
| POST | `/:id/release` | write | `release` |
| POST | `/:id/production-release` | **approve** | `productionRelease` |
| GET | `/:id/release/step` | read | `exportReleaseStep` |
| GET | `/:id/release/stl` | read | `exportReleaseStl` |
| GET | `/:id/commits/:a/diff/:b` | read | `getCommitDiff` |
| GET | `/:id/reconcile/preview` | read | `reconcilePreview` |
| POST | `/:id/reconcile` | write | `reconcile` |

Notable permission boundaries: `regenerate` and `getBom` are read-only (no lock required); `force-unlock` and `production-release` require `cad.approve`.

## Key files

- `backend/api/design/assembly/routes.js` — this module
- `backend/api/design/assembly/controller.js` — all handler implementations
