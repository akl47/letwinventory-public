# ids.ts

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Units / IDs / Migration](../units-ids-migration.md) ▸ **ids.ts**
> Related: [units.ts](./units.md) · [migration.ts](./migration.md) · [Units / IDs / Migration group page](../units-ids-migration.md)

---

## Requirements

Governed by [Units / IDs / Migration](../units-ids-migration.md).

| REQ | Status | Summary |
|-----|--------|---------|
| 742 | unapproved | Feature and sketch ids shall be globally unique (random), not sequential per document |

### REQ 742 — Globally-unique random ids

- **Description:** New CAD feature and sketch identifiers shall be globally unique (random), not sequential per document. Sequential ids collide across branches (two branches off the same point assign the same next number to different features), which a feature-level merge would conflate. The origin feature (`f1`) remains a fixed shared seed; only added features and sketches get unique ids.
- **Rationale:** Globally-unique ids guarantee a feature added on one branch can never share an id with a feature added on another, so cross-branch merge/reconcile identifies features unambiguously.
- **Verification:** `newFeatureId`/`newSketchId` used by `addFeature`, sketch creation, and editor feature-creation handlers; `featureTree.spec.ts`, `document.spec.ts`, `store.spec.ts` pass with non-literal id assertions.
- **Validation:** Two branches that each add a feature end up with distinct feature ids; merging keeps them separate.

---

## Succinct description

`ids.ts` is a two-function module that generates globally-unique, prefix-tagged ids for features (`f…`) and sketches (`s…`) using a 9-character base-36 random suffix from `crypto.getRandomValues`.

---

## How it works — for everyone (non-technical)

Every feature and sketch in the CAD editor needs a name tag that is guaranteed to be unique, even when two people are working on different copies of the same part at the same time. This module generates those tags by drawing from the operating system's random number source, making accidental duplicates practically impossible.

---

## How it works — in detail (technical)

### Exported API

| Export | Type | Description |
|--------|------|-------------|
| `uid(prefix)` | `(string) → string` | `prefix + randomSuffix()` — general purpose. |
| `newFeatureId()` | `() → string` | `uid('f')` — for `FeatureTree` features. |
| `newSketchId()` | `() → string` | `uid('s')` — for `SketchDocument` sketches. |

### randomSuffix

`randomSuffix()` calls `globalThis.crypto.getRandomValues` on an 8-byte buffer, converts each byte to base-36 (`padStart(2, '0')`), and takes the first 9 characters. Falls back to two chained `Math.random().toString(36)` calls when `crypto` is unavailable (Node.js < 19 test environments without the Web Crypto API).

**Why 9 base-36 chars?** 36^9 ≈ 1.0 × 10^14 — effectively collision-free for the scale of any single part's feature tree. Combined with the prefix letter (`f`/`s`), ids are readable in logs and debug output.

### The origin exception

The origin feature always uses the fixed literal id `f1`. It is the same feature in every document, created by `emptyFeatureTree()` and backfilled by `migrateFeatureTree`. It is deliberately not randomized because content-addressed VCS hashing depends on the origin being the same object in every tree.

### Why this replaced sequential ids

The old scheme assigned `f<nextFeatureSeq>`, `s<nextSketchSeq>` per document. Two branches that each start from the same commit and add one feature would both assign `f3` — to different features. A feature-level merge (see VCS `reconcileBranch`) had no way to distinguish them. Random ids resolve this entirely without cross-branch coordination.

---

## Key files

- `frontend/src/app/cad/lib/ids.ts` — this module (tiny, no spec file)
- `frontend/src/app/cad/lib/featureTree.ts` — calls `newFeatureId()` in `addFeature`
- `frontend/src/app/cad/lib/store.ts` — calls `newSketchId()` on sketch creation
