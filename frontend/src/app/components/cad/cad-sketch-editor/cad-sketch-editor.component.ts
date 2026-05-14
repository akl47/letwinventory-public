import { Component, input, output, signal, computed, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type {
  SketchDocument, SketchState, PointEntity, LineEntity, CircleEntity, ArcEntity, SketchEntity,
} from '../../../cad/lib/types';
import { pointsOf, linesOf, findPoint } from '../../../cad/lib/types';
import { addPoint, addLine, emptySketchState } from '../../../cad/lib/store';
import { solveSketch } from '../../../cad/lib/solver';
import { extractClosedLoop } from '../../../cad/lib/profile';

type Tool = 'select' | 'point' | 'line';

@Component({
  selector: 'app-cad-sketch-editor',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="sketch-editor">
      <header class="sketch-toolbar" data-testid="sketch-toolbar">
        <button mat-icon-button data-testid="tool-select" [class.active]="tool() === 'select'" (click)="setTool('select')" matTooltip="Select">
          <mat-icon>arrow_selector_tool</mat-icon>
        </button>
        <button mat-icon-button data-testid="tool-point" [class.active]="tool() === 'point'" (click)="setTool('point')" matTooltip="Point" [disabled]="readonly()">
          <mat-icon>radio_button_unchecked</mat-icon>
        </button>
        <button mat-icon-button data-testid="tool-line" [class.active]="tool() === 'line'" (click)="setTool('line')" matTooltip="Line" [disabled]="readonly()">
          <mat-icon>show_chart</mat-icon>
        </button>
        <span class="divider"></span>
        <span class="status">
          {{ pointCount() }} points, {{ lineCount() }} lines · DOF {{ dof() }}
        </span>
        <span class="spacer"></span>
        <button mat-stroked-button
                data-testid="extrude-button"
                *ngIf="canExtrude()"
                [disabled]="readonly()"
                (click)="extrudeRequested.emit()">
          <mat-icon>vertical_align_top</mat-icon> Extrude…
        </button>
        <button mat-stroked-button data-testid="exit-sketch" (click)="exitSketch.emit()">
          Exit sketch → 3D View
        </button>
      </header>

      <svg
        #canvas
        data-testid="sketch-canvas"
        class="sketch-canvas"
        viewBox="-100 -100 200 200"
        (click)="onCanvasClick($event)">

        <defs>
          <pattern id="sketch-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#2a2a3a" stroke-width="0.3"/>
          </pattern>
        </defs>
        <rect x="-100" y="-100" width="200" height="200" fill="url(#sketch-grid)"/>
        <line x1="-100" y1="0" x2="100" y2="0" stroke="#666" stroke-width="0.5" stroke-dasharray="2 2"/>
        <line x1="0" y1="-100" x2="0" y2="100" stroke="#666" stroke-width="0.5" stroke-dasharray="2 2"/>

        <!-- lines -->
        <g *ngFor="let l of lines()">
          <line
            [attr.x1]="ptX(l.startId)"
            [attr.y1]="-ptY(l.startId)"
            [attr.x2]="ptX(l.endId)"
            [attr.y2]="-ptY(l.endId)"
            [attr.stroke]="l.construction ? '#888' : '#42a5f5'"
            stroke-width="1.2"
            [attr.stroke-dasharray]="l.construction ? '3 2' : null"
          />
        </g>

        <!-- circles (REQ 563) — native SVG primitive for analytic fidelity -->
        <g *ngFor="let c of circles()">
          <circle
            [attr.cx]="ptX(c.centerId)"
            [attr.cy]="-ptY(c.centerId)"
            [attr.r]="c.radius"
            fill="none"
            [attr.stroke]="c.construction ? '#888' : '#42a5f5'"
            stroke-width="1.2"
            [attr.stroke-dasharray]="c.construction ? '3 2' : null"
          />
        </g>

        <!-- arcs (REQ 563) — SVG path with arc command, sweep mirrored for inverted Y -->
        <g *ngFor="let a of arcs()">
          <path
            [attr.d]="arcPath(a)"
            fill="none"
            [attr.stroke]="a.construction ? '#888' : '#42a5f5'"
            stroke-width="1.2"
            [attr.stroke-dasharray]="a.construction ? '3 2' : null"
          />
        </g>

        <!-- points -->
        <g *ngFor="let p of points()">
          <circle
            [attr.cx]="p.x"
            [attr.cy]="-p.y"
            r="1.5"
            [attr.fill]="p.construction ? '#888' : '#fff'"
            [attr.stroke]="p.construction ? '#888' : '#42a5f5'"
            stroke-width="0.5"
          />
        </g>

        <!-- draft line preview -->
        <line *ngIf="draftLineStart()"
              [attr.x1]="ptX(draftLineStart()!)"
              [attr.y1]="-ptY(draftLineStart()!)"
              [attr.x2]="cursor().x"
              [attr.y2]="-cursor().y"
              stroke="#42a5f5" stroke-dasharray="2 2" stroke-width="0.8"/>
      </svg>
    </div>
  `,
  styles: [`
    .sketch-editor { display: flex; flex-direction: column; height: 100%; }
    .sketch-toolbar { display: flex; align-items: center; gap: 4px; padding: 4px 8px; background: #2a2a3a; border-bottom: 1px solid #444; }
    .divider { width: 1px; height: 24px; background: #555; margin: 0 8px; }
    .status { font-size: 12px; opacity: 0.7; font-family: monospace; }
    .spacer { flex: 1; }
    button.active { background: rgba(66, 165, 245, 0.2); }
    .sketch-canvas { flex: 1; width: 100%; background: #14141e; cursor: crosshair; }
  `],
})
export class CadSketchEditorComponent implements OnDestroy {
  sketchId = input.required<string>();
  doc = input.required<SketchDocument>();
  readonly = input<boolean>(false);
  sketchChanged = output<SketchState>();
  exitSketch = output<void>();
  extrudeRequested = output<void>();

  tool = signal<Tool>('select');
  cursor = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  draftLineStart = signal<string | null>(null);

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

  canExtrude = computed(() => {
    const { loop } = extractClosedLoop(this.state());
    return loop !== null;
  });

  private latestCommitId = 0;

  constructor() {
    effect(() => {
      const tool = this.tool();
      if (tool !== 'line') this.draftLineStart.set(null);
    });
  }

  ngOnDestroy() { this.draftLineStart.set(null); }

  setTool(t: Tool) { this.tool.set(t); }

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

  onCanvasClick(ev: MouseEvent) {
    if (this.readonly()) return;
    const target = ev.target as SVGElement;
    const svg = (target.ownerSVGElement || target as unknown as SVGSVGElement);
    const pt = (svg as SVGSVGElement).createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const m = (svg as SVGGraphicsElement).getScreenCTM();
    if (!m) return;
    const local = pt.matrixTransform(m.inverse());
    const x = Math.round(local.x);
    const y = Math.round(-local.y);

    if (this.tool() === 'point') {
      this.commit(addPoint(this.state(), x, y).state);
    } else if (this.tool() === 'line') {
      const start = this.draftLineStart();
      if (!start) {
        const r = addPoint(this.state(), x, y);
        this.commit(r.state);
        this.draftLineStart.set(r.id);
      } else {
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
    }
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
