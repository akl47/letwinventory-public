import type { ModelTopology } from './types';

/** REQ 1087 — whether model edges are drawn from kernel topology (one pickable
 * line per BRep edge) rather than per-face mesh edges, which carry no edge ids.
 * A curved edge the kernel could not sample (part 1695: fillet slivers 0.015 mm
 * long) is drawn as a chord; it must not cost the whole model its edge picking. */
export function usesTopologyEdges(topology: ModelTopology | undefined): boolean {
  return (topology?.edges.length ?? 0) > 0;
}
