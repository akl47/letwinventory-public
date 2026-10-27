import { describe, it, expect } from 'vitest';
import { formatDiffEntry } from './diffFormat';
import type { CadDiffEntry } from '../../models/cad-model.model';

// Shared diff formatting for the version-history Compare view and the check-in
// dialog (REQ 713/714). The top line names the changed feature/sketch/equations;
// sub-lines list the specific constraint/dimension and geometry changes, with
// the user's real edits (constraints/dimensions) surfaced before re-solve noise.

const base = (over: Partial<CadDiffEntry>): CadDiffEntry => ({
  name: 'feature:f2', kind: 'feature', status: 'modified', aHash: 'a', bHash: 'b', ...over,
});

describe('diffFormat: top-line label + sign', () => {
  it('prefers the backend-resolved display name', () => {
    const r = formatDiffEntry(base({ displayName: 'Boss-Extrude1', status: 'added' }));
    expect(r.text).toBe('Boss-Extrude1');
    expect(r.sign).toBe('+');
    expect(r.cls).toBe('add');
  });

  it('falls back to "Feature <id>" for a feature: name with no display name', () => {
    const r = formatDiffEntry(base({ name: 'feature:f7', displayName: undefined }));
    expect(r.text).toBe('Feature f7');
    expect(r.sign).toBe('~');
    expect(r.cls).toBe('mod');
  });

  it('falls back to "Sketch <id>" for a sketch: name', () => {
    const r = formatDiffEntry(base({ name: 'sketch:s3', kind: 'sketch', status: 'removed', displayName: undefined }));
    expect(r.text).toBe('Sketch s3');
    expect(r.sign).toBe('−');
    expect(r.cls).toBe('del');
  });

  it('labels the equations blob', () => {
    const r = formatDiffEntry(base({ name: 'equations', kind: 'equations', displayName: undefined }));
    expect(r.text).toBe('Equations');
  });

  it('uses the raw name when it matches no known prefix', () => {
    const r = formatDiffEntry(base({ name: 'mystery', displayName: undefined }));
    expect(r.text).toBe('mystery');
  });
});

describe('diffFormat: parameter detail on the top line', () => {
  it('appends up to three changed params with a → b values', () => {
    const r = formatDiffEntry(base({
      displayName: 'Extrude1',
      paramDiff: { changed: [
        { key: 'distance', a: 10, b: 25 },
        { key: 'flipped', a: false, b: true },
      ], added: [], removed: [] },
    }));
    expect(r.text).toBe('Extrude1 — distance 10 → 25, flipped false → true');
  });

  it('truncates the param detail to the first three changes', () => {
    const r = formatDiffEntry(base({
      displayName: 'Extrude1',
      paramDiff: { changed: [
        { key: 'a', a: 1, b: 2 }, { key: 'b', a: 1, b: 2 },
        { key: 'c', a: 1, b: 2 }, { key: 'd', a: 1, b: 2 },
      ], added: [], removed: [] },
    }));
    expect(r.text).toBe('Extrude1 — a 1 → 2, b 1 → 2, c 1 → 2');
    expect(r.text).not.toContain('d 1');
  });

  it('formats non-integer numbers trimmed to 3 decimals and ∅ for null/undefined', () => {
    const r = formatDiffEntry(base({
      displayName: 'Extrude1',
      paramDiff: { changed: [
        { key: 'distance', a: null, b: 12.5 },
        { key: 'angle', a: 1.23456, b: 2 },
      ], added: [], removed: [] },
    }));
    expect(r.text).toBe('Extrude1 — distance ∅ → 12.5, angle 1.235 → 2');
  });
});

describe('diffFormat: sketch sub-lines', () => {
  it('lists constraint changes before geometry changes', () => {
    const r = formatDiffEntry(base({
      name: 'sketch:s1', kind: 'sketch', displayName: 'Sketch1',
      sketchDiff: {
        constraints: [{ id: 'c1', type: 'distance', status: 'modified', a: 10, b: 20 }],
        entities: [
          { id: 'p1', kind: 'point', status: 'modified' },
          { id: 'p2', kind: 'point', status: 'modified' },
          { id: 'l1', kind: 'line', status: 'added' },
        ],
        meta: [],
      },
    }));
    expect(r.sublines.map(s => s.text)).toEqual([
      'Distance 10 → 20',  // constraint first
      '2 points moved',    // modified geometry grouped + pluralised
      '1 line',            // added geometry
    ]);
  });

  it('renders an added constraint with only its b value and a removed one with its a value', () => {
    const r = formatDiffEntry(base({
      name: 'sketch:s1', kind: 'sketch', displayName: 'Sketch1',
      sketchDiff: {
        constraints: [
          { id: 'c1', type: 'radius', status: 'added', b: 5 },
          { id: 'c2', type: 'horizontal', status: 'removed' },
        ],
        entities: [],
        meta: [],
      },
    }));
    expect(r.sublines[0]).toMatchObject({ sign: '+', cls: 'add', text: 'Radius 5' });
    expect(r.sublines[1]).toMatchObject({ sign: '−', cls: 'del', text: 'Horizontal' });
  });

  it('maps known constraint and entity kinds to human labels and falls back to the raw key', () => {
    const r = formatDiffEntry(base({
      name: 'sketch:s1', kind: 'sketch', displayName: 'Sketch1',
      sketchDiff: {
        constraints: [{ id: 'c1', type: 'point-line-distance', status: 'added', b: 3 }],
        entities: [
          { id: 'e1', kind: 'ellipticalArc', status: 'added' },
          { id: 'e2', kind: 'gizmo', status: 'added' }, // unknown kind → raw
        ],
        meta: [],
      },
    }));
    expect(r.sublines[0].text).toBe('Distance 3');          // point-line-distance → "Distance"
    expect(r.sublines.map(s => s.text)).toContain('1 elliptical arc');
    expect(r.sublines.map(s => s.text)).toContain('1 gizmo'); // unknown kind passes through
  });

  it('reports sketch meta changes (name/visibility) as modified sub-lines', () => {
    const r = formatDiffEntry(base({
      name: 'sketch:s1', kind: 'sketch', displayName: 'Sketch1',
      sketchDiff: {
        constraints: [], entities: [],
        meta: [{ key: 'name', a: 'Sketch1', b: 'Top profile' }],
      },
    }));
    expect(r.sublines).toEqual([{ sign: '~', cls: 'mod', text: 'name Sketch1 → Top profile' }]);
  });

  it('has no sub-lines when there is no sketchDiff', () => {
    expect(formatDiffEntry(base({ displayName: 'Extrude1' })).sublines).toEqual([]);
  });
});
