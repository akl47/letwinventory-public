/** REQ 1007 — assembly tree in creation order. Pure row merge so it can be
 * unit-tested without the editor. */
export interface OrderRow { key: string; depth: number; createdAt?: number }

/** Keep the Origin block first, then interleave component blocks (a
 * `component:<id>` row plus its nested rows) with top-level skeleton rows by
 * creation time; remaining rows (patterns, display states) follow. Components
 * without a recorded time sort first, in stored order. */
export function creationOrderTree<T extends OrderRow>(
  base: T[], skeleton: T[], componentCreatedAt: Record<string, number | undefined>,
): T[] {
  let i = 0;
  const head: T[] = [];
  while (i < base.length && base[i].key.startsWith('origin')) head.push(base[i++]);
  const blocks: Array<{ t: number; rows: T[] }> = [];
  const tail: T[] = [];
  while (i < base.length) {
    const row = base[i++];
    if (row.depth === 0 && row.key.startsWith('component:')) {
      const rows = [row];
      while (i < base.length && base[i].depth > 0) rows.push(base[i++]);
      const t = componentCreatedAt[row.key.slice('component:'.length)] ?? 0;
      rows[0] = { ...row, createdAt: t };  // orderable: drag-reorder + rollback hit-testing
      blocks.push({ t, rows });
    } else {
      tail.push(row);
    }
  }
  for (const s of skeleton) blocks.push({ t: s.createdAt ?? 0, rows: [s] });
  blocks.sort((a, b) => a.t - b.t);  // stable: ties keep components first, in order
  return [...head, ...blocks.flatMap((b) => b.rows), ...tail];
}

/** Insert the rollback bar into a creation-ordered tree before the first
 * top-level row created at or after `rollbackAt` (no bar when rolled
 * forward). Rows from the bar to the end of the ordered block (and their
 * nested rows) are marked rolled back. */
export function withRollbackBar<T extends OrderRow & { rolledBack?: boolean }>(rows: T[], rollbackAt: number | null, bar: T): T[] {
  const orderable = (r: T) => r.depth === 0 && r.createdAt !== undefined;
  let lastOrdered = -1;
  rows.forEach((r, i) => { if (orderable(r)) lastOrdered = i; });
  if (lastOrdered < 0) return rows;  // nothing to roll back
  let end = lastOrdered + 1;
  while (end < rows.length && rows[end].depth > 0) end++;  // nested rows of the last block
  const start = rollbackAt === null ? -1 : rows.findIndex((r) => orderable(r) && r.createdAt! >= rollbackAt);
  if (start < 0) return rows;  // rolled forward: no bar, like the part tree
  return [
    ...rows.slice(0, start), bar,
    ...rows.slice(start, end).map((r) => ({ ...r, rolledBack: true })),
    ...rows.slice(end),
  ];
}

/** Every id-like token in a JSON value: string values split on ':' and '/'
 * (refs look like `datum:<id>`, `inst:<id>:xy_plane`, `<id>::<face>`). */
function idTokens(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') for (const t of value.split(/[:/]/)) { if (t) out.add(t); }
  else if (Array.isArray(value)) for (const v of value) idTokens(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) idTokens(v, out);
  return out;
}

/** References between orderable assembly-tree rows (key → keys it uses).
 * Skeleton planes/sketches reference whatever ids their data mentions;
 * components reference what the regen reported for their in-context refs. */
export function assemblyTreeRefs(input: {
  instanceIds: string[];
  skeletonFeatures: Array<{ id: string }>;
  skeletonSketches: Array<{ id: string }>;
  instanceRefs?: Record<string, string[]>;
}): Map<string, Set<string>> {
  const keyOf = new Map<string, string>();
  for (const id of input.instanceIds) keyOf.set(id, `component:${id}`);
  for (const f of input.skeletonFeatures) keyOf.set(f.id, `skelplane:${f.id}`);
  for (const s of input.skeletonSketches) keyOf.set(s.id, `skelsketch:${s.id}`);
  const refs = new Map<string, Set<string>>();
  for (const item of [...input.skeletonFeatures, ...input.skeletonSketches]) {
    const self = keyOf.get(item.id)!;
    const deps = new Set<string>();
    for (const t of idTokens(item)) {
      const k = keyOf.get(t);
      if (k && k !== self) deps.add(k);
    }
    if (deps.size) refs.set(self, deps);
  }
  for (const [iid, keys] of Object.entries(input.instanceRefs ?? {})) {
    refs.set(`component:${iid}`, new Set(keys.filter((k) => k !== `component:${iid}`)));
  }
  return refs;
}

/** Why moving row `key` to creation time `createdAt` would put it above
 * something it references (or below something referencing it); null if OK. */
export function reorderBlocker(
  key: string, createdAt: number, refs: Map<string, Set<string>>,
  createdAtOf: Map<string, number>, label: (key: string) => string,
): string | null {
  for (const dep of refs.get(key) ?? []) {
    const t = createdAtOf.get(dep);
    if (t !== undefined && t >= createdAt) return `${label(key)} references ${label(dep)}, so it has to stay below it.`;
  }
  for (const [other, deps] of refs) {
    if (other === key || !deps.has(key)) continue;
    const t = createdAtOf.get(other);
    if (t !== undefined && t <= createdAt) return `${label(other)} references ${label(key)}, so ${label(key)} has to stay above it.`;
  }
  return null;
}
