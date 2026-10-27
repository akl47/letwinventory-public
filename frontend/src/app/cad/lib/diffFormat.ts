import type { CadDiffEntry } from '../../models/cad-model.model';

// Human-readable formatting of a CAD structural diff entry, shared by the
// version-history Compare view and the check-in dialog.

export interface DiffLine { sign: string; cls: string; text: string; }
export interface FormattedDiff extends DiffLine { sublines: DiffLine[]; }

const ENTITY_LABEL: Record<string, string> = {
  point: 'point', line: 'line', circle: 'circle', arc: 'arc', ellipse: 'ellipse',
  ellipticalArc: 'elliptical arc', spline: 'spline', conic: 'conic', text: 'text',
  picture: 'image', equation: 'equation curve', intersection: 'intersection', splineOnSurface: 'spline',
};
const CONSTRAINT_LABEL: Record<string, string> = {
  coincident: 'Coincident', fixed: 'Fixed', horizontal: 'Horizontal', vertical: 'Vertical',
  distance: 'Distance', perpendicular: 'Perpendicular', parallel: 'Parallel', tangent: 'Tangent',
  equal: 'Equal', symmetric: 'Symmetric', midpoint: 'Midpoint', concentric: 'Concentric',
  coradial: 'Coradial', collinear: 'Collinear', radius: 'Radius', diameter: 'Diameter', angle: 'Angle',
  'horizontal-distance': 'Horizontal distance', 'vertical-distance': 'Vertical distance',
  'point-line-distance': 'Distance', 'arc-length': 'Arc length', 'chord-distance': 'Chord distance', 'on-edge': 'On edge',
};

function val(v: unknown): string {
  if (v === undefined || v === null) return '∅';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

const sigil = (s: string): DiffLine => s === 'added' ? { sign: '+', cls: 'add', text: '' }
  : s === 'removed' ? { sign: '−', cls: 'del', text: '' } : { sign: '~', cls: 'mod', text: '' };

// Specific per-constraint / per-entity changes for a modified sketch. Constraint
// and dimension edits (what the user actually changed) come first; geometry
// changes are summarised by kind so a re-solve nudging every point reads as one
// line instead of burying the real change in noise.
function sketchSublines(e: CadDiffEntry): DiffLine[] {
  const sd = e.sketchDiff; if (!sd) return [];
  const out: DiffLine[] = [];

  for (const c of sd.constraints) {
    const m = sigil(c.status);
    const name = CONSTRAINT_LABEL[c.type] || c.type;
    let v = '';
    if (c.status === 'modified' && (c.a !== undefined || c.b !== undefined)) v = ` ${val(c.a)} → ${val(c.b)}`;
    else if (c.b !== undefined) v = ` ${val(c.b)}`;
    else if (c.a !== undefined) v = ` ${val(c.a)}`;
    out.push({ ...m, text: `${name}${v}` });
  }

  const groups = new Map<string, number>();
  for (const en of sd.entities) {
    const key = `${en.status}|${en.kind}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  for (const [key, n] of groups) {
    const [status, kind] = key.split('|');
    const label = ENTITY_LABEL[kind] || kind;
    out.push({ ...sigil(status), text: status === 'modified' ? `${plural(n, label)} moved` : plural(n, label) });
  }

  for (const mt of sd.meta) out.push({ sign: '~', cls: 'mod', text: `${mt.key} ${val(mt.a)} → ${val(mt.b)}` });
  return out;
}

/** Format a diff entry into a top line + indented sub-lines. Prefers the
 * feature-tree display name (resolved by the backend); falls back to the id. */
export function formatDiffEntry(e: CadDiffEntry): FormattedDiff {
  const m = sigil(e.status);
  let label: string;
  if (e.displayName) label = e.displayName;
  else if (e.name.startsWith('feature:')) label = 'Feature ' + e.name.slice(8);
  else if (e.name.startsWith('sketch:')) label = 'Sketch ' + e.name.slice(7);
  else if (e.name === 'equations') label = 'Equations';
  else label = e.name;
  let detail = '';
  if (e.paramDiff?.changed?.length) {
    detail = ' — ' + e.paramDiff.changed.slice(0, 3).map(c => `${c.key} ${val(c.a)} → ${val(c.b)}`).join(', ');
  }
  return { ...m, text: label + detail, sublines: sketchSublines(e) };
}
