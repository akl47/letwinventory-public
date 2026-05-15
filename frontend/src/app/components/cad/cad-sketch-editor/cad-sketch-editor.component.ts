import { Component, input, output, signal, computed, effect, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type {
  SketchDocument, SketchState, PointEntity, LineEntity, CircleEntity, ArcEntity, SketchEntity,
  ConstraintType,
} from '../../../cad/lib/types';
import { pointsOf, linesOf, findPoint } from '../../../cad/lib/types';
import {
  addPoint, addLine, addCircle, addArc, addConstraint, movePoint, deletePrimitive, emptySketchState,
} from '../../../cad/lib/store';
import { solveSketch } from '../../../cad/lib/solver';
import { extractClosedLoops } from '../../../cad/lib/profile';
import { pickEntity } from '../../../cad/lib/picking';

type Tool = 'select' | 'point' | 'line' | 'circle' | 'arc';
type PendingPoint = { x: number; y: number };

interface ConstraintSpec {
  type: ConstraintType;
  label: string;
  icon: string;
  // Predicate over an ordered selection — must return true for the constraint
  // button to enable. The order of selection is preserved into the targets array
  // unless the constraint type explicitly re-orders in `apply`.
  predicate: (entities: SketchEntity[]) => boolean;
  requiresValue?: boolean;
}

const CURVE_KINDS = new Set<SketchEntity['kind']>(['circle', 'arc', 'ellipse', 'ellipticalArc']);
const isLineEntity = (e: SketchEntity) => e.kind === 'line';
const isPointEntity = (e: SketchEntity) => e.kind === 'point';
const isCurveEntity = (e: SketchEntity) => CURVE_KINDS.has(e.kind);

const CONSTRAINT_SPECS: ConstraintSpec[] = [
  { type: 'fixed', label: 'Fix', icon: 'lock',
    predicate: es => es.length === 1 && isPointEntity(es[0]) },
  { type: 'coincident', label: 'Coincident', icon: 'merge_type',
    predicate: es => es.length === 2 && es.every(isPointEntity) },
  { type: 'horizontal', label: 'Horizontal', icon: 'horizontal_rule',
    predicate: es => es.length === 1 && isLineEntity(es[0]) },
  { type: 'vertical', label: 'Vertical', icon: 'unfold_more',
    predicate: es => es.length === 1 && isLineEntity(es[0]) },
  { type: 'distance', label: 'Distance', icon: 'straighten', requiresValue: true,
    predicate: es => es.length === 2 && es.every(isPointEntity) },
  { type: 'point-on-line', label: 'Point on line', icon: 'south_east',
    predicate: es => es.length === 2 && es.some(isPointEntity) && es.some(isLineEntity) },
  { type: 'perpendicular', label: 'Perpendicular', icon: 'turn_right',
    predicate: es => es.length === 2 && es.every(isLineEntity) },
  { type: 'parallel', label: 'Parallel', icon: 'drag_handle',
    predicate: es => es.length === 2 && es.every(isLineEntity) },
  { type: 'tangent', label: 'Tangent', icon: 'timeline',
    predicate: es => {
      if (es.length !== 2) return false;
      const lines = es.filter(isLineEntity).length;
      const curves = es.filter(isCurveEntity).length;
      return (lines === 1 && curves === 1) || (lines === 0 && curves === 2);
    } },
  { type: 'equal', label: 'Equal', icon: 'compare_arrows',
    predicate: es => {
      if (es.length !== 2) return false;
      const allLines = es.every(isLineEntity);
      const allCurves = es.every(e => e.kind === 'circle' || e.kind === 'arc');
      return allLines || allCurves;
    } },
  { type: 'midpoint', label: 'Midpoint', icon: 'vertical_align_center',
    predicate: es => es.length === 2 && es.some(isPointEntity) && es.some(isLineEntity) },
  { type: 'symmetric', label: 'Symmetric', icon: 'flip',
    predicate: es => es.length === 3 &&
      es.filter(isPointEntity).length === 2 && es.filter(isLineEntity).length === 1 },
  { type: 'concentric', label: 'Concentric', icon: 'adjust',
    predicate: es => es.length === 2 && es.every(e => e.kind === 'circle' || e.kind === 'arc') },
  { type: 'collinear', label: 'Collinear', icon: 'linear_scale',
    predicate: es => es.length === 2 && es.every(isLineEntity) },
];

// Some constraints need a specific target order regardless of click order.
function orderTargetsForConstraint(type: ConstraintType, entities: SketchEntity[]): string[] {
  switch (type) {
    case 'point-on-line':
    case 'midpoint':
      // [point, line]
      return [...entities].sort((a, b) => (isPointEntity(a) ? -1 : 1) - (isPointEntity(b) ? -1 : 1))
        .map(e => e.id);
    case 'symmetric':
      // [point, point, line]
      return [...entities].sort((a, b) => (isPointEntity(a) ? -1 : 1) - (isPointEntity(b) ? -1 : 1))
        .map(e => e.id);
    default:
      return entities.map(e => e.id);
  }
}

@Component({
  selector: 'app-cad-sketch-editor',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="sketch-toolbar" data-testid="sketch-toolbar">
      <button class="ribbon-button" data-testid="tool-select" [class.active]="tool() === 'select'" (click)="setTool('select')" matTooltip="Select">
        <mat-icon>arrow_selector_tool</mat-icon>
        <span class="ribbon-label">Select</span>
      </button>
      <button class="ribbon-button" data-testid="tool-point" [class.active]="tool() === 'point'" (click)="setTool('point')" matTooltip="Point" [disabled]="readonly()">
        <mat-icon>radio_button_unchecked</mat-icon>
        <span class="ribbon-label">Point</span>
      </button>
      <button class="ribbon-button" data-testid="tool-line" [class.active]="tool() === 'line'" (click)="setTool('line')" matTooltip="Line" [disabled]="readonly()">
        <mat-icon>show_chart</mat-icon>
        <span class="ribbon-label">Line</span>
      </button>
      <button class="ribbon-button" data-testid="tool-circle" [class.active]="tool() === 'circle'" (click)="setTool('circle')" matTooltip="Circle (center + radius)" [disabled]="readonly()">
        <mat-icon>circle</mat-icon>
        <span class="ribbon-label">Circle</span>
      </button>
      <button class="ribbon-button" data-testid="tool-arc" [class.active]="tool() === 'arc'" (click)="setTool('arc')" matTooltip="Arc (center + endpoints)" [disabled]="readonly()">
        <mat-icon>roundabout_right</mat-icon>
        <span class="ribbon-label">Arc</span>
      </button>
      <span class="ribbon-divider"></span>
      <button *ngFor="let spec of constraintSpecs"
              class="ribbon-button compact"
              [attr.data-testid]="'constraint-' + spec.type"
              [disabled]="readonly() || !spec.predicate(selectedEntities())"
              (click)="applyConstraint(spec)"
              [matTooltip]="spec.label">
        <mat-icon>{{ spec.icon }}</mat-icon>
      </button>
      <span class="ribbon-divider"></span>
      <span class="status">
        {{ pointCount() }} pts · {{ lineCount() }} lns · DOF {{ dof() }}
      </span>
      <span class="spacer"></span>
      <button class="ribbon-button"
              data-testid="extrude-button"
              *ngIf="canExtrude()"
              [disabled]="readonly()"
              (click)="extrudeRequested.emit()">
        <mat-icon>vertical_align_top</mat-icon>
        <span class="ribbon-label">Extrude</span>
      </button>
    </div>
  `,
  styles: [`
    /* Sketch toolbar lives inside the parent ribbon's ribbon-pane — the
       parent supplies the 76px fixed height. Styles below mirror the parent's
       ribbon-button class because component view encapsulation prevents shared
       CSS from reaching this template. */
    .sketch-toolbar { display: flex; align-items: stretch; gap: 4px; width: 100%; min-width: max-content; }
    .ribbon-divider { width: 1px; align-self: stretch; background: #444; margin: 8px 6px; flex-shrink: 0; }
    .status { font-size: 11px; opacity: 0.7; font-family: monospace; align-self: center; padding: 0 6px; white-space: nowrap; }
    .spacer { flex: 1; }
    .ribbon-button {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 64px;
      padding: 4px 2px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      color: #ddd;
      cursor: pointer;
      gap: 2px;
      font-family: inherit;
      flex-shrink: 0;
    }
    .ribbon-button.compact { width: 40px; }
    .ribbon-button mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .ribbon-button.compact mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .ribbon-button .ribbon-label { font-size: 10px; line-height: 1.1; text-align: center; opacity: 0.9; }
    .ribbon-button:hover:not([disabled]) { background: rgba(255,255,255,0.08); }
    .ribbon-button.active { background: rgba(66, 165, 245, 0.22); border-color: #42a5f5; }
    .ribbon-button[disabled] { opacity: 0.35; cursor: not-allowed; }
  `],
})
export class CadSketchEditorComponent implements OnDestroy {
  sketchId = input.required<string>();
  doc = input.required<SketchDocument>();
  readonly = input<boolean>(false);
  sketchChanged = output<SketchState>();
  exitSketch = output<void>();
  extrudeRequested = output<void>();

  readonly constraintSpecs = CONSTRAINT_SPECS;

  tool = signal<Tool>('select');
  cursor = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  draftLineStart = signal<string | null>(null);
  draftCircleCenter = signal<PendingPoint | null>(null);
  draftArcCenter = signal<PendingPoint | null>(null);
  draftArcStart = signal<PendingPoint | null>(null);
  selected = signal<Set<string>>(new Set());

  // Drag-to-move state (REQ 613). Set on mousedown over a draggable point. The
  // `isDragging` flag stays false until the cursor moves more than DRAG_THRESHOLD
  // sketch units, so a stationary click still resolves as a selection.
  private dragState = signal<{
    pointId: string;
    startCursor: { x: number; y: number };
    startPoint: { x: number; y: number };
    isDragging: boolean;
  } | null>(null);
  // Set true on mouseup at the end of a drag so the subsequent (click) event is suppressed.
  private didDrag = false;

  // REQ 629 — parent inspects this to decide whether to apply snap to incoming
  // pointer-move events. Snap during drag would yank the dragged point onto
  // every nearby vertex, which is more noise than help.
  isDragging(): boolean {
    return !!this.dragState()?.isDragging;
  }

  state = computed<SketchState>(() => this.doc().sketches[this.sketchId()]?.state ?? emptySketchState());

  points = computed<PointEntity[]>(() => pointsOf(this.state()));
  lines = computed<LineEntity[]>(() => linesOf(this.state()));
  circles = computed<CircleEntity[]>(() =>
    this.state().entities.filter((e): e is CircleEntity => e.kind === 'circle'),
  );
  arcs = computed<ArcEntity[]>(() =>
    this.state().entities.filter((e): e is ArcEntity => e.kind === 'arc'),
  );
  pointCount = computed(() => this.points().filter(p => !p.construction).length);
  lineCount = computed(() => this.lines().filter(l => !l.construction).length);
  dof = computed(() => Math.max(0, this.pointCount() * 2 - this.state().constraints.length));

  // Selected entities resolved in click order. Constraint predicates run on this.
  selectedEntities = computed<SketchEntity[]>(() => {
    const ids = Array.from(this.selected());
    const map = new Map(this.state().entities.map(e => [e.id, e]));
    return ids.map(id => map.get(id)).filter((e): e is SketchEntity => !!e);
  });

  draftArcRadius = computed<number | null>(() => {
    const c = this.draftArcCenter(), s = this.draftArcStart();
    return c && s ? Math.hypot(s.x - c.x, s.y - c.y) : null;
  });

  canExtrude = computed(() => {
    return extractClosedLoops(this.state()).loops.length > 0;
  });

  private latestCommitId = 0;
  // Tracks insertion order for the selection Set (Sets preserve insertion order
  // when entries aren't deleted-and-readded, which is what `setSelection` does).
  private readonly clearDraftsForTool = new Map<Tool, () => void>([
    ['select', () => { this.clearAllDrafts(); }],
    ['point', () => { this.clearAllDrafts(); }],
    ['line', () => { this.draftCircleCenter.set(null); this.draftArcCenter.set(null); this.draftArcStart.set(null); }],
    ['circle', () => { this.draftLineStart.set(null); this.draftArcCenter.set(null); this.draftArcStart.set(null); }],
    ['arc', () => { this.draftLineStart.set(null); this.draftCircleCenter.set(null); }],
  ]);

  constructor() {
    effect(() => {
      const tool = this.tool();
      this.clearDraftsForTool.get(tool)?.();
      // Selection only makes sense in the select tool — clear it on tool change.
      if (tool !== 'select') this.selected.set(new Set());
    });
  }

  ngOnDestroy() { this.clearAllDrafts(); this.selected.set(new Set()); }

  setTool(t: Tool) { this.tool.set(t); }

  // REQ 632 / 633 — single document-level keydown listener so we can both
  // (a) ignore the keystroke when the user is typing in a text input and
  // (b) suppress the browser's Backspace-back navigation when the sketcher
  // consumes the key.
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(ev: KeyboardEvent) {
    const target = ev.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;

    if (ev.key === 'Escape') {
      // REQ 633 — Esc cancels any in-flight tool gesture, clears the
      // selection, and returns to the Select tool.
      this.clearAllDrafts();
      this.selected.set(new Set());
      this.dragState.set(null);
      this.tool.set('select');
      return;
    }

    if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.selected().size > 0) {
      // REQ 632 — Delete / Backspace removes every selected sketch entity.
      if (this.readonly()) return;
      ev.preventDefault();  // also stops Backspace from triggering browser-back
      this.deleteSelected();
    }
  }

  private deleteSelected() {
    let state = this.state();
    for (const id of this.selected()) {
      state = deletePrimitive(state, id);
    }
    this.selected.set(new Set());
    this.dragState.set(null);
    this.commit(state);
  }

  private clearAllDrafts() {
    this.draftLineStart.set(null);
    this.draftCircleCenter.set(null);
    this.draftArcCenter.set(null);
    this.draftArcStart.set(null);
  }

  strokeFor(e: SketchEntity): string {
    if (this.selected().has(e.id)) return '#ffb74d';
    if (e.construction) return '#888';
    return '#42a5f5';
  }

  ptX(id: string): number { return findPoint(this.state(), id)?.x ?? 0; }
  ptY(id: string): number { return findPoint(this.state(), id)?.y ?? 0; }

  arcPath(a: ArcEntity): string {
    const s = findPoint(this.state(), a.startId);
    const e = findPoint(this.state(), a.endId);
    if (!s || !e) return '';
    // SVG sweep flag is in *screen* coords. Our display flips Y, so a CCW arc in
    // sketch space (ccw=true) draws with sweep-flag=0 in screen space.
    const sweepFlag = a.ccw ? 0 : 1;
    const largeArc = this.isLargeArc(a) ? 1 : 0;
    return `M ${s.x} ${-s.y} A ${a.radius} ${a.radius} 0 ${largeArc} ${sweepFlag} ${e.x} ${-e.y}`;
  }

  private isLargeArc(a: ArcEntity): boolean {
    const c = findPoint(this.state(), a.centerId);
    const s = findPoint(this.state(), a.startId);
    const e = findPoint(this.state(), a.endId);
    if (!c || !s || !e) return false;
    const startAngle = Math.atan2(s.y - c.y, s.x - c.x);
    const endAngle = Math.atan2(e.y - c.y, e.x - c.x);
    let sweep = endAngle - startAngle;
    if (a.ccw) {
      while (sweep <= 0) sweep += Math.PI * 2;
    } else {
      while (sweep >= 0) sweep -= Math.PI * 2;
    }
    return Math.abs(sweep) > Math.PI;
  }

  // REQ 616 — pointer events now arrive from the 3D viewer with pre-projected
  // 2D plane coords. The parent component (cad-editor) wires the viewer's
  // sketchClick / sketchPointerDown / sketchPointerMove / sketchPointerUp
  // outputs into these public methods.

  handleSketchClick(p: { x: number; y: number; shiftKey: boolean }) {
    if (this.readonly()) return;
    if (this.didDrag) { this.didDrag = false; return; }
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const tool = this.tool();
    if (tool === 'select') {
      this.handleSelectClick(x, y, p.shiftKey);
    } else if (tool === 'point') {
      this.commit(addPoint(this.state(), x, y).state);
    } else if (tool === 'line') {
      this.handleLineClick(x, y);
    } else if (tool === 'circle') {
      this.handleCircleClick(x, y);
    } else if (tool === 'arc') {
      this.handleArcClick(x, y);
    }
  }

  // REQ 613: drag-to-move for non-construction points in the Select tool.
  // pointerDown picks the entity; drag engages after the cursor moves more
  // than DRAG_THRESHOLD sketch units.
  handleSketchPointerDown(p: { x: number; y: number }) {
    if (this.readonly()) return;
    if (this.tool() !== 'select') return;
    const picked = pickEntity(this.state(), p, 3);
    if (!picked || picked.kind !== 'point' || picked.construction) return;
    const point = findPoint(this.state(), picked.id);
    if (!point) return;
    this.dragState.set({
      pointId: picked.id,
      startCursor: p,
      startPoint: { x: point.x, y: point.y },
      isDragging: false,
    });
  }

  handleSketchPointerMove(p: { x: number; y: number }) {
    const drag = this.dragState();
    if (!drag) return;
    const dx = p.x - drag.startCursor.x;
    const dy = p.y - drag.startCursor.y;
    const DRAG_THRESHOLD = 1;
    if (!drag.isDragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      this.dragState.set({ ...drag, isDragging: true });
    }
    const newX = Math.round(drag.startPoint.x + dx);
    const newY = Math.round(drag.startPoint.y + dy);
    // Preview update: emit moved state immediately, defer the solver to pointerUp.
    const next = movePoint(this.state(), drag.pointId, newX, newY);
    this.sketchChanged.emit(next);
  }

  handleSketchPointerUp(p: { x: number; y: number }) {
    const drag = this.dragState();
    this.dragState.set(null);
    if (!drag || !drag.isDragging) return;
    this.didDrag = true;
    const dx = p.x - drag.startCursor.x;
    const dy = p.y - drag.startCursor.y;
    const newX = Math.round(drag.startPoint.x + dx);
    const newY = Math.round(drag.startPoint.y + dy);
    this.commit(movePoint(this.state(), drag.pointId, newX, newY));
  }

  private handleSelectClick(x: number, y: number, additive: boolean) {
    const picked = pickEntity(this.state(), { x, y }, 3);
    if (!picked) {
      if (!additive) this.selected.set(new Set());
      return;
    }
    const next = new Set(additive ? this.selected() : []);
    if (next.has(picked.id)) next.delete(picked.id);
    else next.add(picked.id);
    this.selected.set(next);
  }

  private handleLineClick(x: number, y: number) {
    const start = this.draftLineStart();
    if (!start) {
      const r = addPoint(this.state(), x, y);
      this.commit(r.state);
      this.draftLineStart.set(r.id);
      return;
    }
    const existing = this.findNearbyPoint(x, y);
    let s = this.state();
    let endId: string;
    if (existing) {
      endId = existing.id;
    } else {
      const r = addPoint(s, x, y);
      s = r.state;
      endId = r.id;
    }
    const ln = addLine(s, start, endId);
    this.commit(ln.state);
    this.draftLineStart.set(existing ? null : endId);
    // If we closed the loop (clicked the very first point), stop the chain.
    if (existing && existing.id === start) this.draftLineStart.set(null);
  }

  private handleCircleClick(x: number, y: number) {
    const center = this.draftCircleCenter();
    if (!center) {
      this.draftCircleCenter.set({ x, y });
      return;
    }
    const radius = Math.hypot(x - center.x, y - center.y);
    if (radius < 0.5) return;  // ignore second click on top of first
    this.commit(addCircle(this.state(), center.x, center.y, radius).state);
    this.draftCircleCenter.set(null);
  }

  private handleArcClick(x: number, y: number) {
    const center = this.draftArcCenter();
    if (!center) {
      this.draftArcCenter.set({ x, y });
      return;
    }
    const start = this.draftArcStart();
    if (!start) {
      if (Math.hypot(x - center.x, y - center.y) < 0.5) return;
      this.draftArcStart.set({ x, y });
      return;
    }
    // Choose ccw=true when the (start → end) sweep around the center is positive.
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const endAngle = Math.atan2(y - center.y, x - center.x);
    let delta = endAngle - startAngle;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    const ccw = delta >= 0;
    this.commit(addArc(this.state(), center.x, center.y, start.x, start.y, x, y, ccw).state);
    this.draftArcCenter.set(null);
    this.draftArcStart.set(null);
  }

  applyConstraint(spec: ConstraintSpec) {
    if (this.readonly()) return;
    const entities = this.selectedEntities();
    if (!spec.predicate(entities)) return;
    let value: number | undefined;
    if (spec.requiresValue) {
      const raw = window.prompt(`Enter value for ${spec.label}:`, '10');
      if (raw === null) return;
      const parsed = parseFloat(raw);
      if (!isFinite(parsed)) return;
      value = parsed;
    }
    const ordered = orderTargetsForConstraint(spec.type, entities);
    const { state: next } = addConstraint(this.state(), spec.type, ordered, value);
    this.commit(next);
    this.selected.set(new Set());
  }

  private findNearbyPoint(x: number, y: number): PointEntity | undefined {
    return this.points().find(p => Math.hypot(p.x - x, p.y - y) < 4);
  }

  private async commit(next: SketchState) {
    const id = ++this.latestCommitId;
    this.sketchChanged.emit(next);
    const result = await solveSketch(next);
    if (id !== this.latestCommitId) return;
    if (result.status === 'ok') {
      this.sketchChanged.emit(result.state);
    }
  }
}
