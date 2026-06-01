import type { ModelTopology } from './types';

export interface SeedEdge {
  edgeId: string;
  start: [number, number, number];
  end: [number, number, number];
}

/** Cosine of the half-angle below which two outgoing tangent vectors at
 * a shared endpoint count as tangent-continuous. Matches the kernel-side
 * `detect_tangent_edges` threshold (cos 5°). */
const TANGENT_DOT_THRESHOLD = 0.9962;

/** Endpoint-coincidence tolerance for tangent propagation. Generous
 * (1e-3 world units) because topology endpoints can drift a hair across
 * regen passes that re-tessellate curves. */
const ENDPOINT_TOL = 1e-3;

/** BFS walk from a seed body edge through `topology.edges`, including
 * every edge that is tangent-continuous with an already-included edge at
 * a shared endpoint. Used by the Fillet / Chamfer sidebar's tangent-
 * propagation mode so one click on a hole rim picks all four arcs.
 *
 * Returns the seed plus every propagated neighbor, each carrying the
 * canonical endpoint pair from topology (not the seed's potentially
 * drifted endpoints). The `edgeId` on each propagated entry preserves
 * the seed's scope prefix (e.g. "f2/") so the backend matcher still
 * works downstream. */
export function propagateTangentEdges(
  seed: SeedEdge,
  topology: ModelTopology,
): SeedEdge[] {
  if (topology.edges.length === 0) return [seed];

  const stripScope = (id: string): string => {
    const slash = id.lastIndexOf('/');
    return slash >= 0 ? id.slice(slash + 1) : id;
  };
  const close = (p: [number, number, number], q: [number, number, number]): boolean =>
    Math.abs(p[0] - q[0]) < ENDPOINT_TOL &&
    Math.abs(p[1] - q[1]) < ENDPOINT_TOL &&
    Math.abs(p[2] - q[2]) < ENDPOINT_TOL;
  const sub = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const unit = (v: [number, number, number]): [number, number, number] => {
    const L = Math.hypot(v[0], v[1], v[2]);
    return L < 1e-9 ? [0, 0, 0] : [v[0] / L, v[1] / L, v[2] / L];
  };
  const dot = (a: [number, number, number], b: [number, number, number]): number =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // Outgoing tangent at one endpoint of `e` — direction pointing away
  // from the endpoint into the edge interior. Curves use the polyline's
  // first/last segment direction; lines use the chord direction.
  const tangentAt = (e: ModelTopology['edges'][number], atStart: boolean): [number, number, number] => {
    if (e.polyline && e.polyline.length >= 2) {
      if (atStart) return unit(sub(e.polyline[1], e.polyline[0]));
      const n = e.polyline.length;
      return unit(sub(e.polyline[n - 2], e.polyline[n - 1]));
    }
    const [a, b] = e.endpoints;
    return atStart ? unit(sub(b, a)) : unit(sub(a, b));
  };

  const findEdge = (s: SeedEdge): ModelTopology['edges'][number] | null => {
    const stripped = stripScope(s.edgeId);
    const byId = topology.edges.find(e => e.id === stripped);
    if (byId) return byId;
    return topology.edges.find(e =>
      (close(e.endpoints[0], s.start) && close(e.endpoints[1], s.end)) ||
      (close(e.endpoints[0], s.end) && close(e.endpoints[1], s.start)),
    ) ?? null;
  };

  const seedEdge = findEdge(seed);
  if (!seedEdge) return [seed];

  const scopePrefix = seed.edgeId.endsWith(seedEdge.id)
    ? seed.edgeId.slice(0, seed.edgeId.length - seedEdge.id.length)
    : seed.edgeId.replace(/[^/]+$/, '');

  const visited = new Set<string>([seedEdge.id]);
  const out: SeedEdge[] = [
    { edgeId: seed.edgeId, start: seedEdge.endpoints[0], end: seedEdge.endpoints[1] },
  ];
  const queue: ModelTopology['edges'] = [seedEdge];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const atStart of [true, false]) {
      const sharedEnd = atStart ? cur.endpoints[0] : cur.endpoints[1];
      const curTan = tangentAt(cur, atStart);
      for (const other of topology.edges) {
        if (visited.has(other.id)) continue;
        const otherStartShared = close(other.endpoints[0], sharedEnd);
        const otherEndShared = close(other.endpoints[1], sharedEnd);
        if (!otherStartShared && !otherEndShared) continue;
        const otherTan = tangentAt(other, otherStartShared);
        // Anti-parallel for smooth continuity (the two edges go in
        // opposite directions away from the shared endpoint); abs() also
        // catches the parallel sign in case orientation conventions
        // drift across regen passes.
        if (Math.abs(dot(curTan, otherTan)) > TANGENT_DOT_THRESHOLD) {
          visited.add(other.id);
          out.push({
            edgeId: scopePrefix + other.id,
            start: other.endpoints[0],
            end: other.endpoints[1],
          });
          queue.push(other);
        }
      }
    }
  }
  return out;
}
