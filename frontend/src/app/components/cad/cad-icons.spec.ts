import { describe, it, expect } from 'vitest';
import { CAD_ICON_NAMES } from './cad-icons';

/**
 * Spec: every icon name referenced by ToolSpec / ConstraintSpec arrays
 * (or by the constraint-list component) must exist in the CAD icon
 * registry. If it doesn't, the `<mat-icon [svgIcon]="...">` lookup
 * silently renders nothing — the toolbar would have empty buttons.
 *
 * We expose CAD_ICON_NAMES from cad-icons.ts so this spec can
 * cross-check without needing to import the component (which would
 * drag in Angular Material + DOM dependencies into a unit test).
 */
describe('CAD icon registry', () => {
  it('exposes a non-empty set of registered icon names', () => {
    expect(CAD_ICON_NAMES.length).toBeGreaterThan(40);
  });

  it('every name uses the cad-* prefix', () => {
    for (const n of CAD_ICON_NAMES) {
      expect(n).toMatch(/^cad-/);
    }
  });

  it('includes one icon per primitive draw tool', () => {
    // Smoke set: failures here mean the icon library is missing an
    // entry one of the editor toolbar buttons points at.
    const required = [
      'cad-select',
      'cad-point', 'cad-line', 'cad-centerline', 'cad-midpoint-line',
      'cad-spline', 'cad-style-spline',
      'cad-circle', 'cad-circle-perimeter', 'cad-circle-3pt',
      'cad-arc', 'cad-arc-3pt', 'cad-tangent-arc',
      'cad-ellipse', 'cad-partial-ellipse',
    ];
    for (const n of required) expect(CAD_ICON_NAMES).toContain(n);
  });

  it('includes one icon per composite shape tool', () => {
    const required = [
      'cad-rect-corner', 'cad-rect-center', 'cad-rect-3pt-corner', 'cad-rect-3pt-center',
      'cad-parallelogram', 'cad-polygon',
      'cad-slot', 'cad-slot-centerpoint', 'cad-slot-arc-3pt', 'cad-slot-arc-centerpoint',
    ];
    for (const n of required) expect(CAD_ICON_NAMES).toContain(n);
  });

  it('includes one icon per edit / modify tool', () => {
    const required = [
      'cad-trim', 'cad-extend', 'cad-split', 'cad-jog',
      'cad-fillet', 'cad-chamfer', 'cad-offset',
      'cad-mirror', 'cad-dynamic-mirror',
      'cad-convert', 'cad-construction',
    ];
    for (const n of required) expect(CAD_ICON_NAMES).toContain(n);
  });

  it('includes one icon per transform tool', () => {
    const required = [
      'cad-move', 'cad-copy', 'cad-rotate', 'cad-scale', 'cad-stretch',
      'cad-pattern-linear', 'cad-pattern-circular',
    ];
    for (const n of required) expect(CAD_ICON_NAMES).toContain(n);
  });

  it('includes one icon per geometric constraint', () => {
    const required = [
      'cad-fixed', 'cad-coincident', 'cad-horizontal', 'cad-vertical',
      'cad-perpendicular', 'cad-parallel', 'cad-tangent', 'cad-equal',
      'cad-midpoint', 'cad-symmetric', 'cad-concentric', 'cad-coradial',
      'cad-collinear', 'cad-merge-points',
    ];
    for (const n of required) expect(CAD_ICON_NAMES).toContain(n);
  });

  it('includes one icon per dimensional constraint', () => {
    const required = [
      'cad-smart-dim', 'cad-radius', 'cad-diameter', 'cad-angle',
      'cad-horizontal-distance', 'cad-vertical-distance',
      'cad-equal-x', 'cad-equal-y',
      'cad-point-line-distance', 'cad-arc-length', 'cad-chord-distance',
    ];
    for (const n of required) expect(CAD_ICON_NAMES).toContain(n);
  });
});
