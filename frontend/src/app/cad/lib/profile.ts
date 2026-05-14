import type { SketchState, LineEntity } from './types';
import { findPoint, linesOf } from './types';

export type ProfileLoop = Array<{ x: number; y: number }>;

export interface ProfileResult {
  loop: ProfileLoop | null;
  error?: string;
}

function buildAdjacency(lines: LineEntity[]): Map<string, string[]> {
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
  // REQ 560: construction entities are excluded from profile extraction.
  // For Phase A we still only consume Line entities; curve tessellation lands in A.2.
  const lines = linesOf(state).filter(l => !l.construction);
  if (lines.length === 0) {
    return { loop: null, error: 'sketch has no lines (empty profile)' };
  }
  if (lines.length < 3) {
    return { loop: null, error: 'closed profile requires at least 3 line segments' };
  }

  const adj = buildAdjacency(lines);
  for (const [pointId, incident] of adj) {
    if (incident.length === 1) {
      return { loop: null, error: `open chain detected at point ${pointId}` };
    }
    if (incident.length > 2) {
      return { loop: null, error: `point ${pointId} touches ${incident.length} edges (must be exactly 2)` };
    }
  }

  const startLine = lines[0];
  const visitedLines = new Set<string>();
  const walk: string[] = [];
  let prevPoint = startLine.startId;
  walk.push(prevPoint);
  let currentLine: string | undefined = startLine.id;
  while (currentLine && !visitedLines.has(currentLine)) {
    visitedLines.add(currentLine);
    const line = lines.find(l => l.id === currentLine)!;
    const nextPoint = line.startId === prevPoint ? line.endId : line.startId;
    walk.push(nextPoint);
    prevPoint = nextPoint;
    const incident = adj.get(prevPoint) || [];
    currentLine = incident.find(id => id !== currentLine);
  }
  if (walk[0] !== walk[walk.length - 1]) {
    return { loop: null, error: 'profile is not a closed loop' };
  }
  if (visitedLines.size !== lines.length) {
    return { loop: null, error: 'sketch contains multiple disjoint loops' };
  }

  const points = walk.slice(0, -1).map(pid => {
    const p = findPoint(state, pid);
    return { x: p?.x ?? 0, y: p?.y ?? 0 };
  });
  return { loop: points };
}
