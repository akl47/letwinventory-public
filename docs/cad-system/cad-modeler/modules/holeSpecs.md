# Hole Specs Module

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Holes](../holes.md) ▸ **holeSpecs.ts**
> Related: [featureTree.md](./featureTree.md) · [holes.md](../holes.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 664 | unapproved | Static hardware specification table for the Hole Wizard |

### REQ 664 — Hardware specification table
- **Description:** The Hole Wizard feature shall include a static hardware specification table covering ISO metric sizes M2 through M12 and ANSI Unified inch sizes #4 through 1/2″, with each entry specifying clearance drill diameter, tap drill diameter, counterbore diameter and depth, countersink diameter and angle, thread pitch, and thread major diameter. All values shall be stored in millimeters.
- **Rationale:** The Hole Wizard needs a single authoritative lookup to compute the correct drill and counterbore geometry without the user manually entering each diameter.
- **Verification:** `frontend/src/app/cad/lib/holeSpecs.spec.ts` asserts that `holeSpec('iso', 'M4')` and `holeSpec('ansi', 'I1_4')` return the correct tabulated values.
- **Validation:** A designer selects M6 from the Hole Wizard size dropdown and the generated hole has the correct clearance diameter and counterbore geometry.

---

## Succinct description

`holeSpecs.ts` is a static data table — the single source of truth for drill and thread dimensions for every supported ISO metric and ANSI inch screw size.

## How it works — for everyone (non-technical)

Rather than asking the user to look up the right drill size for an M6 socket-head cap screw, the Hole Wizard reads this table. The table has one row per screw size and stores every relevant dimension: the hole that lets the screw slide through, the smaller hole to tap a thread into, the recessed pocket for the head, the angled countersink shape, and the cosmetic thread pitch for display. All values are in millimetres regardless of whether the original size is metric or inch.

## How it works — in detail (technical)

### `HoleSpec` interface

```ts
interface HoleSpec {
  label: string;                // "M4" or "1/4"
  clearanceDrillDiameter: number;
  tapDrillDiameter: number;
  counterboreDiameter: number;
  counterboreDepth: number;
  countersinkDiameter: number;
  countersinkAngleDeg: number;  // ISO = 90°, ANSI = 82°
  threadPitch: number;
  threadMajorDiameter: number;
}
```

### Tables

| Table | Sizes | Source standards |
|-------|-------|-----------------|
| `ISO_TABLE` | M2, M2.5, M3, M4, M5, M6, M8, M10, M12 | ISO 273, ISO 4762, ISO 7991 |
| `ANSI_TABLE` | #4, #6, #8, #10, 1/4, 5/16, 3/8, 7/16, 1/2 | ANSI/ASME B18.3, B18.6.3 |

ANSI values are pre-converted to mm at table-write time. Counterbore depth = head height + 0.5 mm clearance. Countersink diameter = flat-head major Ø + 0.2 mm clearance.

### Exported functions

| Export | Purpose |
|--------|---------|
| `holeSpec(standard, sizeKey)` | Throws on unknown key; returns the matching `HoleSpec`. |
| `sizeOptions(standard)` | Returns `Array<{ key, label }>` in display order (smallest first) for the size dropdown. |
| `defaultSizeFor(standard)` | Returns `'M3'` for ISO or `'I1_4'` for ANSI — the initial value when the standard selector changes. |

### Key constants

- `ISO_SIZE_KEYS` — tuple of the 9 ISO key strings in order.
- `ANSI_SIZE_KEYS` — tuple of the 9 ANSI key strings in order.
- `HoleSizeKey` — union of `IsoSizeKey | AnsiSizeKey`.

## Key files

- `frontend/src/app/cad/lib/holeSpecs.ts` — `HoleSpec`, `holeSpec`, `sizeOptions`, `defaultSizeFor`, size key types and constants
- `frontend/src/app/cad/lib/holeSpecs.spec.ts` — unit tests
