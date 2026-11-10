import { describe, expect, it } from 'vitest';
import {
  applyFolders, canFolder, foldersAdd, foldersAddTo, foldersDelete, foldersRemove, foldersRename,
  type TreeFolder,
} from './treeFolders';

// REQ 1046 — folders in the part and assembly trees: a folder gathers one
// consecutive run of top-level rows under a collapsible parent row.

interface Row { key: string; depth: number; label?: string }
const r = (key: string, depth = 0): Row => ({ key, depth });
const folderRow = (f: TreeFolder, count: number, expanded: boolean): Row =>
  ({ key: `folder:${f.id}`, depth: 0, label: `${f.name}/${count}/${expanded ? 'open' : 'shut'}` });
const show = (rows: Row[]) => rows.map(x => `${x.key}@${x.depth}${x.label ? ' ' + x.label : ''}`);

// f1 has a child sketch row; f3 and f4 are top-level.
const rows = [r('origin'), r('f1'), r('s1', 1), r('f2'), r('f3'), r('f4')];

describe('applyFolders', () => {
  it('puts a consecutive run under its folder row, members (and their children) one level deeper', () => {
    const out = applyFolders(rows, [{ id: 'a', name: 'Base', memberKeys: ['f2', 'f1'] }], new Set(), folderRow);
    expect(show(out)).toEqual(['origin@0', 'folder:a@0 Base/2/open', 'f1@1', 's1@2', 'f2@1', 'f3@0', 'f4@0']);
  });

  it('hides members of a collapsed folder', () => {
    const out = applyFolders(rows, [{ id: 'a', name: 'Base', memberKeys: ['f1', 'f2'] }], new Set(['a']), folderRow);
    expect(show(out)).toEqual(['origin@0', 'folder:a@0 Base/2/shut', 'f3@0', 'f4@0']);
  });

  it('shows a member outside the run at top level', () => {
    const out = applyFolders(rows, [{ id: 'a', name: 'Base', memberKeys: ['f1', 'f4'] }], new Set(), folderRow);
    expect(show(out)).toEqual(['origin@0', 'folder:a@0 Base/1/open', 'f1@1', 's1@2', 'f2@0', 'f3@0', 'f4@0']);
  });

  it('ignores folders with no member in the tree', () => {
    expect(applyFolders(rows, [{ id: 'a', name: 'Gone', memberKeys: ['zz'] }], new Set(), folderRow)).toEqual(rows);
  });
});

describe('canFolder', () => {
  it('accepts consecutive top-level rows only', () => {
    expect(canFolder(rows, ['f1', 'f2'])).toBe(true);
    expect(canFolder(rows, ['f3', 'f1', 'f2'])).toBe(true);
    expect(canFolder(rows, ['f1', 'f3'])).toBe(false);
    expect(canFolder(rows, ['s1'])).toBe(false);  // nested row
    expect(canFolder(rows, [])).toBe(false);
  });
});

describe('folder edits', () => {
  const base: TreeFolder[] = [{ id: 'a', name: 'A', memberKeys: ['f1', 'f2'] }];

  it('adding a folder moves its rows out of others and drops emptied folders', () => {
    expect(foldersAdd(base, { id: 'b', name: 'B', memberKeys: ['f2', 'f3'] })).toEqual([
      { id: 'a', name: 'A', memberKeys: ['f1'] },
      { id: 'b', name: 'B', memberKeys: ['f2', 'f3'] },
    ]);
    expect(foldersAdd(base, { id: 'b', name: 'B', memberKeys: ['f1', 'f2'] }).map(f => f.id)).toEqual(['b']);
  });

  it('adds to, removes from, renames and deletes', () => {
    const two = foldersAdd(base, { id: 'b', name: 'B', memberKeys: ['f4'] });
    expect(foldersAddTo(two, 'a', ['f3', 'f4'])).toEqual([{ id: 'a', name: 'A', memberKeys: ['f1', 'f2', 'f3', 'f4'] }]);
    expect(foldersRemove(base, ['f1'])).toEqual([{ id: 'a', name: 'A', memberKeys: ['f2'] }]);
    expect(foldersRename(base, 'a', ' Kit ')[0].name).toBe('Kit');
    expect(foldersRename(base, 'a', '  ')).toBe(base);
    expect(foldersDelete(base, 'a')).toEqual([]);
  });
});
