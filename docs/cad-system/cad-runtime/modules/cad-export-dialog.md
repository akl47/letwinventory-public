# cad-export-dialog

> **System** ▸ [Overview](../../00-overview.md) ▸ [VCS](../../30-vcs.md) ▸ **cad-export-dialog**
> Related: [cad-editor](./cad-editor.md) · [VCS](../../30-vcs.md)

---

## Requirements

Requirements governed by [VCS group](../../30-vcs.md).

| REQ | Status | Summary |
|-----|--------|---------|
| 719 | unapproved | Downloadable STL and STEP files from frozen release geometry |
| 723 | unapproved | STL export uses OCCT kernel exportStl; STEP uses exportStep |

---

## Succinct description

A MatDialog for configuring and triggering a STL or STEP export: body selection, per-body or combined output, filename template with variable substitution.

## How it works — for everyone (non-technical)

When you click Export in the editor, this dialog pops up and lets you choose which bodies to include and what to name the file. You can export all bodies into one file, or each body as its own file (optionally bundled into a zip). The filename box accepts placeholders like `#{partNumber}` and `#{rev}` that fill in automatically from the part's data.

## How it works — in detail (technical)

**Selector:** `app-cad-export-dialog`

Opened by `cad-editor` with:
```typescript
interface ExportDialogData {
  format: 'STL' | 'STEP';
  bodies: ExportDialogBody[];       // { id, label } per body
  vars: Record<string, string>;     // partNumber, rev, partName, manufacturerPN
}
```

Returns `ExportDialogResult | null`:
```typescript
interface ExportDialogResult {
  bodyIds: string[];
  separate: boolean;   // one file per body when true
  zip: boolean;        // bundle separate files into a .zip
  nameTemplate: string;
}
```

### Filename template

`DEFAULT_EXPORT_NAME_TEMPLATE = '#{partNumber}-#{rev} - #{bodyName}'`. `resolveExportName(template, vars)` replaces `#{key}` placeholders, then strips dangling separators left by empty substitutions (e.g., a combined export has no `#{bodyName}` → `"PN-01 - "` becomes `"PN-01"`). Path-unsafe characters are replaced with `_`.

The dialog shows a live preview (`previewName()`) under the template input. For separate+zip export, `zipName()` resolves the bundle filename with `bodyName = ''`.

### Body checkboxes

`selected` is a `signal<Set<string>>` initialised to all body ids. `allSelected()` / `someSelected()` drive the "All bodies" indeterminate checkbox. `separate` and `zip` signals are derived from checkboxes; `zip` is only rendered when `separate && selectedCount >= 2`.

## Key files

- `frontend/src/app/components/cad/cad-export-dialog/cad-export-dialog.component.ts` — exports `resolveExportName` (also imported by cad-editor directly)
