import { Component, inject, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';
import type { SketchConstraint, SketchEntity, ConstraintType } from '../../../cad/lib/types';
import { formatNumber, parseUserValue, fromMm, unitSymbol, type Unit } from '../../../cad/lib/units';
import { registerCadIcons } from '../cad-icons';

// Sidebar listing every constraint in the active sketch. Each row shows:
//   - icon for the constraint type
//   - a human label
//   - the entities it targets (resolved to short labels via the local map)
//   - the value if dimensional (radius/angle/distance/...)
//   - a delete button
//
// Editing the numeric value is a quick double-click → prompt → emit. Future
// work: inline editing with proper keyboard handling instead of window.prompt.

const ICON: Record<ConstraintType, string> = {
  coincident: 'cad-coincident',
  fixed: 'cad-fixed',
  horizontal: 'cad-horizontal',
  vertical: 'cad-vertical',
  distance: 'cad-horizontal-distance',
  perpendicular: 'cad-perpendicular',
  parallel: 'cad-parallel',
  tangent: 'cad-tangent',
  equal: 'cad-equal',
  symmetric: 'cad-symmetric',
  midpoint: 'cad-midpoint',
  concentric: 'cad-concentric',
  coradial: 'cad-coradial',
  collinear: 'cad-collinear',
  radius: 'cad-radius',
  diameter: 'cad-diameter',
  angle: 'cad-angle',
  'horizontal-distance': 'cad-horizontal-distance',
  'vertical-distance': 'cad-vertical-distance',
  'point-line-distance': 'cad-point-line-distance',
  'arc-length': 'cad-arc-length',
  'chord-distance': 'cad-chord-distance',
  'on-edge': 'cad-convert',
};

const LABEL: Record<ConstraintType, string> = {
  coincident: 'Coincident',
  fixed: 'Fix',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  distance: 'Distance',
  perpendicular: 'Perpendicular',
  parallel: 'Parallel',
  tangent: 'Tangent',
  equal: 'Equal',
  symmetric: 'Symmetric',
  midpoint: 'Midpoint',
  concentric: 'Concentric',
  coradial: 'Coradial',
  collinear: 'Collinear',
  radius: 'Radius',
  diameter: 'Diameter',
  angle: 'Angle',
  'horizontal-distance': 'Δx',
  'vertical-distance': 'Δy',
  'point-line-distance': 'Pt-line dist',
  'arc-length': 'Arc length',
  'chord-distance': 'Chord',
  'on-edge': 'On Edge',
};

// Dimensional constraint types. The list panel formats their values for
// display and lets the user edit them in place.
const HAS_VALUE = new Set<ConstraintType>([
  'distance', 'radius', 'diameter', 'angle',
  'horizontal-distance', 'vertical-distance', 'point-line-distance', 'arc-length',
  'chord-distance',
]);

interface ConstraintRow {
  id: string;
  type: ConstraintType;
  icon: string;
  label: string;
  targets: string[];      // short, user-facing entity labels
  value: string | null;   // formatted value or null when geometric
  raw: SketchConstraint;
}

@Component({
  selector: 'app-cad-constraint-list',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="panel" data-testid="constraint-list">
      <header>
        <mat-icon>rule</mat-icon>
        <span class="title">Constraints</span>
        <span class="count">{{ rows().length }}</span>
      </header>
      <ul *ngIf="rows().length; else emptyTpl">
        <li *ngFor="let r of rows(); trackBy: trackById"
            class="row"
            [class.selected]="r.id === selectedId()"
            [attr.data-testid]="'constraint-row-' + r.id"
            (click)="onSelectRow(r)">
          <mat-icon class="row-icon" [svgIcon]="r.icon"></mat-icon>
          <span class="row-body">
            <span class="row-label">{{ r.label }}</span>
            <span class="row-targets">{{ r.targets.join(' · ') }}</span>
          </span>
          <button *ngIf="r.value !== null"
                  class="value-btn"
                  [attr.data-testid]="'constraint-value-' + r.id"
                  (click)="onEditValue(r); $event.stopPropagation()"
                  matTooltip="Click to edit">{{ r.value }}</button>
          <button class="delete-btn"
                  [attr.data-testid]="'constraint-delete-' + r.id"
                  (click)="onDelete(r); $event.stopPropagation()"
                  matTooltip="Remove">
            <mat-icon>close</mat-icon>
          </button>
        </li>
      </ul>
      <ng-template #emptyTpl>
        <p class="empty">No constraints in this sketch.</p>
      </ng-template>
    </div>
  `,
  styles: [`
    .panel { display: flex; flex-direction: column; height: 100%; background: #2a2a3e; color: #e0e0e0; font-size: 12px; }
    header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #444; font-weight: 600; }
    header mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .title { flex: 1; }
    .count { opacity: 0.6; font-family: monospace; }
    ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
    .row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); cursor: pointer; border-left: 3px solid transparent; }
    .row:hover { background: rgba(255, 255, 255, 0.04); }
    .row.selected { background: rgba(66, 165, 245, 0.18); border-left-color: #42a5f5; }
    .row-icon { font-size: 18px; width: 18px; height: 18px; opacity: 0.85; flex-shrink: 0; }
    .row-body { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .row-label { font-weight: 500; }
    .row-targets { font-size: 11px; opacity: 0.55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .value-btn { background: rgba(66, 165, 245, 0.18); border: 1px solid rgba(66, 165, 245, 0.4); color: #90caf9; padding: 2px 8px; border-radius: 3px; font-family: monospace; cursor: pointer; }
    .value-btn:hover { background: rgba(66, 165, 245, 0.3); }
    .delete-btn { background: none; border: none; color: #ef5350; cursor: pointer; padding: 2px; display: inline-flex; align-items: center; justify-content: center; opacity: 0.5; }
    .delete-btn:hover { opacity: 1; }
    .delete-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .empty { padding: 12px 10px; opacity: 0.55; font-style: italic; margin: 0; }
  `],
})
export class CadConstraintListComponent {
  constraints = input<SketchConstraint[]>([]);
  entities = input<SketchEntity[]>([]);
  defaultUnit = input<Unit>('mm');
  /** Currently-selected constraint id — when set, the matching row in this
   * panel gets a blue highlight bar. Parent owns selection state. */
  selectedId = input<string | null>(null);

  remove = output<string>();
  edit = output<{ id: string; value: number; unit: Unit | null }>();
  select = output<string>();

  constructor() {
    // Register custom CAD icons. Idempotent — already registered if
    // the sketch editor has been opened in the same session.
    registerCadIcons(inject(MatIconRegistry), inject(DomSanitizer));
  }

  rows = computed<ConstraintRow[]>(() => {
    const entMap = new Map(this.entities().map(e => [e.id, e]));
    const defUnit = this.defaultUnit();
    // Hide chain-internal duplicates (offset chain emits redundant
    // dims with shared chainId for solver completeness; the user
    // only wants ONE row per chain). Show every constraint that's
    // either non-chain or the chain's "primary" entry — primary =
    // dimensional with `placement`, geometric without `placement`.
    const seenChains = new Set<string>();
    return this.constraints().filter(c => {
      if (!c.chainId) return true;
      // For dimensional constraints in a chain, only the one with
      // placement renders. For geometric (parallel, concentric, etc.)
      // in a chain, only the first per chainId renders.
      if (c.placement) return true;
      if (c.value !== undefined) return false;  // dim without placement → hidden
      if (seenChains.has(c.chainId)) return false;
      seenChains.add(c.chainId);
      return true;
    }).map(c => {
      const targetLabels = c.targets.map(t => labelForEntity(entMap.get(t.entityId), t.entityId));
      const value = formatValue(c, defUnit);
      return {
        id: c.id,
        type: c.type,
        icon: ICON[c.type] || 'cad-fixed',
        label: LABEL[c.type] || c.type,
        targets: targetLabels,
        value,
        raw: c,
      };
    });
  });

  trackById = (_: number, r: ConstraintRow) => r.id;

  onDelete(r: ConstraintRow) {
    this.remove.emit(r.id);
  }

  onSelectRow(r: ConstraintRow) {
    this.select.emit(r.id);
  }

  onEditValue(r: ConstraintRow) {
    if (!HAS_VALUE.has(r.type)) return;
    const isAngle = r.type === 'angle';
    const current = r.raw.value ?? 0;
    const defUnit = this.defaultUnit();
    let display: string;
    if (isAngle) {
      display = formatNumber(current * 180 / Math.PI);
    } else {
      const u: Unit = r.raw.unit ?? defUnit;
      display = `${formatNumber(fromMm(current, u))} ${unitSymbol(u)}`;
    }
    const promptLabel = isAngle ? `${r.label} (degrees):` : `${r.label} (default ${defUnit}; suffix with mm/um/in to override):`;
    const raw = window.prompt(promptLabel, display);
    if (raw === null) return;
    if (isAngle) {
      const parsed = parseFloat(raw);
      if (!isFinite(parsed)) return;
      this.edit.emit({ id: r.id, value: parsed * Math.PI / 180, unit: null });
      return;
    }
    const parsed = parseUserValue(raw, defUnit);
    if (!parsed) return;
    this.edit.emit({ id: r.id, value: parsed.valueMm, unit: parsed.unit });
  }
}

function labelForEntity(e: SketchEntity | undefined, id: string): string {
  if (!e) return id.slice(0, 6);
  switch (e.kind) {
    case 'point': return `pt(${formatNumber(e.x, 1)}, ${formatNumber(e.y, 1)})`;
    case 'line': return 'line';
    case 'circle': return `circle r=${formatNumber(e.radius, 2)}`;
    case 'arc': return `arc r=${formatNumber(e.radius, 2)}`;
    case 'ellipse': return 'ellipse';
    case 'spline': return 'spline';
    default: return e.kind;
  }
}

function formatValue(c: SketchConstraint, defaultUnit: Unit): string | null {
  if (!HAS_VALUE.has(c.type) || c.value === undefined) return null;
  if (c.type === 'angle') return formatNumber(c.value * 180 / Math.PI, 2) + '°';
  const u: Unit = (c.unit as Unit | undefined) ?? defaultUnit;
  // Always include the unit suffix — every length dim reads as a complete
  // value (e.g. "10 mm" / "0.5 in") so nothing in the panel is ambiguous.
  return `${formatNumber(fromMm(c.value, u))} ${unitSymbol(u)}`;
}
