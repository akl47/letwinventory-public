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
      blocks.push({ t: componentCreatedAt[row.key.slice('component:'.length)] ?? 0, rows });
    } else {
      tail.push(row);
    }
  }
  for (const s of skeleton) blocks.push({ t: s.createdAt ?? 0, rows: [s] });
  blocks.sort((a, b) => a.t - b.t);  // stable: ties keep components first, in order
  return [...head, ...blocks.flatMap((b) => b.rows), ...tail];
}
