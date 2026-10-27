// REQ 955 — equation (global variable) rows for the branch merge picker.
// Compares main's and the branch's equations documents by variable name and
// returns one row per variable that differs. Applying a ticked row takes the
// branch's version (or the branch's removal) — see cadBranchService.

export interface EquationMergeRow {
  name: string;
  status: 'added' | 'removed' | 'modified';
}

type EquationsDoc = { entries?: Record<string, { expression?: string } | undefined> } | null | undefined;

export function equationMergeRows(mainEq: EquationsDoc, branchEq: EquationsDoc): EquationMergeRow[] {
  const m = (mainEq && mainEq.entries) || {};
  const b = (branchEq && branchEq.entries) || {};
  const rows: EquationMergeRow[] = [];
  for (const name of new Set([...Object.keys(m), ...Object.keys(b)])) {
    const inM = name in m; const inB = name in b;
    if (inB && !inM) rows.push({ name, status: 'added' });
    else if (inM && !inB) rows.push({ name, status: 'removed' });
    else if ((m[name]?.expression ?? '') !== (b[name]?.expression ?? '')) rows.push({ name, status: 'modified' });
  }
  return rows.sort((x, y) => x.name.localeCompare(y.name));
}
