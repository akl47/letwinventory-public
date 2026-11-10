/** REQ 1046 — folders in the part feature tree and the assembly tree. A
 * folder names top-level rows by key; it gathers ONE consecutive run of them
 * under a collapsible parent row, so regeneration order and the rollback bar
 * read exactly as without folders. A member a reorder moved out of the run
 * shows at top level. Pure, so both trees share it. */
export interface TreeFolder {
  id: string;
  name: string;
  /** Keys of top-level tree rows (part: feature / sketch id; assembly:
   * `component:<id>`, `skelsketch:…`, …). */
  memberKeys: string[];
}

interface Row { key: string; depth: number }

/** Rows with each folder's run under its folder row. A row's nested rows
 * (depth > 0 after it) travel with it, one level deeper. */
export function applyFolders<T extends Row>(
  rows: T[], folders: TreeFolder[], collapsed: ReadonlySet<string>,
  folderRow: (f: TreeFolder, memberCount: number, expanded: boolean) => T,
): T[] {
  const folderOf = new Map<string, TreeFolder>();
  for (const f of folders) for (const k of f.memberKeys) folderOf.set(k, f);
  if (folderOf.size === 0) return rows;
  // Top-level blocks: a row plus the nested rows that follow it.
  const blocks: T[][] = [];
  for (const row of rows) {
    if (row.depth === 0 || blocks.length === 0) blocks.push([row]);
    else blocks[blocks.length - 1].push(row);
  }
  const out: T[] = [];
  const placed = new Set<string>();
  for (let i = 0; i < blocks.length;) {
    const f = folderOf.get(blocks[i][0].key);
    if (!f || placed.has(f.id)) { out.push(...blocks[i++]); continue; }
    placed.add(f.id);
    const run: T[][] = [];
    while (i < blocks.length && folderOf.get(blocks[i][0].key) === f) run.push(blocks[i++]);
    const expanded = !collapsed.has(f.id);
    out.push(folderRow(f, run.length, expanded));
    if (expanded) for (const b of run) for (const row of b) out.push({ ...row, depth: row.depth + 1 });
  }
  return out;
}

/** Whether `keys` are top-level rows forming one consecutive run. */
export function canFolder(rows: Row[], keys: string[]): boolean {
  if (keys.length === 0) return false;
  const top = rows.filter(r => r.depth === 0).map(r => r.key);
  const at = keys.map(k => top.indexOf(k));
  if (at.some(i => i < 0)) return false;
  return Math.max(...at) - Math.min(...at) === new Set(at).size - 1;
}

const keep = (folders: TreeFolder[]) => folders.filter(f => f.memberKeys.length > 0);

/** Add a folder; its rows leave any other folder (emptied folders go). */
export function foldersAdd(folders: TreeFolder[], folder: TreeFolder): TreeFolder[] {
  const taken = new Set(folder.memberKeys);
  return keep([...folders.map(f => ({ ...f, memberKeys: f.memberKeys.filter(k => !taken.has(k)) })), { ...folder }]);
}

/** Add rows to an existing folder (they leave any other folder). */
export function foldersAddTo(folders: TreeFolder[], folderId: string, keys: string[]): TreeFolder[] {
  const taken = new Set(keys);
  return keep(folders.map(f => f.id === folderId
    ? { ...f, memberKeys: [...f.memberKeys.filter(k => !taken.has(k)), ...keys] }
    : { ...f, memberKeys: f.memberKeys.filter(k => !taken.has(k)) }));
}

export function foldersRemove(folders: TreeFolder[], keys: string[]): TreeFolder[] {
  const drop = new Set(keys);
  return keep(folders.map(f => ({ ...f, memberKeys: f.memberKeys.filter(k => !drop.has(k)) })));
}

/** Rename; a blank name returns `folders` unchanged. */
export function foldersRename(folders: TreeFolder[], folderId: string, name: string): TreeFolder[] {
  const trimmed = name.trim();
  if (!trimmed) return folders;
  return folders.map(f => (f.id === folderId ? { ...f, name: trimmed } : f));
}

/** Delete a folder; its rows stay in the tree, unfoldered. */
export function foldersDelete(folders: TreeFolder[], folderId: string): TreeFolder[] {
  return folders.filter(f => f.id !== folderId);
}
