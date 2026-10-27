# Unifying CAD + Assembly as one VCS-document app

## Context

Part-CAD models (`DesignCADModel`) and assemblies (`DesignAssembly`) are both
*version-controlled documents with a working copy* that render geometry into the
same viewer. The first assembly cut duplicated machinery that should be written
once: a parallel `assemblyVcsService` mirroring `cadVcsService`, a parallel
"Working copy" ribbon group instead of the CAD **File** tab, and assembly-only
checkout/check-in/undo. The user wants assemblies to use the *same* File ribbon
tab with **full VCS parity** (checkout/check-in/undo, branches, history, compare,
submit/approve workflow, release-to-revision, production letter release, merge),
plus the **measurement** tool — all written once.

This is a staged refactor of the app's most critical area. Each stage is
behavior-preserving and verified by the existing Jest suites before the next.

## Target architecture

Both documents share:
- **VCS working copy** — identical lock/branch/commit fields on both rows.
- **The content-addressed store** (`vcsService`) — already shared.
- **Branches / workflow / diff / graph** — already keyed by *repo*, not model.
- **Release/freeze** — the only genuinely document-specific VCS piece (which doc
  to serialize, which geometry to freeze, which Part to mint a revision on).

So the abstraction is a **document binding**:
```
binding = {
  noun,                          // 'model' | 'assembly' (error text)
  repoType,                      // 'cad' | 'assembly'
  repoFor(model, db),            // lineage-root repo
  docOf(model),                  // serializable doc
  serialize(repo, doc, db),      // → treeHash   (cadSerializer | assemblySerializer)
  deserialize(repo, hash, db),   // → doc
  applyDoc(model, doc),          // → model.update patch (featureTree+… | assemblyDoc)
  geometryForFreeze(...),        // compose geometry to freeze (CAD regen | assembly regen)
  commitMeta(),                  // optional commit meta (namingVersion, …)
}
```

## Stages

### Stage 1 — VCS working copy written once  ✅ (this commit)
`backend/services/vcs/vcsWorkingCopy.js` `makeWorkingCopy(binding)` implements
`seedMain / checkout / releaseLock / undoCheckout / checkin / history /
lockHeldByOther`. `cadVcsService` and `assemblyVcsService` both delegate to it.
The CAD-specific `release/devRelease/revision` helpers stay in `cadVcsService`.
Verified: CAD VCS suites + assembly VCS suites stay green.

### Stage 2 — Assembly VCS parity (backend)
- `DesignAssembly` gains the display fields CAD computes (`released`,
  `displayRevision`, `draftRevision`, `behindMain`) via an assembly
  `withReleaseFlag` (reuse `cadVcsService.highestReleasedNumeric` — Parts-based).
- Assembly controller gains the repo-keyed VCS endpoints by reusing the existing
  services with an assembly repo: `cadBranchService` (branches/switch/archive),
  `workflowEngine` (workflow get/transition), `cadDiffService` (commit diff),
  `cadGraphService` (graph), plus release-to-main + production via a generic
  `vcsRelease(binding)` that freezes the **composed assembly** geometry and mints
  the Part revision through `partRevisionService` (assemblies are Parts).
- Mirror the CAD routes under `/api/design/assembly`.

### Stage 3 — One File ribbon tab (frontend)
- A `CadDocClient` interface (checkout/checkin/undo/branches/switch/commits/diff/
  workflow/release/production/export) with a CAD impl (`CadModelService`) and an
  assembly impl (`AssemblyService`). The editor's existing File-tab handlers call
  through `this.doc` (resolved by mode) instead of `this.cadApi` directly.
- Show the **File** tab in assembly mode; delete the duplicate "Working copy"
  ribbon group + the assembly-only checkout/checkin in the controller.
- `model()` is generalized to a `VcsDoc` shape both satisfy (id, branchName,
  dirty, lockedByUserID, baseCommitHash, released, displayRevision, behindMain).

### Stage 4 — Measurement shared
`computeMeasure` + `measureItems` are already geometry-only and CadModel-free.
Surface the Measure ribbon button in assembly mode and route viewer
vertex/edge/face picks to `addMeasureItem` (they already are, except face picks
which currently branch to the mate flow — gate by whether a mate pick is armed).

## Verification
- Backend: full design + VCS Jest suites green after each backend stage
  (`scripts/run-tests.sh`, ask first). Assembly gets its own branch/workflow/
  release tests mirroring the CAD ones.
- Frontend: compiles clean; browser smoke (needs migration + kernel) of the
  shared File tab in both modes + measurement in assembly mode.

## Risk / sequencing
Stage 1 + 2 are backend-testable and low-risk (additive + behavior-preserving).
Stage 3 touches the editor's most critical handlers — done only after the
assembly backend supports every File-tab action, so the dispatch can't 404.
