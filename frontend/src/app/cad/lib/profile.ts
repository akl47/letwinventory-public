import type { SketchState, SketchLine } from './types';

export type ProfileLoop = Array<{ x: number; y: number }>;

export interface ProfileResult {
  loop: ProfileLoop | null;
  error?: string;
}

// Build adjacency map: point id → list of line ids touching it.
function buildAdjacency(lines: SketchLine[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const l of lines) {
    if (!adj.has(l.startId)) adj.set(l.startId, []);
    if (!adj.has(l.endId)) adj.set(l.endId, []);
    adj.get(l.startId)!.push(l.id);
    adj.get(l.endId)!.push(l.id);
  }
  return adj;
}

export function extractClosedLoop(state: SketchState): ProfileResult {
  const lines = state.lines.filter(l => !l.reference);
  if (lines.length === 0) {
    return { loop: null, error: 'sketch has no lines (empty profile)' };
  }
  if (lines.length < 3) {
    return { loop: null, error: 'closed profile requires at least 3 line segments' };
  }

  const adj = buildAdjacency(lines);
  // Each vertex in a closed loop has exactly 2 incident edges.
  for (const [pointId, incident] of adj) {
    if (incident.length === 1) {
      return { loop: null, error: `open chain detected at point ${pointId}` };
    }
    if (incident.length > 2) {
      return { loop: null, error: `point ${pointId} touches ${incident.length} edges (must be exactly 2)` };
    }
  }

  // Walk one loop starting from any line; if we don't traverse all lines, there
  // are multiple disjoint loops.
  const startLine = lines[0];
  const visitedLines = new Set<string>();
  const walk: string[] = []; // ordered list of point ids forming the loop
  let prevPoint = startLine.startId;
  walk.push(prevPoint);
  let currentLine: string | undefined = startLine.id;
  while (currentLine && !visitedLines.has(currentLine)) {
    visitedLines.add(currentLine);
    const line = lines.find(l => l.id === currentLine)!;
    const nextPoint = line.startId === prevPoint ? line.endId : line.startId;
    walk.push(nextPoint);
    prevPoint = nextPoint;
    // Find next line at this point (the other one not equal to currentLine).
    const incident = adj.get(prevPoint) || [];
    currentLine = incident.find(id => id !== currentLine);
  }
  // Loop closed if walk returns to start.
  if (walk[0] !== walk[walk.length - 1]) {
    return { loop: null, error: 'profile is not a closed loop' };
  }
  if (visitedLines.size !== lines.length) {
    return { loop: null, error: 'sketch contains multiple disjoint loops' };
  }

  // Materialize 2D coords (drop the trailing duplicate point that closes the loop).
  const points = walk.slice(0, -1).map(pid => {
    const p = state.points.find(pt => pt.id === pid);
    return { x: p?.x ?? 0, y: p?.y ?? 0 };
  });
  return { loop: points };
}
