// REQ 921 — 3D edge chaining for Convert Entities. Given a picked seed edge
// and the candidate edge list (body topology edges or in-context overlay
// edges), walk shared 3D endpoints transitively and return every connected
// edge id. Pure math — no Angular.

export interface ChainableEdge {
  id: string;
  /** Straight-edge endpoints; absent for closed curves (full circles). */
  endpoints?: [[number, number, number], [number, number, number]];
  /** Sampled polyline; first/last samples serve as endpoints when the
   * explicit pair is absent (open curved edges). */
  polyline?: Array<[number, number, number]>;
}

function openPair(
  a: [number, number, number], b: [number, number, number],
): Array<[number, number, number]> {
  // Coincident ends = a closed curve (full circle) — no open endpoints to
  // chain through.
  const d2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  return d2 < 1e-12 ? [] : [a, b];
}

function endpointsOf(e: ChainableEdge): Array<[number, number, number]> {
  if (e.endpoints && e.endpoints.length === 2) return openPair(e.endpoints[0], e.endpoints[1]);
  if (e.polyline && e.polyline.length >= 2) return openPair(e.polyline[0], e.polyline[e.polyline.length - 1]);
  return [];
}

/** All edge ids transitively connected to `seedId` via shared endpoints
 * (within `tol`), seed included and FIRST. Closed curves (no open
 * endpoints) never join a chain — except as the seed itself. */
export function chainEdgeIds(edges: ChainableEdge[], seedId: string, tol = 1e-6): string[] {
  const byId = new Map(edges.map((e) => [e.id, e]));
  const seed = byId.get(seedId);
  if (!seed) return [seedId];
  const tol2 = tol * tol;
  const near = (a: [number, number, number], b: [number, number, number]) =>
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 <= tol2;

  const chain: string[] = [seedId];
  const inChain = new Set<string>([seedId]);
  // Frontier of open endpoints to expand from.
  let frontier = endpointsOf(seed);
  while (frontier.length) {
    const nextFrontier: Array<[number, number, number]> = [];
    for (const e of edges) {
      if (inChain.has(e.id)) continue;
      const eps = endpointsOf(e);
      if (!eps.length) continue;  // closed curve — never chains
      if (eps.some((p) => frontier.some((f) => near(p, f)))) {
        inChain.add(e.id);
        chain.push(e.id);
        nextFrontier.push(...eps);
      }
    }
    frontier = nextFrontier;
  }
  return chain;
}
