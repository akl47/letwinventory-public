import { describe, it, expect } from 'vitest';
import { emptySketchState, addPoint, addLine, addCircle, addConstraint } from './store';
import { multiConstraintGroups } from './multiConstraint';
import type { SketchState, SketchEntity } from './types';

// REQ 990 — one constraint click relates every selected entity (SolidWorks).
function lines(n: number): { st: SketchState; ids: string[] } {
  let st = emptySketchState();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = addPoint(st, i * 10, 0); st = a.state;
    const b = addPoint(st, i * 10 + 5, 3); st = b.state;
    const l = addLine(st, a.id, b.id); st = l.state;
    ids.push(l.id);
  }
  return { st, ids };
}
const ents = (st: SketchState, ids: string[]) =>
  ids.map(id => st.entities.find(e => e.id === id)!) as SketchEntity[];

describe('multiConstraintGroups', () => {
  it('Horizontal on N lines adds one constraint per line', () => {
    const { st, ids } = lines(3);
    expect(multiConstraintGroups(st, 'horizontal', ents(st, ids))).toEqual(ids.map(id => [id]));
  });

  it('Equal on N lines chains every line to the first', () => {
    const { st, ids } = lines(4);
    expect(multiConstraintGroups(st, 'equal', ents(st, ids)))
      .toEqual([[ids[0], ids[1]], [ids[0], ids[2]], [ids[0], ids[3]]]);
  });

  it('Equal on N circles/arcs chains them; mixed lines + circles is rejected', () => {
    let st = emptySketchState();
    const c = [5, 6, 7].map(r => { const x = addCircle(st, r * 10, 0, r); st = x.state; return x.id; });
    expect(multiConstraintGroups(st, 'equal', ents(st, c))).toEqual([[c[0], c[1]], [c[0], c[2]]]);
    const p1 = addPoint(st, 0, 9); st = p1.state;
    const p2 = addPoint(st, 4, 9); st = p2.state;
    const l = addLine(st, p1.id, p2.id); st = l.state;
    expect(multiConstraintGroups(st, 'equal', ents(st, [...c, l.id]))).toBeNull();
  });

  it('Horizontal on 3+ points aligns them all with the first', () => {
    let st = emptySketchState();
    const p = [0, 1, 2].map(i => { const x = addPoint(st, i * 5, i); st = x.state; return x.id; });
    expect(multiConstraintGroups(st, 'horizontal', ents(st, p))).toEqual([[p[0], p[1]], [p[0], p[2]]]);
  });

  it('skips constraints that already exist', () => {
    const { st: s0, ids } = lines(3);
    const st = addConstraint(s0, 'horizontal', [ids[1]]).state;
    expect(multiConstraintGroups(st, 'horizontal', ents(st, ids))).toEqual([[ids[0]], [ids[2]]]);
  });

  it('returns null for pairwise-only constraints and too-small selections', () => {
    const { st, ids } = lines(3);
    expect(multiConstraintGroups(st, 'perpendicular', ents(st, ids))).toBeNull();
    expect(multiConstraintGroups(st, 'horizontal', ents(st, ids.slice(0, 1)))).toBeNull();
  });
});
