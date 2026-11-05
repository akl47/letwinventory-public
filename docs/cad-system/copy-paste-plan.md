# Copy / paste of sketches and features — plan

Status: plan (2026-11-03). No requirements or code yet.

## Goal

SolidWorks-style copy/paste of whole feature-tree items — sketches, extrudes,
cuts, revolves, fillets, patterns, … — within a part and **across parts**.
Pastes are **independent copies** (no link back to the source).

Decisions (user, 2026-11-03):
- Unresolved references → **SolidWorks prompt** after paste: list them, choose
  *Delete reference* or *Leave dangling*. No NX-style re-pick dialog.
- Cross-part paste is in v1.
- Independent copies only; no linked paste.

## User flow

1. **Copy** — select one or more tree rows (sketch or feature) → right-click
   *Copy* or Ctrl+C. Works on read-only / released / other users' models.
2. **Paste** — optionally select a target plane/face first, then right-click
   *Paste* (tree or viewer) or Ctrl+V. Requires the part checked out by me;
   disabled with a REQ 989 tooltip otherwise (`Nothing copied`, `Check out
   the part first`, `Select a plane or face to paste onto`).
3. If anything couldn't be resolved, a **Copy Confirmation** dialog lists each
   one (`Cut-Extrude 2 — end condition "up to face"`) with *Delete* / *Leave
   dangling* (per item + "apply to all"). Dangling refs then surface as the
   existing feature errors, exactly like any broken reference today.

## The clipboard bundle (`cad/lib/clipboard.ts`, pure + unit-tested)

```ts
interface ClipboardBundle {
  schema: 1;
  namingVersion: number;          // NAMING_VERSION at copy time
  sourceModelId: number;          // same-part detection
  sketches: Sketch[];             // deep copies
  features: Feature[];            // deep copies, tree order
  variables: EquationEntry[];     // globals referenced by copied dims/params
  primaryPlane: Plane3 | null;    // plane of the first copied sketch (paste transform)
}
```

Stored in `localStorage` (`cad-clipboard`) so it pastes in another tab/part,
with an in-memory copy for the current tab. Rejected on paste if `schema`
or `namingVersion` doesn't match.

### Closure (what a copy includes)
- Copying a feature pulls in the sketch(es) it consumes (`sketchId`,
  `profileSketchId`/`pathSketchId`, `sketchIds`).
- Upstream features are NOT included — they become external references.
- Multiple selected items keep references between them (e.g. a sketch hosted
  on a face of a copied extrude, a fillet on a copied extrude's edges).

### Reference classification
Every id-bearing field is walked by one table-driven function per feature
type (`refsOf(feature)` → list of `{path, kind, id}`), so new feature types
must register their refs (a unit test fails if a Feature type has no entry).

| Reference | Examples | Paste handling |
|---|---|---|
| Internal | consumed sketch, feature inside the bundle | remapped to fresh ids (`ids.ts nextId`) |
| Sketch host plane | `Sketch.hostId` / `plane` of the **first** sketch | the selected target plane/face; others transformed relative to it |
| Datums | `PlaneRef`/`AxisRef` `datum`/`originAxis` | always resolvable — kept |
| Topology | `faceId`, `edges: EdgeRef3D[]`, `vertexId`, `bodyId`, `targetBodyId`, `seedFeatureIds` outside the bundle | same part + source still present → kept; else **unresolved** |
| Sketch external refs | projected/converted entities, on-edge refs, edge dims, cross-part refs | same part → kept; else **unresolved** (delete = drop the constraint and keep the geometry as plain fixed sketch geometry) |
| Variables | dims/params driven by equations | same part → kept; other part → add missing variables, ask on name clash (rename / use existing / bake literal value) |

## Paste algorithm (`pasteBundle`, pure)

```
pasteBundle(doc, tree, equations, bundle, { target, insertAfter, sameModel })
  → { doc, tree, equations, unresolved: UnresolvedRef[] }
```

1. Fresh ids for every sketch, feature, entity and constraint in the bundle;
   rewrite internal refs through the id map.
2. **Placement.** If a target plane/face is given, compute the rigid
   transform `primaryPlane → targetPlane` (using the existing canonical
   sketch orientation) and apply it to every copied sketch's plane and to
   world-space data (`direction`, `fallbackPlane`, axis snapshots). No
   target + same part → paste in place.
3. Resolve external refs per the table; collect the unresolved ones.
4. Names: next free index per type (`Extrude 4`, `Sketch 7`); `createdAt` =
   now so the tree places them after the rollback bar / at the end.
5. The editor commits the result as one undoable edit → normal save → server
   regen. **No backend changes.**

After the user answers the confirmation dialog, *Delete* rewrites the ref
away (drop edge from a fillet set, end condition → blind at the last
distance, sketch constraint removed); *Leave dangling* keeps the id as is.

## Phases

1. **Sketch copy/paste** — bundle, closure, plane transform, sketch external-ref
   handling, cross-part, tree context menu + Ctrl+C/V, confirmation dialog.
2. **Feature copy/paste** — extrude/cut/revolve/hole with their sketches; end
   conditions, body targets, variables.
3. **Multi-select + remaining feature types** — fillet/chamfer edge sets,
   patterns/mirrors (`seedFeatureIds`), sweeps/lofts (multiple sketches),
   shell/combine/move-copy body.

Within-sketch entity copy/paste (Ctrl+C/V on sketch geometry) is out of
scope; the existing sketch Copy tool covers it.

## Testing

- Unit (`clipboard.spec.ts`): closure, id remap, plane transform, every
  feature type registered in `refsOf`, same-part keep vs cross-part
  unresolved, variable merge/clash, delete-vs-dangle rewrites.
- E2E (`e2e/cad/copy-paste.spec.ts`): copy a sketch onto another datum; copy
  a cut-extrude onto a different face and assert the body changes; paste into
  a second fixture part and assert the confirmation dialog lists the
  unresolved refs.

## Open risks

- Face/edge ids are unstable across merges (see memory notes on edge ids /
  face re-tag), so even same-part "kept" topology refs can resolve to the
  wrong face after upstream edits — same exposure as hand-picked refs today.
- Plane transform for sketches hosted on curved/non-planar faces is out of
  scope (sketches only host on planar faces/datums today).
