import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy,
  effect, input, output, signal, untracked, NgZone, inject, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import type { CadDefaultView } from '../../../models/cad-model.model';
import * as THREE from 'three';
// REQ 631 — Line2 supports a real linewidth (in pixels). Three.js's
// LineBasicMaterial is stuck at 1px on most WebGL implementations.
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// REQ 619 — display modes. The pure-shaded "no edges" mode isn't in the list;
// 'visible-edges' is the default (faces + visible edges, OnShape-like).
export type DisplayMode =
  | 'wireframe'
  | 'wireframe-hidden-dashed'
  | 'wireframe-no-hidden'
  | 'visible-edges'
  | 'all-edges'
  | 'hidden-dashed';

interface DisplayModeSpec {
  /** Whether face fragments write color (visible shaded faces). */
  facesShaded: boolean;
  /** Whether face fragments write depth (needed for HLR even when invisible). */
  facesDepth: boolean;
  /** Visible-edge layer (depthFunc = Less, solid). */
  showFrontEdges: boolean;
  /** Hidden-edge layer drawn solid (depthFunc = Greater, solid). */
  showHiddenSolid: boolean;
  /** Hidden-edge layer drawn dashed (depthFunc = Greater, dashed). */
  showHiddenDashed: boolean;
}

const DISPLAY_MODES: Record<DisplayMode, DisplayModeSpec> = {
  // Faces invisible, no depth → all edges pass the LessDepth test via the
  // front-edge layer alone.
  'wireframe':                { facesShaded: false, facesDepth: false, showFrontEdges: true,  showHiddenSolid: false, showHiddenDashed: false },
  'wireframe-hidden-dashed':  { facesShaded: false, facesDepth: true,  showFrontEdges: true,  showHiddenSolid: false, showHiddenDashed: true  },
  'wireframe-no-hidden':      { facesShaded: false, facesDepth: true,  showFrontEdges: true,  showHiddenSolid: false, showHiddenDashed: false },
  'visible-edges':            { facesShaded: true,  facesDepth: true,  showFrontEdges: true,  showHiddenSolid: false, showHiddenDashed: false },
  'all-edges':                { facesShaded: true,  facesDepth: true,  showFrontEdges: true,  showHiddenSolid: true,  showHiddenDashed: false },
  'hidden-dashed':            { facesShaded: true,  facesDepth: true,  showFrontEdges: true,  showHiddenSolid: false, showHiddenDashed: true  },
};
import type {
  ModelGeometry, ModelTopology, DatumElement, SketchDocument, Sketch, SketchEntity, Plane3,
  CircleEntity, ArcEntity, ReferenceCandidate,
} from '../../../cad/lib/types';
import { findPoint, isProjectedEntity } from '../../../cad/lib/types';
import { tessellateCircle, tessellateArc, tessellateEllipse, tessellateSpline, tessellateEntity } from '../../../cad/lib/tessellator';
import { dimensionRenders, type DimensionRender } from '../../../cad/lib/dimensions';
import { externalEdgeLinesFromCandidates } from '../../../cad/lib/externalSnap';
import { formatNumber, fromMm, unitSymbol, type Unit } from '../../../cad/lib/units';
import { constraintIconsForEntity, type ConstraintIcon, type ConstraintIconGroup } from '../../../cad/lib/constraintIcons';
import { tryGlyphLoopsForText, onFontReady, applyTextTransform } from '../../../cad/lib/textGlyphs';
import { singleLineStrokesForText } from '../../../cad/lib/singleLineFont';
import { exceedsDragThreshold, screenDeltaToWorld } from '../../../cad/lib/assemblyDrag';
import { WORLD_UP as WORLD_UP_AXIS, orbitDir, dirToOrbit } from '../../../cad/lib/viewAxis';
import { originPlaneLabel } from '../../../cad/lib/datum';

/** World up-axis for the 3D VIEW convention (Z-up, right-handed), as a Three
 *  vector for `camera.up.copy(...)`. View/camera only — NOT a geometry normal. */
const WORLD_UP = new THREE.Vector3(...WORLD_UP_AXIS);
import type { InContextOverlay, OverlayEdge, OverlayFace, OverlayVertex } from '../../../cad/lib/inContextOverlay';

// REQ 629 — drawing preview overlay. Each item is a transient shape rendered
// on top of the active sketch while the user is mid-gesture. The cad-editor
// builds these from the current tool, draft state, and snapped cursor.
export type SketchPreview =
  | { kind: 'line'; start: { x: number; y: number }; end: { x: number; y: number } }
  | { kind: 'circle'; center: { x: number; y: number }; radius: number }
  | { kind: 'arc'; center: { x: number; y: number }; start: { x: number; y: number }; end: { x: number; y: number }; radius: number; ccw: boolean }
  | { kind: 'point-marker'; x: number; y: number; style: 'cursor' | 'pending' }
  | { kind: 'snap-indicator'; x: number; y: number; snapKind?: 'endpoint' | 'midpoint' | 'intersection' | 'quadrant' | 'on-edge' | 'center' }
  // Edit-tool hover preview: shows what Trim/Extend would do under the
  // cursor without mutating state. `mode: 'remove'` renders solid red
  // (segment that would be cut away); `mode: 'add'` renders dashed red
  // (segment that would be added by an extension).
  | {
      kind: 'edit-hover';
      start: { x: number; y: number };
      end: { x: number; y: number };
      mode: 'remove' | 'add';
      /** When the segment is curved (arc / circle), supply a tessellated
       * polyline. The renderer draws this directly; start/end are
       * ignored. Straight-segment trims (lines) omit it. */
      points?: { x: number; y: number }[];
    }
  // Dashed alignment / polar guide — drawn in a muted yellow so it's
  // visibly different from the orange tool-draft previews. Used by the
  // inference engine to explain WHY the cursor snapped (polar ray from
  // start, horizontal/vertical from a remote point, etc).
  | { kind: 'alignment-guide'; start: { x: number; y: number }; end: { x: number; y: number } }
  // Small text label rendered near the cursor describing the active
  // inference ("horizontal", "30°", "aligned", "on line", …).
  | { kind: 'inference-badge'; x: number; y: number; label: string };

// Click-to-select profile region overlay used during the Extrude sidebar
// flow. The cad-editor computes one entry per closed loop in the host
// sketch (tessellated polygon already projected into world coords on the
// sketch plane). The viewer renders each as a translucent mesh, hit-tests
// clicks against the fill group, and reports back the loop index for the
// editor to toggle in extrudeSelectedLoops.
export interface ProfileFill {
  /** Region index in the extracted RegionsResult.regions array — matches
   * the index the editor stores in ExtrudeFeature.regionIndices. */
  index: number;
  /** Outer polygon vertices in world coordinates, already projected onto
   * the host sketch's plane. Last vertex does NOT repeat the first. */
  polygon3d: Array<[number, number, number]>;
  /** Inner-loop polygons (holes) for this region. Each hole is rendered
   * as a cutout in the triangulated fill — concentric circles produce
   * one donut-shaped fill via the outer region's `holePolygons3d`.
   * Empty for hole-less regions. */
  holePolygons3d?: Array<Array<[number, number, number]>>;
  /** Plane normal — used so the mesh can be lifted a hair off the sketch
   * plane to avoid Z-fighting against any other geometry sharing the
   * plane (e.g. sketch overlay lines, a face hosting the sketch). */
  normal: [number, number, number];
}

/** REQ 665 — cosmetic thread display, OnShape-style. One record per
 * tapped-hole placement. Drawn as a striped band pattern overlaid on
 * the inside cylindrical surface of the tap-drill cut — gives the
 * visual cue of threading without modeling the actual helix. The
 * cylinder sits just inside the drilled cut (slightly smaller radius
 * to avoid z-fighting) and the band frequency follows the thread
 * pitch. `axis` points INTO the body from `position`. */
export interface CosmeticThread {
  position: [number, number, number];
  axis: [number, number, number];
  /** Tap-drill Ø — the actual carved hole's diameter. The shell
   * sits at this diameter minus a tiny inset. */
  drillDiameter: number;
  /** Thread pitch (mm) — band spacing along the cylinder axis. */
  pitch: number;
  /** Requested length along `axis`. Treated as an UPPER bound when
   * `fitToBody` is true — the renderer raycasts against the body
   * and clips to the body's exit face if that's shorter. */
  depth: number;
  /** When true (through-all holes), the renderer probes the body
   * geometry along `axis` and clips the shell at the exit face.
   * False = use `depth` literally (blind holes). */
  fitToBody?: boolean;
}

/** REQ 663 — one preview cylinder/cone per planned hole. Dimensions
 * are already resolved (overrides applied); the viewer just draws
 * what it's given. `axis` points INTO the body, so the preview
 * extends from `position` in the +axis direction by the relevant
 * depth. */
export interface HolePreview {
  /** Hole center in world coords. */
  position: [number, number, number];
  /** Unit vector along the hole axis (into the body). */
  axis: [number, number, number];
  /** Drill cylinder Ø. */
  drillDiameter: number;
  /** Drill length along `axis`. */
  drillDepth: number;
  /** Optional counterbore cylinder at the entry surface. */
  counterbore?: { diameter: number; depth: number };
  /** Optional countersink cone at the entry surface. */
  countersink?: { diameter: number; depth: number };
}

// Zoom-adaptive sketch rendering. The viewer's orthographic frustum half-height
// equals `orbitDistance`, so on-screen size = worldSize / orbitDistance (× a
// viewport constant). Sizing geometry as `orbitDistance × fraction` therefore
// keeps a CONSTANT on-screen appearance regardless of zoom. Fractions are
// calibrated to match the old fixed sizes at the default orbitDistance (180).
const POINT_SCREEN_FRAC = 1.1 / 180;       // ≈ unselected sketch-point radius
const POINT_SCREEN_FRAC_SEL = 1.6 / 180;   // ≈ selected sketch-point radius
const CHORD_SCREEN_FRAC = 0.05 / 180;      // ≈ curve chord tolerance
const MIN_CHORD_TOL = 0.003;               // floor so segment count stays bounded
const DIM_ARROW_LEN_FRAC = 3 / 180;        // dimension arrowhead length (constant on-screen)
const DIM_ARROW_WIDTH_FRAC = 1 / 180;      // dimension arrowhead half-width

@Component({
  selector: 'app-cad-viewer',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="viewer" data-testid="cad-viewer">
      <!-- REQ 867 — box-selection marquee (window solid / crossing dashed). -->
      @if (marqueeSig(); as mq) {
        <div class="marquee" data-testid="box-select-marquee"
             [class.crossing]="mq.crossing"
             [style.left.px]="mq.left" [style.top.px]="mq.top"
             [style.width.px]="mq.width" [style.height.px]="mq.height"></div>
      }
      <div #mount class="canvas-mount"></div>
      <div class="webgl-error" *ngIf="webglUnavailable()" data-testid="webgl-error">
        <mat-icon>desktop_access_disabled</mat-icon>
        <div class="we-title">3D view unavailable</div>
        <div class="we-sub">The browser couldn't create a WebGL context — usually too many 3D views open this session, or hardware acceleration is off.</div>
        <div class="we-sub">Try reloading the view; if it keeps failing, fully quit and reopen your browser.</div>
        <button type="button" class="we-retry" (click)="retryWebgl()" data-testid="webgl-retry">
          <mat-icon>refresh</mat-icon> Reload 3D view
        </button>
      </div>
      <!-- 3D pick debug (mirrors the sketch editor's bottom-right overlay).
           Hidden in sketch mode — the 2D overlay owns that corner there. -->
      @if (debugVisible() && activeSketchId() === null) {
        <div class="pick-debug" data-testid="viewer-pick-debug">
          <div class="pick-debug-row build">build <b>{{ frontendBuild() }}</b> · kernel <b>{{ kernelBuild() || '—' }}</b></div>
          <div class="pick-debug-row sel">selection: <b>{{ selected() ? shortPickLabelPublic(selected()!) : '(none)' }}</b>{{ selectedFeatures().size ? ' · features ' + selectedFeatures().size : '' }}</div>
          @if (pickDebug(); as dp) {
            <div class="pick-debug-row">mode <b>{{ dp.modes }}</b> · depth cap {{ dp.cap }}</div>
            <div class="pick-debug-row">hover: <b>{{ hoveredEdgeId() || (hovered() ? shortPickLabelPublic(hovered()!) : '—') }}</b></div>
            <div class="pick-debug-sep">near cursor ({{ dp.items.length }}):</div>
            @for (it of dp.items; track $index) {
              <div class="pick-debug-item" [class.win]="it.winner">
                {{ it.kind }} · {{ it.label }} · d={{ it.dist }}
              </div>
            }
          }
        </div>
      }
      <div #cubeMount class="nav-cube" data-testid="nav-cube"
           (pointerdown)="onCubePointerDown($event)"
           (pointermove)="onCubePointerMove($event)"
           (pointerup)="onCubePointerUp($event)"
           (pointerleave)="onCubePointerUp($event)"
           (click)="onCubeClick($event)"></div>
      <!-- Onshape/Fusion-style 60° roll arcs hugging the cube's top corners. -->
      <button type="button" class="rot-btn rot-ccw"
              title="Rotate view 90° counter-clockwise" aria-label="Rotate counter-clockwise"
              (click)="rotateView(1)">
        <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M25.3 6.9 A26 26 0 0 0 6.4 27.5"/>
          <path d="M4.7 23.9 L6.4 27.5 L9.2 24.7"/>
        </svg>
      </button>
      <button type="button" class="rot-btn rot-cw"
              title="Rotate view 90° clockwise" aria-label="Rotate clockwise"
              (click)="rotateView(-1)">
        <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.7 6.9 A26 26 0 0 1 29.6 27.5"/>
          <path d="M31.3 23.9 L29.6 27.5 L26.8 24.7"/>
        </svg>
      </button>
      <!-- View controls beneath the orientation cube: nav modes + default view. -->
      <div class="view-controls">
        <button type="button" class="vc-btn" [class.on]="navMode()==='select'" title="Select (drag for box selection — left-to-right window, right-to-left crossing)" aria-label="Box select"
                data-testid="nav-select" (click)="setNav('select')"><mat-icon>highlight_alt</mat-icon></button>
        <button type="button" class="vc-btn" [class.on]="navMode()==='orbit'" title="Orbit (drag to rotate)" aria-label="Orbit"
                (click)="setNav('orbit')"><mat-icon>3d_rotation</mat-icon></button>
        <button type="button" class="vc-btn" [class.on]="navMode()==='pan'" title="Pan (drag to move)" aria-label="Pan"
                (click)="setNav('pan')"><mat-icon>open_with</mat-icon></button>
        <button type="button" class="vc-btn" [class.on]="navMode()==='zoom'" title="Zoom (drag up/down)" aria-label="Zoom"
                (click)="setNav('zoom')"><mat-icon>zoom_in</mat-icon></button>
        <button type="button" class="vc-btn" title="Zoom to fit" aria-label="Zoom to fit" data-testid="zoom-to-fit"
                (click)="zoomToFit()"><mat-icon>fit_screen</mat-icon></button>
        <button type="button" class="vc-btn" [disabled]="!normalToPlane() && activeSketchId() === null" data-testid="normal-to-view"
                [title]="activeSketchId() !== null ? 'Normal to sketch' : 'Normal to selected face / plane'" aria-label="Normal to selection"
                (click)="onNormalToClick()">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="9" width="11" height="11" rx="1"/><path d="M14 10l7-7"/><path d="M16 3h5v5"/>
          </svg>
        </button>
        <span class="vc-sep"></span>
        <button type="button" class="vc-btn" title="Default view" aria-label="Default view"
                (click)="applyDefaultView()">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9h5v-5h4v5h5v-9"/>
          </svg>
        </button>
        <button type="button" class="vc-btn" title="Save current as default view" aria-label="Save as default view"
                (click)="onSaveDefaultView()">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/>
          </svg>
        </button>
      </div>
      <div class="hud" *ngIf="loading()">
        <span class="spinner"></span>
        Regenerating geometry{{ loadProgress() ? ' — ' + loadProgress() : '…' }}
      </div>
    </div>
  `,
  styles: [`
    /* REQ 867 — box-selection marquee. Solid = window, dashed = crossing. */
    .marquee { position: absolute; z-index: 30; border: 1px solid #42a5f5; background: rgba(66, 165, 245, 0.08); pointer-events: none; }
    .marquee.crossing { border-style: dashed; border-color: #66bb6a; background: rgba(102, 187, 106, 0.08); }
    .viewer { position: relative; width: 100%; height: 100%; background: #1e1e2e; }
    .canvas-mount { width: 100%; height: 100%; }
    .canvas-mount canvas { display: block; }
    .webgl-error { position: absolute; inset: 0; z-index: 30; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 24px; text-align: center; color: #ef9a9a; }
    .webgl-error mat-icon { font-size: 44px; width: 44px; height: 44px; }
    .webgl-error .we-title { font-size: 17px; font-weight: 700; }
    .webgl-error .we-sub { font-size: 13px; color: #c9c9d6; max-width: 420px; }
    .webgl-error .we-retry { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 7px 16px; border: 1px solid #ef9a9a; border-radius: 6px; background: transparent; color: #ef9a9a; font-size: 14px; cursor: pointer; }
    .webgl-error .we-retry:hover { background: rgba(239,154,154,.12); }
    .webgl-error .we-retry mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .nav-cube { position: absolute; top: 12px; right: 62px; width: 103px; height: 103px; cursor: pointer; user-select: none; }
    .nav-cube canvas { display: block; }
    /* Centre the controls row on the nav cube's centre (cube: right 62px, width
       103px → centre at right 113.5px). translateX(50%) keeps it centred
       regardless of how many buttons the row holds. */
    .view-controls { position: absolute; top: 118px; right: calc(62px + 103px / 2); transform: translateX(50%);
                     display: flex; align-items: center; gap: 4px; }
    .vc-btn { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; padding: 0;
              background: rgba(42,42,58,0.92); border: 1px solid #3a3a4a; border-radius: 4px; color: #cfd2e0; cursor: pointer; }
    .vc-btn:hover { background: #34344a; color: #fff; border-color: #4a4a5e; }
    .vc-btn.on { background: #1976d2; border-color: #1976d2; color: #fff; }
    .vc-btn:disabled { opacity: .35; cursor: default; }
    .vc-btn:disabled:hover { background: rgba(42,42,58,0.92); color: #cfd2e0; border-color: #3a3a4a; }
    .vc-btn mat-icon { font-size: 16px; width: 16px; height: 16px; line-height: 16px; }
    .vc-sep { width: 1px; height: 18px; background: #3a3a4a; margin: 0 2px; }
    /* Roll-arc arrows at the cube's top corners (cube: top 12px, 103px square,
       spanning right 62–165px). Borderless like Onshape/Fusion. */
    .rot-btn { position: absolute; top: 4px; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
               padding: 0; background: none; border: none; color: #c4c8d8; cursor: pointer; opacity: 0.85; }
    .rot-btn:hover { color: #fff; opacity: 1; }
    /* 3D pick-debug overlay — bottom-right, same palette as the sketch
       editor's pick debug. pointer-events: none so it never eats picks. */
    .pick-debug {
      position: absolute; right: 8px; bottom: 64px; z-index: 5;
      background: rgba(20, 20, 32, 0.88); border: 1px solid #3a3a52;
      border-radius: 4px; padding: 6px 8px;
      font: 10px/1.5 monospace; color: #9aa5b4;
      pointer-events: none; max-width: 320px;
    }
    .pick-debug-row { white-space: nowrap; }
    .pick-debug-row.build { color: #ffd54f; border-bottom: 1px solid #37474f; padding-bottom: 3px; margin-bottom: 3px; }
    .pick-debug-row.sel { color: #80cbc4; white-space: normal; }
    .pick-debug-row b { color: #ffcc80; }
    .pick-debug-sep { margin-top: 3px; color: #6a7383; }
    .pick-debug-item { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pick-debug-item.win { color: #80cbc4; font-weight: 600; }
    .rot-btn svg { width: 36px; height: 36px; display: block; filter: drop-shadow(0 0 2px rgba(0,0,0,0.7)); }
    .rot-ccw { right: 138px; }
    .rot-cw  { right: 52px; }
    .hud { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); padding: 8px 16px; background: rgba(0,0,0,0.7); border-radius: 4px; font-size: 12px; color: #fff; display: flex; align-items: center; gap: 10px; }
    .hud .spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.25); border-top-color: #66bb6a; border-radius: 50%; animation: hud-spin 0.9s linear infinite; }
    @keyframes hud-spin { to { transform: rotate(360deg); } }
  `],
})
export class CadViewerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mount', { static: true }) mountRef!: ElementRef<HTMLDivElement>;
  @ViewChild('cubeMount', { static: true }) cubeMountRef!: ElementRef<HTMLDivElement>;

  // Navigation cube — small Onshape-style widget rendered in its own WebGL
  // context in the top-right corner. Each face is sub-divided into a 3x3
  // grid: the centre cell jumps to the canonical orthographic view, the 4
  // edge cells jump to a 45° "edge" view (camera averaging two adjacent
  // faces), and the 4 corner cells jump to an isometric "corner" view
  // (camera averaging three faces). Faces-only is the common case but the
  // edges/corners are how Onshape users get to ISO views without
  // memorising angles. LMB-drag on the cube body acts as a free-orbit
  // shortcut, mirroring SolidWorks's "click and drag the view cube".
  private cubeRenderer: THREE.WebGLRenderer | null = null;
  private cubeScene: THREE.Scene | null = null;
  private cubeCamera: THREE.OrthographicCamera | null = null;
  private cubeMesh: THREE.Mesh | null = null;
  private cubeAnimHandle = 0;
  // Drag-to-orbit state for the nav cube.
  private cubeDragStart: { x: number; y: number } | null = null;
  private cubeDidDrag = false;
  private readonly CUBE_DRAG_THRESHOLD_PX = 3;
  // Hover-debug state — one material slot per region (26 total), with the
  // region's display name so we can console.log it on hover and visually
  // highlight just that region by tinting its material.
  private cubeMaterials: THREE.MeshBasicMaterial[] = [];
  private cubeBaseColors: THREE.Color[] = [];
  private hoveredCubeSlot: number | null = null;

  geometry = input<ModelGeometry | null>(null);
  /** CAD-790 in-context editing: ghost geometry of the OTHER assembly components
   * (read-only reference), drawn in the edited part's local frame. */
  referenceGeometry = input<InContextOverlay | null>(null);
  /** Section view: a clipping plane (model space). Null = no section. */
  sectionPlane = input<{ normal: [number, number, number]; point: [number, number, number] } | null>(null);
  selected = input<string | null>(null);
  /** Plane the "Normal to" view button orients to — the selected flat face's
   * or datum plane's plane, supplied by the editor. Null disables the button. */
  normalToPlane = input<import('../../../cad/lib/types').Plane3 | null>(null);
  selectedFeatures = input<Set<string>>(new Set());
  /** Selected origin-datum ids (point / axes / planes) — highlighted in the
   * viewer to mirror the feature-tree selection. */
  selectedDatums = input<Set<string>>(new Set());
  /** Currently-picked face ids in an active picker (Measure /
   * Fillet / Chamfer). Renders these in a sticky picked-color so the
   * user sees what's already in the selection set, separate from the
   * single-face `selected` (which represents a committed selection)
   * and `hovered` (the transient cursor state). */
  pickedFaceIds = input<Set<string>>(new Set());
  /** Currently-picked edge ids — same role as `pickedFaceIds` for
   * edges. Rendered as a permanent bright overlay on each id, on top
   * of any transient `hoveredEdgeId` highlight. */
  pickedEdgeIds = input<Set<string>>(new Set());
  /** Currently-picked vertex ids — same role for vertices. Vertex
   * markers stay invisible normally; ids in this set get their dot
   * raised to full opacity. */
  pickedVertexIds = input<Set<string>>(new Set());
  /** Live preview of a datum plane being constructed in the sidebar
   * (REQ 657). Renders a translucent quad at the computed plane;
   * null clears the overlay. */
  datumPlanePreview = input<{ origin: [number, number, number]; xAxis: [number, number, number]; yAxis: [number, number, number]; normal: [number, number, number] } | null>(null);
  /** Live preview of a Shell feature being constructed in the sidebar
   * (REQ 659). Paints each picked face in a red translucent overlay
   * so the user can see which faces are about to be cut away before
   * clicking OK. Null clears the overlay. */
  shellPreview = input<{ faceIds: string[]; thickness: number; direction: 'inward' | 'outward' } | null>(null);
  /** Live preview of a Mirror / Linear Pattern / Circular Pattern
   * being constructed in the sidebar (REQ 658). Each transform is
   * applied to a CLONE of the current body's mesh to render a ghost
   * copy at that position. Null clears the overlay. */
  patternPreview = input<{
    kind: 'mirror' | 'linearPattern' | 'circularPattern';
    transforms: Array<
      | { kind: 'translate'; dx: number; dy: number; dz: number }
      | { kind: 'rotate'; origin: [number, number, number]; direction: [number, number, number]; angleRad: number }
      | { kind: 'mirror'; origin: [number, number, number]; normal: [number, number, number] }
    >;
  } | null>(null);
  hovered = signal<string | null>(null);

  /** 3D pick-debug overlay state (mirrors the sketch editor's bottom-right
   * pick debug): every raycast candidate near the cursor — all face hits in
   * depth order, edge hits within the zoom-adaptive threshold, datum hits,
   * the armed pick modes, and the depth cap. Rebuilt per pointermove; the
   * template renders it only outside sketch mode. */
  pickDebug = signal<{
    modes: string;
    cap: string;
    items: Array<{ kind: string; label: string; dist: string; winner: boolean }>;
  } | null>(null);
  /** Cheap change key so identical frames skip the signal write (avoids a
   * change-detection storm while the cursor rests). */
  private lastPickDebugKey = '';
  /** Edge id under cursor while edgePickMode is active. Used by
   * Convert Entities to highlight the candidate edge before the user
   * commits with a click. Tracked separately from `hovered` (which
   * carries face / datum ids) so the recolor pipeline doesn't get
   * confused about what "hover" means in each mode. */
  hoveredEdgeId = signal<string | null>(null);
  /** In a sketch, hovering a model face highlights that face's boundary EDGES
   * (not the face fill). These are the hovered face's edge ids. */
  hoveredFaceEdgeIds = signal<Set<string>>(new Set());
  selectionChange = output<string | null>();
  // REQ 623 — feature-level click. The viewer reports which face was clicked,
  // its owning feature, whether the face is flat (REQ 625 / sketch-on-face),
  // and the modifier keys for multi-select handling in the parent.
  featureClick = output<{
    featureId: string | null;
    faceId: string | null;
    isFlat: boolean;
    shiftKey: boolean;
    ctrlKey: boolean;
  }>();
  featureContextMenu = output<{
    featureId: string | null;
    faceId: string | null;
    clientX: number;
    clientY: number;
  }>();
  // CAD-782/783 — assembly component drag. When `assemblyDrag` is on, a left
  // press on a draggable component (instanceId in `draggableInstanceIds`)
  // translates that component in the view plane instead of orbiting; on release
  // the accumulated world-space delta is emitted for the editor to commit + resolve.
  assemblyDrag = input<boolean>(false);
  draggableInstanceIds = input<Set<string>>(new Set());
  instanceDragEnd = output<{ instanceId: string; delta: [number, number, number] }>();
  loading = input<boolean>(false);
  loadProgress = input<string>('');
  // REQ 615: sketch overlays in the 3D scene.
  sketchDoc = input<SketchDocument | null>(null);
  activeSketchId = input<string | null>(null);
  displayMode = input<DisplayMode>('visible-edges');
  // REQ 629 — drawing preview (rubber-band line/circle/arc + snap indicator).
  sketchPreview = input<SketchPreview[]>([]);
  // REQ 631 — selected sketch entity IDs (line/circle/arc/point); selected
  // entities render with thicker LineMaterial in highlight color.
  selectedSketchEntities = input<Set<string>>(new Set());
  /** Sketch entity under the cursor (computed by the editor with the same
   * pickEntity used for clicks, so the highlight matches what would be
   * selected). Rendered in cyan, like the 3D face/edge hover. */
  hoveredSketchEntityId = input<string | null>(null);
  /** Currently-picked Mirror axis — rendered with a distinct magenta
   * highlight so the user can tell it apart from a regular selection. */
  mirrorAxisId = input<string | null>(null);
  /** Debug overlay visibility + build markers (owned by the editor, shown
   * inside the pick-debug panel when the footer bug toggle is on). */
  debugVisible = input<boolean>(false);
  /** Sub-toggle (inside the debug window) for the pick "area of influence"
   * outlines + face fills. Only meaningful when debugVisible is on. */
  showInfluence = input<boolean>(false);
  frontendBuild = input<string>('');
  kernelBuild = input<string | null>(null);
  /** Live projected model edge/vertex snap candidates (2D, on the active sketch
   * plane). Used only by the debug pick-influence overlay to outline each
   * projected edge's hover band. */
  sketchCandidates = input<ReferenceCandidate[]>([]);
  /** Active-sketch DOF state — drives the sketch stroke color so the user
   * sees the constraint status at a glance. SolidWorks-style:
   *   under  → per-entity coloring (each entity green / blue based on
   *            its own determinacy)
   *   fixed  → all green
   *   over   → all red (solver detected conflict)
   */
  activeSketchDof = input<'under' | 'fixed' | 'over'>('under');
  /** Per-entity determinacy set. When the global state is 'under', any
   * entity id in this set still renders green (it's locally
   * fully-constrained); others stay blue. Globally 'over' or 'fixed'
   * overrides this per-entity decision. */
  determinedEntities = input<Set<string>>(new Set());
  /** REQ 860: entity ids targeted by the constraints the solver named as
   * conflicting. When non-empty in the 'over' state, ONLY these render red
   * (others keep their determinacy coloring); empty falls back to all-red. */
  conflictEntityIds = input<Set<string>>(new Set());
  /** REQ 867 — box selection resolved on marquee release: the faces whose
   * screen projection the box encloses (window) or touches (crossing), plus
   * their owning feature ids for feature-level selection. */
  boxSelect = output<{ faceIds: string[]; featureIds: string[]; crossing: boolean; shiftKey: boolean }>();
  /** REQ 873: flip the scroll-wheel zoom direction (per-user preference). */
  invertZoom = input<boolean>(false);
  /** When set, the dimension label for this constraint id renders as an
   * editable <input> instead of a static value pill. Used by Smart Dim's
   * auto-focus after placing a dimension, and by click-to-edit on existing
   * labels. */
  editingDimensionId = input<string | null>(null);
  /** Sketch dimensions whose `value` is currently driven by an equation
   * expression. Keyed by constraint id → expression text (no leading
   * `=`). Used to: (a) prefix labels with a Σ badge, (b) pre-fill the
   * inline editor with `=expression` so the user sees and can edit the
   * binding instead of just the resolved number. */
  drivenDimensions = input<Record<string, string>>({});
  /** When set, the dimension label for this constraint id renders in the
   * "selected" style (orange + slight glow). Single-clicking a label
   * sets this in the parent; Delete-key with a dim selected removes it. */
  selectedConstraintId = input<string | null>(null);
  /** Model default unit, used to format dim values + suggest a default
   * input value when the inline editor opens for a bare-number dim. */
  defaultUnit = input<Unit>('mm');
  /** Saved default camera view; the Default-view control returns here. Null
   * means "no saved view" — the control falls back to a framed isometric. */
  defaultView = input<CadDefaultView | null>(null);
  /** Emitted when the user clicks "Save as default view"; carries the current
   * camera orientation for the parent to persist. */
  saveDefaultView = output<CadDefaultView>();
  /** Live-preview dimension while the user is mid-Smart-Dim (after two
   * picks, before the placement click). Rendered in orange/dashed so it
   * reads as a draft. */
  smartDimPreview = input<DimensionRender | null>(null);

  // REQ 616: sketch pointer events dispatched when an active sketch exists.
  // Coordinates are in the active sketch's 2D plane space (post ray-plane
  // intersection). The parent component wires these into the sketch tool logic.
  sketchClick = output<{ x: number; y: number; shiftKey: boolean; tolerance: number; pointTolerance: number }>();
  sketchPointerDown = output<{ x: number; y: number; tolerance: number; pointTolerance: number }>();
  sketchPointerMove = output<{ x: number; y: number; tolerance?: number; pointTolerance?: number; edgeTolerance?: number }>();
  sketchPointerUp = output<{ x: number; y: number }>();
  /** Fired when the user clicks (without dragging) a dimension annotation. */
  dimensionLabelClicked = output<string>();
  /** User clicked an arrow handle on a selected dimension → flip its arrowheads
   * inside/outside (SolidWorks-style). The parent toggles `arrowsOutside`. */
  dimensionArrowsToggled = output<string>();
  /** Inline dimension editor committed a new value (Enter / blur). Raw
   * text so the parent can parse units, magnitude, signs, etc. */
  dimensionCommitted = output<{ id: string; raw: string }>();
  /** Inline dimension editor canceled (Esc). */
  dimensionCanceled = output<void>();
  /** User dragged a dimension label to a new placement. Emitted per
   * pointermove (live preview) and once more on pointerup (commit). */
  dimensionDragged = output<{ id: string; placement: { x: number; y: number }; commit: boolean }>();
  /** User asked to delete a dimension — the Delete key shortcut while the
   * inline editor is focused (right-click now opens a menu, REQ 855). */
  dimensionDeleteRequested = output<string>();
  /** Right-click on a dim label — open the dimension context menu at the
   * cursor (Edit value / Make driven-driving / Delete). REQ 855. */
  dimensionContextMenu = output<{ id: string; clientX: number; clientY: number }>();
  /** Double-click on a dim label — open the inline value editor. */
  dimensionDoubleClicked = output<string>();
  /** Click on a mini constraint badge near a selected entity → user
   * wants to remove that constraint. */
  constraintIconClicked = output<string>();

  // Vertex picker (Up to Vertex end condition + future "pick a vertex"
  // flows). When true, the viewer renders a small clickable sphere at
  // every ModelTopology vertex and restricts click hit-testing to those
  // spheres — face / datum / region clicks are suppressed. Mirrors the
  // existing profile-fill picker's exclusivity model.
  vertexPickMode = input<boolean>(false);
  /** Extra pickable vertices beyond the BRep topology — typically sketch
   * points projected to 3D. Each id is opaque to the viewer; consumers
   * use their own namespace (e.g. `sketch:<sketchId>/<pointId>`) so
   * vertexPicked emits the same string the backend expects. */
  extraPickableVertices = input<Array<{ id: string; position: [number, number, number] }>>([]);
  /** Vertex id picked — emitted on click of a vertex marker. */
  vertexPicked = output<string>();
  /** REQ 663 — Hole Wizard preview. One record per placement; each
   * renders a translucent cylinder for the drill + (optional) cbore
   * cylinder or csk cone. Axis points INTO the body. Empty array =
   * no preview rendered. */
  holePreviews = input<HolePreview[]>([]);
  /** REQ 665 — translucent cosmetic-thread shells, one per tapped
   * placement. Recomputed by the editor from the feature tree;
   * empty array = group hidden (no render). */
  cosmeticThreads = input<CosmeticThread[]>([]);
  /** REQ Batch 6 — variable name → string value, used to substitute
   * `#{varName}` tokens in sketch-text content at render time.
   * Editor passes part identity (partName, partNumber, partRevision,
   * manufacturerPN) plus formatted numeric equation values. */
  textVariables = input<Record<string, string>>({});
  /** Vertex pick + co-located face context. Fires alongside
   * `vertexPicked` so existing consumers are unaffected. REQ 663
   * (Hole Wizard) uses the face normal as the hole axis when a
   * vertex is picked on a planar face. */
  vertexPickedAt = output<{
    vertexId: string;
    position: [number, number, number];
    faceNormal?: [number, number, number];
  }>();
  /** Face pick mode (Up to Surface end condition). When on, clicks ONLY
   * fire facePicked with a BRep face id. Hover gates to faces. Mutually
   * exclusive with vertexPickMode at the editor layer. */
  facePickMode = input<boolean>(false);
  /** Sketch-plane pick (New Sketch / change-host): the editor is waiting for
   * the user to pick a sketch plane. Hover highlights only ACCEPTABLE targets
   * — a flat model face or a datum PLANE (axes / points / curved faces aren't
   * sketchable). The click still flows through the normal selection path. */
  planePickMode = input<boolean>(false);
  /** Feature whose own faces should be EXCLUDED from face-pick hits.
   * Used when an Up-to-Surface end condition is being chosen on a
   * feature that has already produced faces (e.g. editing an existing
   * extrude) — a feature can't extrude "up to" a face it produced
   * itself, so we filter them out at pick time to prevent the error
   * round-trip with the kernel. */
  facePickExcludeFeatureId = input<string | null>(null);
  /** Face id picked — emitted on click of a face in pick mode. */
  facePicked = output<string>();
  /** Same event with the raycast hit point + face-meshlet normal.
   * Fires alongside `facePicked` so existing consumers don't change;
   * REQ 663 (Hole Wizard) reads this for "click a face → drop a hole
   * at the click point." */
  facePickedAt = output<{
    faceId: string;
    point: [number, number, number];
    normal: [number, number, number];
  }>();

  // Profile-region picker (Extrude sidebar). Populated by cad-editor when
  // the sidebar is open; the viewer renders one translucent mesh per loop
  // and emits profileFillClick on hit-test. Empty array disables the
  // overlay entirely.
  profileFills = input<ProfileFill[]>([]);
  /** Loop indices the user has currently selected for extrusion. Drives
   * the fill colour: selected = bright orange, unselected = grey. */
  profileFillsSelected = input<Set<number>>(new Set());
  /** Index of the loop the pointer is hovering, or null. */
  profileFillsHovered = input<number | null>(null);
  /** User clicked a profile fill — emit its loop index so the editor can
   * toggle it in extrudeSelectedLoops. */
  profileFillClick = output<number>();
  /** Pointer is over a profile fill — null means it left. */
  profileFillHover = output<number | null>();

  // Axis-picker overlay (Revolve sidebar). Same pattern as profileFills /
  // facePickMode: editor supplies a list of pickable line segments
  // (already projected to 3D via the host sketch's plane), the viewer
  // renders them as thick highlight lines and hit-tests them. Restricted
  // to sketch lines for now; datum-axis support can be folded into the
  // same channel once RevolveFeature.axisLineId accepts datum ids.
  axisCandidates = input<Array<{
    id: string; p1: [number, number, number]; p2: [number, number, number]; construction?: boolean;
  }>>([]);
  /** When true, clicking an axis candidate emits axisPicked instead of
   * routing through the normal selection path. */
  axisPickMode = input<boolean>(false);
  /** Currently-selected axis id (highlighted brighter than candidates). */
  selectedAxisId = input<string | null>(null);
  /** User clicked an axis candidate — emit its id so the editor can store
   * it in revolveAxisLineId. */
  axisPicked = output<string>();

  // Edge-pick mode — debug aid. When on, clicking a topology edge in
  // the viewport emits edgePicked with the kernel-supplied edge record
  // (id, isStraight flag, endpoints, polyline length) so the editor can
  // surface "why is this edge there?" info without leaving the canvas.
  edgePickMode = input<boolean>(false);
  /** When true, a click that lands on a projected model edge defers to the
   * sketch click instead of picking the edge — set by the editor when a SKETCH
   * entity is the current hover winner (Select mode), so clicking a sketch line
   * drawn on an edge selects the LINE, matching what's highlighted. Convert
   * Entities leaves this false (it always wants the edge). */
  preferSketchOverEdgePick = input<boolean>(false);
  edgePicked = output<{ edgeId: string; isStraight: boolean; endpoints: [[number, number, number], [number, number, number]]; polylineLength: number }>();
  /** Cross-part Convert Entities (in-context): the user picked ANOTHER
   * component's edge / face / vertex in the reference overlay. The editor
   * projects it into the active sketch with a cross-part external reference. */
  crossPartEdgePicked = output<OverlayEdge>();
  crossPartFacePicked = output<OverlayFace>();
  crossPartVertexPicked = output<OverlayVertex>();

  // Live "ghost" preview of an in-progress Extrude / Cut Extrude / Revolve
  // before the user commits. `kind` controls the tint (additive = green,
  // subtractive = red); mesh data comes pre-built from cad/lib/preview.ts.
  // Null hides the overlay.
  featurePreview = input<{
    kind: 'add' | 'cut';
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
  } | null>(null);

  /** Live preview of an in-progress 3D Fillet or Chamfer. Each entry is
   * the EDGE ID (matched against `faceEdges` to recolor the actual edge
   * line) + the picked endpoint pair (drawn as a tube of radius=value
   * for fillet, or a pair of parallel offset lines for chamfer, to give
   * the user a sense of the size). Null hides the overlay. */
  edgeBlendPreview = input<{
    kind: 'fillet' | 'chamfer';
    value: number;
    edges: Array<{ edgeId: string; start: [number, number, number]; end: [number, number, number] }>;
  } | null>(null);

  private zone = inject(NgZone);

  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private renderer!: THREE.WebGLRenderer;
  // CSS2DRenderer overlays HTML elements positioned by 3D coordinates. Used
  // for crisp text labels (dimension annotations) that scale and translate
  // with the camera while staying pixel-sharp.
  private labelRenderer!: CSS2DRenderer;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private faceGroup!: THREE.Group;
  /** DEBUG: faint translucent clones of each face, shown in sketch mode when
   * the debug toggle is on, so the user can see each face's "area of
   * influence" (hovering anywhere on it highlights its boundary edges). */
  private faceInfluenceDebugGroup!: THREE.Group;
  private faceInfluenceMaterial = new THREE.MeshBasicMaterial({
    color: 0x66bb6a, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide,
  });
  private datumGroup!: THREE.Group;
  private sketchGroup!: THREE.Group;
  private faceMeshes = new Map<string, THREE.Mesh>();
  private datumMeshes = new Map<string, THREE.Object3D>();
  // Datum plane labels (CSS2D) tracked for per-frame occlusion culling — CSS2D
  // labels ignore WebGL depth, so they'd otherwise show through solid parts.
  private datumLabels: CSS2DObject[] = [];
  private occlusionRaycaster = new THREE.Raycaster();
  // REQ 619 — edge overlays. Two backends share this map:
  //   - New kernel (topology has polyline data): one entry per BRep edge,
  //     `THREE.Line` rendering the analytic curve sampling.
  //   - Old kernel (no polyline): one entry per face, `THREE.LineSegments`
  //     from THREE.EdgesGeometry.
  // Both classes expose the same {visible, geometry, computeLineDistances}
  // contract this map needs, so the consumer code doesn't have to branch.
  private faceEdges = new Map<string, {
    front: THREE.Line | THREE.LineSegments;
    hiddenSolid: THREE.Line | THREE.LineSegments;
    hiddenDashed: THREE.Line | THREE.LineSegments;
  }>();
  private edgeGroup!: THREE.Group;
  // CAD-790 — ghost reference geometry of the other components when editing
  // a part in the context of an assembly.
  private referenceGroup!: THREE.Group;
  private referenceMeshes: THREE.Object3D[] = [];
  // REQ 631 — selected sketch lines use Line2 with a real pixel linewidth.
  // Shared across all selected entities; resolution updated on canvas resize.
  // syncSketches' disposal loop skips this so it survives across rebuilds.
  private selectedSketchMaterial = new LineMaterial({
    color: 0xffb74d,
    linewidth: 4,
    transparent: true,
    depthTest: false,
    resolution: new THREE.Vector2(800, 600),  // populated in initScene/onResize
  });
  /** Distinct material for the active Mirror tool's axis line. Magenta so it
   * doesn't collide with the orange selection highlight nor the blue
   * default. Same lifecycle rules as `selectedSketchMaterial` — survives
   * sketch rebuilds; resolution updated on canvas resize. */
  private mirrorAxisMaterial = new LineMaterial({
    color: 0xe040fb,
    linewidth: 4,
    transparent: true,
    depthTest: false,
    resolution: new THREE.Vector2(800, 600),
  });
  /** Hover highlight for the sketch entity under the cursor (cyan, matching the
   * 3D face/edge hover). Shares the selectedSketchMaterial lifecycle: survives
   * sketch rebuilds; resolution updated on canvas resize; skipped by disposal. */
  private hoverSketchMaterial = new LineMaterial({
    color: 0x40c4ff,
    linewidth: 4,
    transparent: true,
    depthTest: false,
    resolution: new THREE.Vector2(800, 600),
  });
  private frontEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x111111, depthFunc: THREE.LessEqualDepth });
  private hiddenSolidMaterial = new THREE.LineBasicMaterial({ color: 0x111111, depthFunc: THREE.GreaterDepth, transparent: true, opacity: 0.5 });
  private hiddenDashedMaterial = new THREE.LineDashedMaterial({ color: 0x111111, depthFunc: THREE.GreaterDepth, dashSize: 1.5, gapSize: 1, transparent: true, opacity: 0.6 });
  // Tangent edges (fillet/chamfer boundaries + parametric seams) get
  // the same color as regular feature edges so the silhouette reads
  // uniformly. Hidden-layer tangent stays dashed for hidden-line/
  // wireframe display modes.
  private frontTangentEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x111111, depthFunc: THREE.LessEqualDepth });
  private hiddenTangentMaterial = new THREE.LineDashedMaterial({ color: 0x111111, depthFunc: THREE.GreaterDepth, dashSize: 1.5, gapSize: 1, transparent: true, opacity: 0.5 });
  // Keyed by sketchId; each entry is one container Group holding the projected
  // line segments and point markers for that sketch.
  private sketchOverlays = new Map<string, THREE.Group>();
  // REQ 629 — separate group for the drawing preview overlay; rebuilt on every
  // sketchPreview input change.
  private sketchPreviewGroup!: THREE.Group;
  // REQ 663 — Hole Wizard preview overlay. Rebuilt on every
  // holePreviews input change.
  private holePreviewGroup!: THREE.Group;
  // REQ 665 — cosmetic thread shells for tapped holes.
  private cosmeticThreadGroup!: THREE.Group;
  // Translucent profile-region overlays for the Extrude sidebar. Rebuilt on
  // every profileFills input change; material colour swapped when the
  // selected/hovered inputs change so we don't pay full geometry rebuild
  // cost just for a hover.
  private profileFillGroup!: THREE.Group;
  private profileFillMeshes = new Map<number, THREE.Mesh>();
  // Vertex-pick overlay (Up to Vertex). Small spheres at each topology
  // vertex; the group's visibility is toggled by the vertexPickMode input
  // rather than swapped per build, so picker open/close is instant.
  private vertexPickGroup!: THREE.Group;
  private vertexPickMeshes = new Map<string, THREE.Mesh>();
  // Axis-pick overlay (Revolve sidebar). One thick line per candidate,
  // tagged with userData.axisLineId. Group visibility tracks axisPickMode.
  private axisPickGroup!: THREE.Group;
  // Persistent highlight for the picked axis (visible regardless of
  // axisPickMode). Built from the same candidate data; one cylinder,
  // bright orange, depthTest off so it reads over the body. See the
  // rebuildSelectedAxisHighlight method.
  private selectedAxisHighlightGroup!: THREE.Group;
  /** Bright overlay drawn on top of the edge under the cursor while
   * edgePickMode is active (Convert Entities). One Line per hover —
   * rebuilt whenever hoveredEdgeId changes. */
  private edgeHoverHighlightGroup!: THREE.Group;
  // Feature-preview ghost mesh — translucent volume that shows where the
  // in-progress Extrude / Cut / Revolve would put geometry. Rebuilt from
  // the `featurePreview` input on each change; null clears the group.
  private featurePreviewGroup!: THREE.Group;
  /** Overlay for the in-progress fillet/chamfer: bright highlight on
   * each picked edge plus a translucent tube (fillet) / parallel offset
   * lines (chamfer) sized by the current radius/distance. */
  private edgeBlendPreviewGroup!: THREE.Group;
  /** Overlay for the in-progress datum plane (REQ 657). One translucent
   * quad oriented to the computed plane; rebuilt on every preview input
   * change. */
  private datumPlanePreviewGroup!: THREE.Group;
  /** Overlay for the in-progress pattern feature (REQ 658). Holds N
   * ghost clones of the current body's meshes — one per pattern
   * transform. Rebuilt on every preview input change. */
  private patternPreviewGroup!: THREE.Group;
  /** Overlay for the in-progress shell feature (REQ 659). Holds
   * translucent red clones of every picked "face to remove" so the
   * user can visually confirm what gets cut away. */
  private shellPreviewGroup!: THREE.Group;

  private rafHandle = 0;
  private resizeObserver?: ResizeObserver;

  // Orbit / pan / zoom state.
  private orbiting = false;
  private panning = false;
  private zoomDragging = false;
  // Which gesture a left-button drag performs in 3D mode (the on-screen
  // orbit/pan/zoom buttons set this). Left-click still selects; middle-button
  // navigation keeps working regardless.
  navMode = signal<'orbit' | 'pan' | 'zoom' | 'select'>('orbit');

  // Touch navigation state (mobile). 'multi' = two fingers pinch-zoom + pan
  // together. One-finger touch rides the synthesized POINTER events instead
  // (touch-action:none keeps them alive) — handling it here too would double
  // every orbit delta.
  private touchNav: 'none' | 'multi' = 'none';
  private touchMoved = false;            // a real drag happened → suppress tap-select
  private lastPinchDist = 0;             // last two-finger distance (pinch)
  private lastPinchMid = { x: 0, y: 0 }; // last two-finger midpoint (pan)
  // Set when the browser can't give us a WebGL context (usually GPU-context
  // exhaustion after a long session, or hardware acceleration disabled). Drives
  // a visible notice instead of a silent blank viewport.
  webglUnavailable = signal(false);
  private didNavDrag = false;   // suppress click-select after a left-drag navigate
  // CAD-782 assembly component drag. A press on a draggable component becomes a
  // candidate; it engages as a drag only once the pointer passes the threshold,
  // so a press-and-release still selects.
  private dragCandidate: { instanceId: string; startX: number; startY: number } | null = null;
  private dragActiveInstanceId: string | null = null;
  private orbitTheta = Math.PI / 4;
  private orbitPhi = Math.PI / 4;
  private orbitTarget = new THREE.Vector3(0, 0, 0);
  private orbitDistance = 180;
  /** Cleared until the first geometry sync applies the saved default view (or
   * the Z-up iso fallback) on model load / page refresh. Guards against later
   * regens (every edit re-syncs geometry) yanking the camera back. */
  private _initialViewApplied = false;
  /** Bumped when zoom (orbitDistance) changes enough to warrant re-tessellating
   * sketch curves at the new view scale. The sketch-overlay effect tracks it so
   * circles/arcs stay smooth at any zoom. Throttled (not per wheel tick). */
  private viewEpoch = signal(0);
  /** orbitDistance at the last viewEpoch bump — used to throttle rebuilds. */
  private viewEpochDistance = 180;
  // When non-null, updateCamera positions along this vector instead of
  // through orbitTheta/orbitPhi spherical coords. Set by orientToPlane
  // when the user enters a sketch; cleared by restoreCameraUp on exit.
  // Fixes two drift sources: (a) orientToPlane clamps orbitPhi to
  // [0.05, π-0.05] so planes whose normal is world ±Y land ~2.86° off
  // axis on the next updateCamera call (zoom/pan); (b) an accidental
  // right-drag in sketch mode mutates the spherical coords without
  // changing camera position visibly until the next zoom/pan.
  private sketchPlaneNormal: [number, number, number] | null = null;
  private lastPointer = { x: 0, y: 0 };
  // Tracks the last sketchId we oriented for so we re-orient on each *transition*
  // into a sketch (and not on every input mutation while inside one).
  private orientedSketchId: string | null = null;

  constructor() {
    effect(() => {
      const g = this.geometry();
      if (this.scene && g) {
        this.syncGeometry(g);
        // On first model load / page refresh, orient to the saved default view
        // (or the Z-up isometric fallback). Once only — later regens must not
        // pull the camera away from wherever the user has orbited to. Skipped
        // while pinned to a sketch plane (sketch mode owns the view); the flag
        // stays clear so it applies on the first non-sketch sync.
        if (!this._initialViewApplied && !this.sketchPlaneNormal) {
          this._initialViewApplied = true;
          this.applyDefaultView();
        }
      }
    });
    // CAD-790 — ghost reference geometry (in-context editing).
    effect(() => {
      const ref = this.referenceGeometry();
      if (this.scene) this.syncReference(ref);
    });
    // Section view (REQ 766) — a single global clipping plane on the renderer.
    effect(() => {
      const sp = this.sectionPlane();
      if (!this.renderer) return;
      if (sp) {
        const n = new THREE.Vector3(sp.normal[0], sp.normal[1], sp.normal[2]).normalize();
        const p = new THREE.Vector3(sp.point[0], sp.point[1], sp.point[2]);
        this.renderer.clippingPlanes = [new THREE.Plane().setFromNormalAndCoplanarPoint(n, p)];
      } else {
        this.renderer.clippingPlanes = [];
      }
    });
    effect(() => {
      const sel = this.selected();
      const hov = this.hovered();
      const features = this.selectedFeatures();
      const picked = this.pickedFaceIds();
      if (this.scene) this.recolor(sel, hov, features, picked);
    });
    effect(() => {
      // Re-tint origin datums on selection OR transient hover/select changes
      // (datum meshes are built in syncDatums; this only adjusts color/opacity,
      // no rebuild). Hover highlight drives the sketch-plane-pick affordance.
      this.selectedDatums();
      this.hovered();
      this.selected();
      if (this.scene) this.recolorDatums();
    });
    effect(() => {
      const doc = this.sketchDoc();
      const active = this.activeSketchId();
      const selected = this.selectedSketchEntities();
      const axisId = this.mirrorAxisId();
      // editingDimensionId tracked so a click on a dimension label rebuilds
      // the sketch overlay and swaps the label for an inline <input>.
      void this.editingDimensionId();
      void this.selectedConstraintId();
      void this.activeSketchDof();
      void this.determinedEntities();
      void this.defaultUnit();
      // debugVisible / showInfluence / sketchCandidates tracked so toggling the
      // debug overlay (and live projected-edge changes) repaint the
      // pick-influence outlines.
      void this.debugVisible();
      void this.showInfluence();
      void this.sketchCandidates();
      // drivenDimensions tracked so toggling an equation on/off
      // immediately repaints the Σ badge + label color.
      void this.drivenDimensions();
      // smartDimPreview tracked so the Smart Dim cursor preview re-renders
      // on every cursor move during the in-progress pick.
      void this.smartDimPreview();
      // hoveredSketchEntityId tracked so the cyan hover highlight repaints when
      // the cursor crosses onto a different entity (low frequency — only on
      // entity boundary crossings, not every pointer move).
      void this.hoveredSketchEntityId();
      // viewEpoch tracked so curves re-tessellate (smooth) when zoom changes.
      void this.viewEpoch();
      if (this.scene) this.syncSketches(doc, active, selected, axisId);
    });
    // REQ 619 — apply display-mode toggles to existing face + edge meshes.
    effect(() => {
      const mode = this.displayMode();
      if (this.scene) this.applyDisplayMode(mode);
    });
    // DEBUG: face "area of influence" fills — only in sketch mode with the debug
    // toggle on. Tracks geometry so the fills follow face rebuilds.
    effect(() => {
      const show = this.debugVisible() && this.showInfluence() && this.activeSketchId() !== null;
      void this.geometry();
      if (this.scene) this._rebuildFaceInfluenceDebug(show);
    });
    // REQ 629 — rebuild the preview overlay when its input changes.
    effect(() => {
      const preview = this.sketchPreview();
      const sid = this.activeSketchId();
      if (this.scene) this.rebuildPreview(preview, sid);
    });
    // Profile-region overlays: rebuild geometry when the fills input
    // changes, and re-colour materials when selected/hovered inputs change
    // (cheap — no geometry rebuild).
    effect(() => {
      const fills = this.profileFills();
      if (this.scene) this.rebuildProfileFills(fills);
    });
    // REQ 663 — rebuild the Hole Wizard preview when its input
    // changes (placements added / removed, dimensions edited).
    effect(() => {
      const previews = this.holePreviews();
      if (this.scene) this.rebuildHolePreviews(previews);
    });
    // REQ 665 — cosmetic threads rebuild when the input changes.
    effect(() => {
      const threads = this.cosmeticThreads();
      if (this.scene) this.rebuildCosmeticThreads(threads);
    });
    effect(() => {
      const sel = this.profileFillsSelected();
      const hov = this.profileFillsHovered();
      if (this.scene) this.recolorProfileFills(sel, hov);
    });
    // Vertex picker overlay — rebuild markers when geometry topology
    // OR the extra (sketch-point) list changes; toggle visibility when
    // the mode flag flips so opening the picker doesn't pay a rebuild
    // cost.
    effect(() => {
      const g = this.geometry();
      const extra = this.extraPickableVertices();
      if (this.scene) this.rebuildVertexMarkers([...(g?.topology?.vertices ?? []), ...extra]);
    });
    effect(() => {
      const active = this.vertexPickMode();
      const hasPicked = this.pickedVertexIds().size > 0;
      // Group must be visible whenever either (a) vertex picker is
      // active (so hover can raycast spheres) or (b) there are sticky
      // picked vertex markers to render.
      if (this.vertexPickGroup) this.vertexPickGroup.visible = active || hasPicked;
      // Clear any stale face/datum hover ONLY when vertex-pick first
      // becomes active AND it's the only pick mode armed (the original
      // extrude Up-to-Vertex case). When measure-mode arms all three
      // pick modes simultaneously, we want face/edge hover to persist
      // so the user sees a highlight wherever the cursor goes. Use
      // untracked() to read hovered/edge/face pick mode so this effect
      // re-runs only on vertexPickMode transitions, not every time the
      // user's hover state changes.
      if (active) {
        const exclusive = untracked(() => !this.edgePickMode() && !this.facePickMode());
        if (exclusive) {
          const cur = untracked(() => this.hovered());
          if (cur !== null) this.hovered.set(null);
        }
      }
    });
    // Axis-pick overlay rebuild: rebuilds when the candidate set or the
    // selected id changes (selected id only swaps materials, but the
    // rebuild path is cheap enough not to optimise yet).
    effect(() => {
      const cands = this.axisCandidates();
      const selected = this.selectedAxisId();
      if (this.scene) this.rebuildAxisPickMarkers(cands, selected);
    });
    effect(() => {
      const active = this.axisPickMode();
      if (this.axisPickGroup) this.axisPickGroup.visible = active;
      if (active && this.hovered() !== null) this.hovered.set(null);
    });
    // Persistent highlight: rebuild a single cylinder for the currently
    // selected axis. Tracks both the candidate set (positions change
    // when sketch geometry edits) and the selected id (swap when user
    // picks a different axis). Group is always visible — when nothing
    // is selected, the group is empty so nothing renders.
    effect(() => {
      const cands = this.axisCandidates();
      const selected = this.selectedAxisId();
      if (this.scene) this.rebuildSelectedAxisHighlight(cands, selected);
    });
    // Hovered-edge highlight while edgePickMode is on (Convert
    // Entities). Tracked separately so it updates with cursor moves
    // without touching the rest of the geometry rebuild. ALSO tracks
    // the sticky `pickedEdgeIds` set so every edge already in the
    // active picker stays highlighted, and the cursor-tracking
    // hovered edge stacks on top.
    effect(() => {
      const id = this.hoveredEdgeId();
      const picked = this.pickedEdgeIds();
      const faceEdges = this.hoveredFaceEdgeIds();
      if (this.scene) this._rebuildEdgeHoverHighlight(id, picked, faceEdges);
    });
    // Sticky vertex highlights: any id in pickedVertexIds gets its
    // marker raised to full opacity in a "picked" orange. Hover still
    // overlays its own color on top via updateVertexHover.
    effect(() => {
      const picked = this.pickedVertexIds();
      if (this.scene) this._applyPickedVertexMarkers(picked);
    });
    // Feature-preview ghost mesh — rebuilt whenever the editor passes
    // new geometry in. Disposes the previous mesh's GPU resources before
    // swapping; null clears the overlay entirely.
    effect(() => {
      const pv = this.featurePreview();
      if (this.scene) this.rebuildFeaturePreview(pv);
    });
    // 3D fillet/chamfer preview — bright highlight on each picked edge
    // plus a translucent tube (fillet) or offset lines (chamfer) sized
    // by the current value. Null clears the overlay.
    effect(() => {
      const pv = this.edgeBlendPreview();
      if (this.scene) this._rebuildEdgeBlendPreview(pv);
    });
    // REQ 657 — datum-plane preview overlay. Rebuilt on every input
    // change so the user sees the resulting plane move as they pick
    // references / change scalars in the sidebar.
    effect(() => {
      const pv = this.datumPlanePreview();
      if (this.scene) this._rebuildDatumPlanePreview(pv);
    });
    // REQ 658 — pattern preview overlay. Clones the current body's
    // face meshes and applies each transform in the preview's list to
    // render ghost copies of where the pattern will land. Reads
    // `geometry()` as well so the ghosts re-clone after edit-time
    // rollback rebuilds faceGroup (otherwise the clones reflect the
    // pre-rollback body, which for a pattern edit means ghosting the
    // already-patterned geometry — the "pattern of a pattern" bug).
    // queueMicrotask defers to AFTER the faceGroup rebuild effect has
    // had a chance to land — there's no guaranteed effect order
    // otherwise.
    effect(() => {
      const pv = this.patternPreview();
      this.geometry();
      if (this.scene) queueMicrotask(() => this._rebuildPatternPreview(pv));
    });
    // REQ 659 — shell preview overlay. Paints every picked face in a
    // translucent red so the user sees which faces are about to be
    // cut away. Same geometry() dep + microtask pattern as the
    // pattern preview so the overlay sits on the current body even
    // when an edit-time rollback rebuilds faceGroup.
    effect(() => {
      const pv = this.shellPreview();
      this.geometry();
      if (this.scene) queueMicrotask(() => this._rebuildShellPreview(pv));
    });
    // REQ 616 follow-up: when the user enters a sketch, snap the camera to look
    // straight down its plane normal. Re-orient only on transition, so the user
    // can free-orbit inside an active sketch without being yanked back.
    effect(() => {
      const sid = this.activeSketchId();
      if (sid === this.orientedSketchId) return;
      if (!this.scene) return;  // initScene picks up the initial case if any
      const sketch = sid ? this.sketchDoc()?.sketches[sid] : null;
      if (sketch) {
        this.orientToPlane(sketch.plane);
        this.zoomToFit();  // frame the model normal-to the sketch plane
      } else this.restoreCameraUp();  // leaving sketch mode → conventional world-Y up
      // Drop the sketch-mode face-edge hover highlight on any sketch transition.
      if (this.hoveredFaceEdgeIds().size > 0) this.hoveredFaceEdgeIds.set(new Set());
      this.orientedSketchId = sid;
    });
  }

  // Snaps the orbit camera to the plane normal: target = plane origin, camera
  // sits at orbitDistance along +normal so the plane fills the view.
  //
  // Sets `camera.up = plane.yAxis` so screen-up aligns with the sketch's
  // local Y axis. Without this, the default world-Y up causes screen-X
  // and sketch-X to disagree on planes whose yAxis isn't world-Y (XZ, YZ,
  // tilted face hosts). The visible symptom is "horizontal" looking
  // vertical and vice versa when drawing on those planes.
  /** Public: orient head-on to a specific plane right now. Used by the sketch
   * "Flip normal" action so the head-on view follows the reversed normal
   * immediately, without waiting for the sketchDoc input to propagate. Keeps
   * the sketch-mode head-on lock (the caller is editing the active sketch). */
  orientToPlaneNow(plane: import('../../../cad/lib/types').Plane3) {
    if (this.scene) this.orientToPlane(plane);
  }

  /** Nav-group "Normal to" button. In sketch mode it returns head-on to the
   * ACTIVE sketch's plane (re-pinning the head-on view, which the next orbit
   * releases again). In 3D mode it orients to the selected face/plane as a
   * one-shot reorientation (no lock) so the user can orbit away. */
  onNormalToClick() {
    const sid = this.activeSketchId();
    if (sid !== null) {
      const sketch = this.sketchDoc()?.sketches[sid];
      if (sketch) this.orientToPlane(sketch.plane);  // re-pin head-on to the sketch
      return;
    }
    const plane = this.normalToPlane();
    if (!plane) return;
    const prevLock = this.sketchPlaneNormal;
    this.orientToPlane(plane);
    this.sketchPlaneNormal = prevLock;
  }

  private orientToPlane(plane: import('../../../cad/lib/types').Plane3) {
    const len = Math.hypot(plane.normal[0], plane.normal[1], plane.normal[2]) || 1;
    const ux = plane.normal[0] / len;
    const uy = plane.normal[1] / len;
    const uz = plane.normal[2] / len;
    // Lock subsequent updateCamera calls (zoom, pan, accidental orbit
    // drags) to this normalised vector so the camera stays exactly
    // head-on to the sketch plane — no clamping drift, no orbit drift.
    this.sketchPlaneNormal = [ux, uy, uz];
    this.orbitTarget.set(plane.origin[0], plane.origin[1], plane.origin[2]);
    // Position the camera directly along the plane normal — don't go
    // through orbit theta/phi spherical coords. Those assume world-Y
    // up and round-trip slightly off-axis on tilted planes. Setting
    // position + up explicitly + lookAt gives a pixel-perfect normal
    // view on any plane orientation.
    this.camera.position.set(
      plane.origin[0] + ux * this.orbitDistance,
      plane.origin[1] + uy * this.orbitDistance,
      plane.origin[2] + uz * this.orbitDistance,
    );
    // Gravity-aligned screen-up: world-up projected onto the sketch plane.
    // This keeps "up is up" so the same plane always orients the same way,
    // independent of the plane's stored yAxis (which only needs to make the
    // basis right-handed, not point anywhere meaningful on screen). The
    // camera stays on the +normal side, so the sketch is NON-mirrored;
    // changing only `up` rotates the view in-plane and cannot affect
    // handedness. (worldUp = [0,0,1] → worldUp·N = uz.)
    let upx = -uz * ux;
    let upy = -uz * uy;
    let upz = 1 - uz * uz;
    let upLen = Math.hypot(upx, upy, upz);
    if (upLen < 1e-6) {
      // Near-horizontal plane (normal ≈ ±Z): world-up projects to ~0. Use the
      // standard convention — Top (+Z) → +Y up (so sketch +X is right and +Y
      // is up, not rotated 180°), Bottom (-Z) → -Y up.
      const sy = uz >= 0 ? 1 : -1;
      const sDotN = sy * uy;
      upx = -sDotN * ux;
      upy = sy - sDotN * uy;
      upz = -sDotN * uz;
      upLen = Math.hypot(upx, upy, upz) || 1;
    }
    this.camera.up.set(upx / upLen, upy / upLen, upz / upLen);
    this.camera.lookAt(this.orbitTarget);
    // Keep orbit theta/phi consistent with the new position so the
    // user's first drag rotates from this orientation rather than
    // snapping back to whatever the old orbit state implied.
    this.orbitPhi = Math.max(0.05, Math.min(Math.PI - 0.05, Math.acos(uz)));
    const sinPhi = Math.sin(this.orbitPhi);
    this.orbitTheta = sinPhi > 1e-6 ? Math.atan2(uy, ux) : 0;
    if (this.camera.isOrthographicCamera) this.updateOrthoFrustum();
  }

  /** Restore the camera's up vector to world +Y when leaving sketch mode
   * so the general 3D view orbits with the conventional vertical axis.
   * Also drops the sketch-plane-normal lock so updateCamera goes back
   * to the spherical-coord path the orbit handlers feed. */
  private restoreCameraUp() {
    this.sketchPlaneNormal = null;
    // Choose an up that isn't parallel to the view direction. Exiting a sketch
    // on the XZ plane leaves the camera looking along ±Y (a top/bottom view);
    // world-Y up would gimbal-lock there and snap the roll to an arbitrary
    // angle, visibly "rotating" the view on exit. Use the nav-cube pole
    // convention at the Y poles (Top → -Z up, Bottom → +Z up), world-Y
    // otherwise — and SNAP orbitPhi onto the pole, since orientToPlane clamps
    // it to 0.05 rad off (≈2.9°), which otherwise leaves the view slightly
    // tilted instead of perfectly normal.
    const phi = this.orbitPhi;
    if (phi < 0.1) { this.orbitPhi = 0; this.camera?.up.set(0, 1, 0); }             // Top (+Z look-down) → +Y up
    else if (phi > Math.PI - 0.1) { this.orbitPhi = Math.PI; this.camera?.up.set(0, -1, 0); } // Bottom (-Z look-up) → -Y up
    else this.camera?.up.copy(WORLD_UP);
    this.updateCamera();
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => this.initScene());
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.rafHandle);
    if (this.cubeAnimHandle) cancelAnimationFrame(this.cubeAnimHandle);
    this.cubeRenderer?.dispose();
    // dispose() frees GPU resources but does NOT release the WebGL context — it
    // lingers until GC. forceContextLoss() releases it immediately, so navigating
    // between editors doesn't leak contexts toward the browser's ~16-per-page cap.
    this.cubeRenderer?.forceContextLoss();
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    // Tear down any remaining CSS2D label DOM nodes so they don't leak past
    // the viewer's lifetime.
    this.scene?.traverse(o => {
      if (o instanceof CSS2DObject) o.element.remove();
    });
    this.labelRenderer?.domElement.remove();
    this.scene?.traverse(o => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
      if ((o as THREE.Mesh).material) {
        const m = (o as THREE.Mesh).material;
        Array.isArray(m) ? m.forEach(mat => mat.dispose()) : m.dispose();
      }
    });
  }

  // Retry creating the WebGL context after it was reported unavailable (the
  // "Reload 3D view" button). Re-runs scene init; on success, repaints the
  // current geometry since the syncGeometry effect only fires on geometry change.
  retryWebgl() {
    if (!this.webglUnavailable()) return;
    this.zone.runOutsideAngular(() => {
      this.initScene();
      if (!this.webglUnavailable() && this.scene) {
        const g = this.geometry();
        if (g) this.syncGeometry(g);
      }
    });
  }

  private initScene() {
    const mount = this.mountRef.nativeElement;
    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 600;

    // Create the WebGL context FIRST. If the browser can't give us one (GPU
    // context exhaustion after a long session, or hardware acceleration off),
    // bail before `this.scene`/groups are created — every render effect guards
    // on `if (this.scene)`, so leaving it undefined makes them all short-circuit
    // (instead of crashing on undefined groups). Surface a notice via the signal.
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (err) {
      console.error('[cad-viewer] WebGL unavailable:', err);
      this.zone.run(() => this.webglUnavailable.set(true));
      return;
    }
    this.zone.run(() => this.webglUnavailable.set(false));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1e1e2e);

    // Orthographic projection so faces exactly edge-on to the camera
    // (e.g. the lateral surface of a cylinder viewed down its axis)
    // project to a zero-area sliver and disappear correctly. Perspective
    // foreshortening would tilt rays at the screen edges and leak a
    // visible band of those lateral faces, which reads as a "draft"
    // halo. orbitDistance doubles as the half-height of the orthographic
    // frustum so the existing wheel-zoom / pan code keeps its scale.
    this.camera = new THREE.OrthographicCamera(
      -this.orbitDistance * (width / height), this.orbitDistance * (width / height),
      this.orbitDistance, -this.orbitDistance,
      // Symmetric +/-5000 clip range so geometry stays visible even when
      // a zoom-in places parts of the model behind the camera plane.
      // (PerspectiveCamera couldn't have negative near; OrthographicCamera
      // can, since parallel rays don't degenerate at depth 0.)
      -5000, 5000,
    );
    this.camera.up.copy(WORLD_UP);  // Z-up view convention from frame 1
    this.updateCamera();
    // REQ 631 — Line2 width is computed in screen-pixel space, so the material
    // needs the current canvas resolution.
    this.selectedSketchMaterial.resolution.set(width, height);
    this.mirrorAxisMaterial.resolution.set(width, height);
    this.hoverSketchMaterial.resolution.set(width, height);

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(width, height);
    mount.appendChild(this.renderer.domElement);

    // CSS2D overlay for dimension labels. Positioned absolute on top of the
    // canvas; pointer events pass through by default so orbit/pan still
    // works through the label layer. Individual label DOM nodes opt back
    // into pointer events for click-to-edit.
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(width, height);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    mount.appendChild(this.labelRenderer.domElement);

    // Lights.
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(50, 100, 70);
    this.scene.add(dir);

    // Containers for geometry.
    this.datumGroup = new THREE.Group();
    this.scene.add(this.datumGroup);
    this.faceGroup = new THREE.Group();
    this.scene.add(this.faceGroup);
    this.sketchGroup = new THREE.Group();
    this.scene.add(this.sketchGroup);
    this.faceInfluenceDebugGroup = new THREE.Group();
    this.scene.add(this.faceInfluenceDebugGroup);
    this.sketchPreviewGroup = new THREE.Group();
    this.scene.add(this.sketchPreviewGroup);
    this.profileFillGroup = new THREE.Group();
    this.scene.add(this.profileFillGroup);
    this.holePreviewGroup = new THREE.Group();
    this.scene.add(this.holePreviewGroup);
    this.cosmeticThreadGroup = new THREE.Group();
    this.scene.add(this.cosmeticThreadGroup);
    this.vertexPickGroup = new THREE.Group();
    this.vertexPickGroup.visible = false;
    this.scene.add(this.vertexPickGroup);
    this.axisPickGroup = new THREE.Group();
    this.axisPickGroup.visible = false;
    this.scene.add(this.axisPickGroup);
    // Persistent highlight for the currently-picked axis. Independent
    // of axisPickMode so the user can SEE which line is the rotation
    // axis even after the picker overlay closes. One cylinder, bright
    // orange, always on top.
    this.selectedAxisHighlightGroup = new THREE.Group();
    this.scene.add(this.selectedAxisHighlightGroup);
    this.edgeHoverHighlightGroup = new THREE.Group();
    this.scene.add(this.edgeHoverHighlightGroup);
    this.edgeBlendPreviewGroup = new THREE.Group();
    this.scene.add(this.edgeBlendPreviewGroup);
    this.datumPlanePreviewGroup = new THREE.Group();
    this.scene.add(this.datumPlanePreviewGroup);
    this.patternPreviewGroup = new THREE.Group();
    this.scene.add(this.patternPreviewGroup);
    this.shellPreviewGroup = new THREE.Group();
    this.scene.add(this.shellPreviewGroup);
    this.featurePreviewGroup = new THREE.Group();
    this.scene.add(this.featurePreviewGroup);
    this.edgeGroup = new THREE.Group();
    this.scene.add(this.edgeGroup);
    this.referenceGroup = new THREE.Group();
    this.scene.add(this.referenceGroup);
    this.syncReference(this.referenceGeometry());

    // Input handlers.
    const canvas = this.renderer.domElement;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerUp);
    // Touch navigation (mobile): 1 finger = orbit, 2 fingers = pinch-zoom + pan.
    // There's no middle button on a phone, so we drive the camera here directly.
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('click', this.onClick);
    // REQ 623: right-click in normal mode opens a feature context menu (handled
    // by the parent); we always preventDefault so the native menu never shows
    // and right-drag can also be used to orbit in sketch mode.
    canvas.addEventListener('contextmenu', this.onContextMenu);

    // Resize.
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(mount);

    // Initial geometry.
    const g = this.geometry();
    if (g) this.syncGeometry(g);
    // The vertex-pick effect runs at construction time when this.scene
    // is still null and bails. Rebuild here once the scene exists so
    // markers are ready the first time the user enters pick mode.
    this.rebuildVertexMarkers([
      ...(g?.topology?.vertices ?? []),
      ...this.extraPickableVertices(),
    ]);
    this.syncSketches(this.sketchDoc(), this.activeSketchId());
    // If a sketch is already active at scene-init time, orient now — the
    // constructor effect would have bailed out earlier (no scene yet).
    const initialSid = this.activeSketchId();
    if (initialSid) {
      const sketch = this.sketchDoc()?.sketches[initialSid];
      if (sketch) {
        this.orientToPlane(sketch.plane);
        this.orientedSketchId = initialSid;
      }
    }

    // Navigation cube — separate WebGL context in the top-right overlay div.
    this.setupNavCube();

    // Animate.
    const animate = () => {
      this.rafHandle = requestAnimationFrame(animate);
      this.renderer.render(this.scene, this.camera);
      this.updateLabelOcclusion();
      this.labelRenderer.render(this.scene, this.camera);
      if (this.cubeRenderer && this.cubeScene && this.cubeCamera && this.cubeMesh) {
        // Cube rotation = inverse of main camera's rotation, so the face
        // pointing toward the cube camera matches whichever side of the
        // model the main camera is currently looking from.
        this.cubeMesh.quaternion.copy(this.camera.quaternion).invert();
        this.cubeRenderer.render(this.cubeScene, this.cubeCamera);
      }
    };
    animate();

    // Debug hook for tests.
    (window as any).__cadCamera = {
      worldToScreen: (x: number, y: number, z: number) => {
        const v = new THREE.Vector3(x, y, z).project(this.camera);
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + (v.x + 1) / 2 * rect.width,
          y: rect.top + (1 - v.y) / 2 * rect.height,
        };
      },
    };
  }

  private onResize() {
    const mount = this.mountRef.nativeElement;
    const width = mount.clientWidth;
    const height = mount.clientHeight;
    if (width === 0 || height === 0) return;
    this.updateOrthoFrustum(width, height);
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
    this.selectedSketchMaterial.resolution.set(width, height);
    this.mirrorAxisMaterial.resolution.set(width, height);
    this.hoverSketchMaterial.resolution.set(width, height);
  }

  /** Recompute the orthographic frustum from the canvas aspect ratio +
   * current `orbitDistance` (= half-height of the visible region in
   * world units). Called by onResize and updateCamera. */
  private updateOrthoFrustum(width?: number, height?: number) {
    const w = width ?? this.renderer?.domElement.clientWidth ?? 800;
    const h = height ?? this.renderer?.domElement.clientHeight ?? 600;
    const aspect = w / Math.max(1, h);
    const halfH = this.orbitDistance;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  private updateCamera() {
    let x: number, y: number, z: number;
    if (this.sketchPlaneNormal) {
      // Sketch mode — use the stored plane normal directly. Pan still
      // moves orbitTarget; zoom still moves orbitDistance; orbit drags
      // mutate orbitTheta/orbitPhi but those are ignored here so the
      // view stays pinned to the plane.
      const [ux, uy, uz] = this.sketchPlaneNormal;
      x = this.orbitTarget.x + this.orbitDistance * ux;
      y = this.orbitTarget.y + this.orbitDistance * uy;
      z = this.orbitTarget.z + this.orbitDistance * uz;
    } else {
      const d = orbitDir(this.orbitTheta, this.orbitPhi);
      x = this.orbitTarget.x + this.orbitDistance * d.x;
      y = this.orbitTarget.y + this.orbitDistance * d.y;
      z = this.orbitTarget.z + this.orbitDistance * d.z;
    }
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.orbitTarget);
    // orbitDistance doubles as the ortho zoom level — every camera-state
    // change rescales the frustum to match. Zoom wheel mutates orbitDistance
    // then re-enters here, so this single hook keeps projection in sync.
    if (this.camera.isOrthographicCamera) this.updateOrthoFrustum();
    // Keep sketch points a constant on-screen size, and re-tessellate curves
    // when the zoom changed enough to matter.
    this._scaleSketchPoints();
    this._maybeBumpViewEpoch();
  }

  /** Chord tolerance for sketch curve tessellation at the current zoom: smaller
   * (more segments) when zoomed in, so circles/arcs always look smooth. */
  private sketchChordTol(): number {
    return Math.max(MIN_CHORD_TOL, this.orbitDistance * CHORD_SCREEN_FRAC);
  }

  /** Scale every sketch-entity point sphere to a constant on-screen size for the
   * current zoom (they're built at unit radius + tagged with a screen frac). */
  private _scaleSketchPoints(): void {
    if (!this.sketchGroup) return;
    this.sketchGroup.traverse((o) => {
      const frac = (o.userData as { sketchPointFrac?: number }).sketchPointFrac;
      if (frac) o.scale.setScalar(Math.max(0.05, this.orbitDistance * frac));
    });
  }

  /** Bump viewEpoch when zoom changed enough (±~25%) to re-tessellate curves at
   * the new scale. Throttled so a zoom gesture rebuilds the overlay only a few
   * times, not per wheel tick. */
  private _maybeBumpViewEpoch(): void {
    const base = this.viewEpochDistance || this.orbitDistance;
    const ratio = this.orbitDistance / base;
    if (ratio > 1.25 || ratio < 0.8) {
      this.viewEpochDistance = this.orbitDistance;
      this.viewEpoch.update((v) => v + 1);
    }
  }

  /** Rotate the view 90° about the look axis (in-plane roll), animated. `sign`
   * +1 = CCW, -1 = CW on screen. Persists until the next orbit (resets up). */
  rotateView(sign: 1 | -1) {
    if (this.cubeAnimHandle) cancelAnimationFrame(this.cubeAnimHandle);
    const fwd = new THREE.Vector3().subVectors(this.orbitTarget, this.camera.position).normalize();
    const startUp = this.camera.up.clone();
    const total = sign * Math.PI / 2;
    const durationMs = 380;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.up.copy(startUp).applyAxisAngle(fwd, total * e).normalize();
      this.updateCamera();
      if (t < 1) this.cubeAnimHandle = requestAnimationFrame(step);
      else this.cubeAnimHandle = 0;
    };
    this.cubeAnimHandle = requestAnimationFrame(step);
  }

  // ─── Default view (REQ 708/709) ──────────────────────────────────────────
  // The current camera orientation as a serializable spherical preset.
  currentView(): CadDefaultView {
    return {
      theta: this.orbitTheta,
      phi: this.orbitPhi,
      distance: this.orbitDistance,
      target: [this.orbitTarget.x, this.orbitTarget.y, this.orbitTarget.z],
    };
  }

  /** Orient the camera to the saved default view, or to a framed isometric
   * when none is saved. Leaves sketch mode's pinned-plane view untouched. */
  applyDefaultView() {
    if (this.sketchPlaneNormal) return; // sketch mode pins the view to the plane
    const v = this.defaultView();
    if (v) {
      this.orbitTarget.set(v.target[0], v.target[1], v.target[2]);
      this.orbitDistance = v.distance;
      this.animateOrbitTo(v.theta, v.phi, 480);
    } else {
      // Z-up isometric: φ = true iso tilt (54.7°) from +Z, θ over the front-right (+X,-Y) corner.
      this.animateOrbitTo(-Math.PI / 4, Math.acos(1 / Math.sqrt(3)), 480, this.computeFrame());
    }
  }

  onSaveDefaultView() {
    this.saveDefaultView.emit(this.currentView());
  }

  /** Set which gesture a left-button drag performs in 3D mode. */
  setNav(mode: 'orbit' | 'pan' | 'zoom' | 'select') { this.navMode.set(mode); }

  /** Zoom-to-fit: smoothly re-frame the current view on the whole model (keeps
   * the orientation, incl. the plane-normal lock while sketching). No-op when
   * there's no solid geometry yet. */
  zoomToFit(durationMs = 360) {
    const f = this.computeFrame();
    if (f) this.animateFrameTo(f.center, f.distance, durationMs);
  }

  /** The orbit target + distance that frames the whole model, or null when
   * there's no solid geometry. orbitDistance doubles as the ortho half-height;
   * the 0.75 factor pads so the part doesn't touch the frustum edges. */
  private computeFrame(): { center: THREE.Vector3; distance: number } | null {
    const box = new THREE.Box3().setFromObject(this.faceGroup);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    return { center, distance: Math.max(size.x, size.y, size.z, 1) * 0.75 };
  }

  /** Smoothly tween the orbit target + distance to a framed view (orientation
   * untouched — safe in both 3D and sketch-plane-locked modes). Same cubic
   * ease + rAF handle as the orientation tween, so the two never run at once. */
  private animateFrameTo(center: THREE.Vector3, distance: number, durationMs = 360) {
    if (this.cubeAnimHandle) cancelAnimationFrame(this.cubeAnimHandle);
    const startTarget = this.orbitTarget.clone();
    const startDist = this.orbitDistance;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.orbitTarget.lerpVectors(startTarget, center, e);
      this.orbitDistance = startDist + (distance - startDist) * e;
      this.updateCamera();
      if (t < 1) this.cubeAnimHandle = requestAnimationFrame(step);
      else this.cubeAnimHandle = 0;
    };
    this.cubeAnimHandle = requestAnimationFrame(step);
  }

  /** Render a low-resolution PNG of the model from its default view (or the
   * current view if none saved) for the commit thumbnail. Datum planes and
   * sketch overlays are hidden so the image shows the solid only. Returns a
   * data URL, or null when there is no geometry to capture. */
  captureThumbnail(width = 260, height = 180): string | null {
    if (!this.scene || !this.faceGroup) return null;
    const box = new THREE.Box3().setFromObject(this.faceGroup);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const v = this.defaultView();
    const theta = v ? v.theta : this.orbitTheta;
    const phi = v ? v.phi : this.orbitPhi;
    const dist = Math.max(size.x, size.y, size.z, 1) * 2.2;
    const half = Math.max(size.x, size.y, size.z, 1) * 0.7;
    const aspect = width / height;

    const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, -10000, 10000);
    const td = orbitDir(theta, phi);
    cam.position.set(center.x + dist * td.x, center.y + dist * td.y, center.z + dist * td.z);
    // Match the live view's Z-up convention (Three's default cam up is +Y).
    cam.up.copy(WORLD_UP);
    cam.lookAt(center);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height);

    const datumVis = this.datumGroup ? this.datumGroup.visible : true;
    const sketchVis = this.sketchGroup ? this.sketchGroup.visible : true;
    if (this.datumGroup) this.datumGroup.visible = false;
    if (this.sketchGroup) this.sketchGroup.visible = false;
    let url: string | null = null;
    try {
      renderer.render(this.scene, cam);
      url = renderer.domElement.toDataURL('image/png');
    } catch {
      url = null;
    } finally {
      if (this.datumGroup) this.datumGroup.visible = datumVis;
      if (this.sketchGroup) this.sketchGroup.visible = sketchVis;
      renderer.dispose();
      renderer.forceContextLoss();
    }
    return url;
  }

  // ─── Navigation cube ─────────────────────────────────────────────────────
  // Onshape-style cube widget rendered in its own WebGL context in the
  // top-right overlay. Each face is a labeled shortcut to a canonical view
  // (FRONT/BACK/LEFT/RIGHT/TOP/BOTTOM); clicks animate the main camera's
  // orbitTheta/orbitPhi to the target over ~300ms. The cube itself mirrors
  // the main camera's rotation each frame so it doubles as an orientation
  // indicator.

  private setupNavCube() {
    const mount = this.cubeMountRef.nativeElement;
    const w = mount.clientWidth  || 103;
    const h = mount.clientHeight || 103;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch (err) {
      // The cube is a second WebGL context; if it can't be created (the main
      // viewport got the last available context) just skip it — the 3D view
      // still works without the orientation cube.
      console.error('[cad-viewer] nav cube WebGL unavailable:', err);
      return;
    }
    // setPixelRatio FIRST so the subsequent setSize accounts for it when
    // sizing the internal buffer. setSize with updateStyle=true (default)
    // also sets the canvas's CSS width/height to match the div so the
    // cursor → NDC mapping in cubeHitInfoFromEvent stays accurate. The
    // previous `false` here let the canvas default to 300×150 in CSS,
    // overflowing the 82×82 mount div and offsetting every raycast.
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);  // transparent
    mount.appendChild(renderer.domElement);
    this.cubeRenderer = renderer;

    const scene = new THREE.Scene();
    this.cubeScene = scene;

    // Orthographic camera looking at the cube from +Z. Frustum sized so the
    // beveled cube fills the viewport with a small margin.
    const r = 0.85;
    const cam = new THREE.OrthographicCamera(-r, r, r, -r, 0.1, 10);
    cam.position.set(0, 0, 3);
    cam.lookAt(0, 0, 0);
    this.cubeCamera = cam;

    // 26 individual material slots so we can hover-highlight any single
    // region. Slot order must match the group order produced by
    // buildBeveledCubeGeometry: 6 faces (+X -X +Y -Y +Z -Z), then 12 edges,
    // then 8 corners. Z-up convention: +Z=TOP, -Z=BOTTOM; FRONT=-Y (SW-style
    // front faces the viewer), BACK=+Y; RIGHT=+X, LEFT=-X (right-handed).
    const labels = ['RIGHT', 'LEFT', 'BACK', 'FRONT', 'TOP', 'BOTTOM'];
    const maxAniso = renderer.capabilities.getMaxAnisotropy?.() ?? 1;
    const faceTexture   = labels.map(l => this.makePlainTexture(l, '#3c4055', '#4a5070', '#e6e6e6', maxAniso));
    const edgeTexture   = this.makePlainTexture('', '#2f3245', '#2f3245', '#2f3245', maxAniso);
    const cornerTexture = this.makePlainTexture('', '#262838', '#262838', '#262838', maxAniso);

    this.cubeMaterials = [];
    this.cubeBaseColors = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.MeshBasicMaterial({ map: faceTexture[i] });
      this.cubeMaterials.push(m);
      this.cubeBaseColors.push(m.color.clone());
    }
    // Edges + corners share the same texture but each has its own material
    // instance so hover can tint exactly one region at a time.
    for (let i = 0; i < 12; i++) {
      const m = new THREE.MeshBasicMaterial({ map: edgeTexture });
      this.cubeMaterials.push(m);
      this.cubeBaseColors.push(m.color.clone());
    }
    for (let i = 0; i < 8; i++) {
      const m = new THREE.MeshBasicMaterial({ map: cornerTexture });
      this.cubeMaterials.push(m);
      this.cubeBaseColors.push(m.color.clone());
    }

    const geom = this.buildBeveledCubeGeometry(0.5, 0.15);
    const mesh = new THREE.Mesh(geom, this.cubeMaterials);
    scene.add(mesh);
    this.cubeMesh = mesh;
  }

  /** Build the texture for a face label (or a plain coloured texture when
   * label is empty). Resolution bumped to 256² so labels stay crisp at
   * device pixel ratios up to ~2× the cube's CSS size. */
  private makePlainTexture(label: string, fill: string, centerFill: string,
                            textColor: string, maxAniso: number): THREE.Texture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, size, size);
    if (label) {
      // Subtle border + centre highlight so the cube's face reads as the
      // "primary" target vs the surrounding bevel.
      ctx.fillStyle = centerFill;
      const m = size * 0.18;
      ctx.fillRect(m, m, size - 2 * m, size - 2 * m);
      ctx.strokeStyle = '#1e1e2e';
      ctx.lineWidth = 8;
      ctx.strokeRect(0, 0, size, size);
      ctx.fillStyle = textColor;
      ctx.font = 'bold 44px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, size / 2, size / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAniso;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  /** Build a beveled cube ("chamfered cube") geometry of half-extent `r`
   * with bevel depth `d`. The cube has 26 outer regions:
   *   - 6 central square faces (one per ±X/±Y/±Z direction).
   *   - 12 rectangular edge bevels at 45° between adjacent faces.
   *   - 8 triangular corner bevels at 45° between three adjacent faces.
   *
   * Geometry layout: material slot 0–5 = the six face materials in order
   * +X, -X, +Y, -Y, +Z, -Z (matches the `labels` array in setupNavCube);
   * slot 6 = shared edge material; slot 7 = shared corner material.
   * One group per face + one group covering all edges + one group covering
   * all corners. */
  private buildBeveledCubeGeometry(r: number, d: number): THREE.BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];
    type Group = { start: number; count: number; mat: number };
    const groups: Group[] = [];

    const pushQuad = (v0: [number,number,number], v1: [number,number,number],
                      v2: [number,number,number], v3: [number,number,number],
                      mat: number) => {
      const start = indices.length;
      const base = positions.length / 3;
      positions.push(...v0, ...v1, ...v2, ...v3);
      uvs.push(0, 0,  1, 0,  1, 1,  0, 1);
      indices.push(base, base + 1, base + 2,  base, base + 2, base + 3);
      groups.push({ start, count: 6, mat });
    };
    const pushTri = (v0: [number,number,number], v1: [number,number,number],
                     v2: [number,number,number], mat: number) => {
      const start = indices.length;
      const base = positions.length / 3;
      positions.push(...v0, ...v1, ...v2);
      uvs.push(0.5, 0,  1, 1,  0, 1);
      indices.push(base, base + 1, base + 2);
      groups.push({ start, count: 3, mat });
    };

    const inner = r - d;  // central-face inset

    // ─── 6 central faces (material slots 0..5: +X -X +Y -Y +Z -Z) ───────
    // +X: x = +r, y and z range over [-inner, +inner].
    pushQuad([+r, -inner, -inner], [+r, +inner, -inner], [+r, +inner, +inner], [+r, -inner, +inner], 0);
    // -X: x = -r, mirrored winding so the outward normal still points -X.
    pushQuad([-r, -inner, +inner], [-r, +inner, +inner], [-r, +inner, -inner], [-r, -inner, -inner], 1);
    // +Y
    pushQuad([-inner, +r, +inner], [+inner, +r, +inner], [+inner, +r, -inner], [-inner, +r, -inner], 2);
    // -Y
    pushQuad([-inner, -r, -inner], [+inner, -r, -inner], [+inner, -r, +inner], [-inner, -r, +inner], 3);
    // +Z
    pushQuad([-inner, -inner, +r], [+inner, -inner, +r], [+inner, +inner, +r], [-inner, +inner, +r], 4);
    // -Z
    pushQuad([-inner, +inner, -r], [+inner, +inner, -r], [+inner, -inner, -r], [-inner, -inner, -r], 5);

    // ─── 12 edge bevels (slots 6..17, one per edge) ──────────────────────
    // Each edge bevel is a quad connecting one edge of central face A to
    // one edge of central face B (perpendicular faces sharing the cube
    // edge). Winding is CCW viewed from OUTSIDE (the bevel's outward
    // normal direction) so backface culling doesn't hide the visible
    // surface. Order must match edgeNames[] in setupNavCube.
    // 4 edges sharing ±X with ±Y (vary on Z):
    pushQuad([+r, +inner, -inner], [+inner, +r, -inner], [+inner, +r, +inner], [+r, +inner, +inner],  6); // +X +Y
    pushQuad([+r, -inner, +inner], [+inner, -r, +inner], [+inner, -r, -inner], [+r, -inner, -inner],  7); // +X -Y
    pushQuad([-r, +inner, +inner], [-inner, +r, +inner], [-inner, +r, -inner], [-r, +inner, -inner],  8); // -X +Y
    pushQuad([-r, -inner, -inner], [-inner, -r, -inner], [-inner, -r, +inner], [-r, -inner, +inner],  9); // -X -Y
    // 4 edges sharing ±X with ±Z (vary on Y):
    pushQuad([+r, -inner, +inner], [+r, +inner, +inner], [+inner, +inner, +r], [+inner, -inner, +r], 10); // +X +Z
    pushQuad([+r, +inner, -inner], [+r, -inner, -inner], [+inner, -inner, -r], [+inner, +inner, -r], 11); // +X -Z
    pushQuad([-r, +inner, +inner], [-r, -inner, +inner], [-inner, -inner, +r], [-inner, +inner, +r], 12); // -X +Z
    pushQuad([-r, -inner, -inner], [-r, +inner, -inner], [-inner, +inner, -r], [-inner, -inner, -r], 13); // -X -Z
    // 4 edges sharing ±Y with ±Z (vary on X):
    pushQuad([-inner, +r, +inner], [-inner, +inner, +r], [+inner, +inner, +r], [+inner, +r, +inner], 14); // +Y +Z
    pushQuad([-inner, +r, -inner], [+inner, +r, -inner], [+inner, +inner, -r], [-inner, +inner, -r], 15); // +Y -Z
    pushQuad([-inner, -r, +inner], [+inner, -r, +inner], [+inner, -inner, +r], [-inner, -inner, +r], 16); // -Y +Z
    pushQuad([-inner, -r, -inner], [-inner, -inner, -r], [+inner, -inner, -r], [+inner, -r, -inner], 17); // -Y -Z

    // ─── 8 corner bevels (slots 18..25, one per corner) ──────────────────
    // Each corner triangle has 3 vertices, one displaced from the original
    // cube corner along each of the 3 axes by d. Wound CCW viewed from
    // outward direction (sign(x), sign(y), sign(z)). Order must match
    // cornerNames[] in setupNavCube.
    pushTri([+inner, +r, +inner], [+inner, +inner, +r], [+r, +inner, +inner], 18); // +X +Y +Z
    pushTri([+inner, +r, -inner], [+r, +inner, -inner], [+inner, +inner, -r], 19); // +X +Y -Z
    pushTri([+inner, -r, +inner], [+r, -inner, +inner], [+inner, -inner, +r], 20); // +X -Y +Z
    pushTri([+inner, -r, -inner], [+inner, -inner, -r], [+r, -inner, -inner], 21); // +X -Y -Z
    pushTri([-inner, +r, +inner], [-r, +inner, +inner], [-inner, +inner, +r], 22); // -X +Y +Z
    pushTri([-inner, +r, -inner], [-inner, +inner, -r], [-r, +inner, -inner], 23); // -X +Y -Z
    pushTri([-inner, -r, +inner], [-inner, -inner, +r], [-r, -inner, +inner], 24); // -X -Y +Z
    pushTri([-inner, -r, -inner], [-r, -inner, -inner], [-inner, -inner, -r], 25); // -X -Y -Z

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    // Coalesce all face groups individually + all edges + all corners. Order
    // matters: groups must be added in order of `start`. Since we pushed
    // 6 faces, then 12 edges, then 8 corners in that order, the array is
    // already sorted.
    for (const g of groups) geom.addGroup(g.start, g.count, g.mat);
    return geom;
  }

  onCubePointerDown(ev: PointerEvent) {
    // Start tracking a potential drag. Click handler runs on pointerup if
    // we never crossed the drag threshold; otherwise treat it as an orbit
    // gesture and suppress the click.
    this.cubeDragStart = { x: ev.clientX, y: ev.clientY };
    this.cubeDidDrag = false;
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    ev.stopPropagation();
  }

  onCubePointerMove(ev: PointerEvent) {
    if (this.cubeDragStart) {
      const dx = ev.clientX - this.cubeDragStart.x;
      const dy = ev.clientY - this.cubeDragStart.y;
      if (!this.cubeDidDrag && Math.hypot(dx, dy) > this.CUBE_DRAG_THRESHOLD_PX) {
        this.cubeDidDrag = true;
      }
      if (this.cubeDidDrag) {
        // Horizontal: opposite sign from MMB orbit — dragging the cube
        // right rotates the cube right (face follows finger), which means
        // camera moves left (orbitTheta increases).
        // Vertical: SAME sign as MMB orbit — the canvas convention feels
        // right here too, per user preference.
        this.orbitTheta += dx * 0.005;
        this.orbitPhi   = Math.max(0.05, Math.min(Math.PI - 0.05, this.orbitPhi - dy * 0.005));
        this.updateCamera();
        this.cubeDragStart = { x: ev.clientX, y: ev.clientY };
      }
      return;
    }
    // Not dragging — update hover highlight.
    const slot = this.cubeMaterialSlotFromEvent(ev);
    if (slot !== this.hoveredCubeSlot) this.setHoveredCubeSlot(slot);
  }

  onCubePointerUp(ev: PointerEvent) {
    this.cubeDragStart = null;
    (ev.target as Element).releasePointerCapture?.(ev.pointerId);
    // pointerleave also routes here — clear hover so a stale highlight
    // doesn't stick after the cursor exits.
    if (ev.type === 'pointerleave') this.setHoveredCubeSlot(null);
  }

  /** Raycast against the cube under the cursor and return the material
   * slot of the hit triangle (= the region index 0..25), or null if the
   * pointer isn't over the cube. */
  private cubeMaterialSlotFromEvent(ev: MouseEvent): number | null {
    if (!this.cubeMesh || !this.cubeCamera || !this.cubeRenderer) return null;
    // Use the renderer's canvas rect — the canvas is what the cube is
    // actually drawn on; any size mismatch with the wrapper div would
    // offset every cursor → NDC conversion.
    const rect = this.cubeRenderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
       ((ev.clientX - rect.left) / rect.width)  * 2 - 1,
      -((ev.clientY - rect.top)  / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.cubeCamera);
    const hits = ray.intersectObject(this.cubeMesh, false);
    if (hits.length === 0) return null;
    const mi = hits[0].face?.materialIndex;
    return typeof mi === 'number' ? mi : null;
  }

  /** Brighten the hovered slot's material by 30% (or clear if null).
   * MeshBasicMaterial.color acts as an unclamped multiplier on the
   * texture, so `base * 1.3` brightens the rendered region by 30% over
   * its texture's native colour. Restores the previously-hovered slot's
   * base colour first. */
  private setHoveredCubeSlot(slot: number | null) {
    if (this.hoveredCubeSlot !== null) {
      const prev = this.cubeMaterials[this.hoveredCubeSlot];
      const base = this.cubeBaseColors[this.hoveredCubeSlot];
      if (prev && base) prev.color.copy(base);
    }
    this.hoveredCubeSlot = slot;
    if (slot !== null) {
      const mat = this.cubeMaterials[slot];
      const base = this.cubeBaseColors[slot];
      if (mat && base) mat.color.copy(base).multiplyScalar(1.3);
    }
  }

  onCubeClick(ev: MouseEvent) {
    // If the user just finished a drag-rotate, swallow the click so we
    // don't also jump to a face view.
    if (this.cubeDidDrag) { this.cubeDidDrag = false; return; }
    if (!this.cubeRenderer || !this.cubeScene || !this.cubeCamera || !this.cubeMesh) return;
    // Use the renderer canvas rect, not the wrapper div — same reason
    // as cubeHitInfoFromEvent.
    const rect = this.cubeRenderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
       ((ev.clientX - rect.left) / rect.width)  * 2 - 1,
      -((ev.clientY - rect.top)  / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.cubeCamera);
    const hits = ray.intersectObject(this.cubeMesh, false);
    if (hits.length === 0) return;
    // Convert the world hit point into the cube's local space so we can
    // classify it into a 3×3 cell regardless of the cube's current
    // rotation.
    const local = this.cubeMesh.worldToLocal(hits[0].point.clone());
    const target = this.cubeTargetFromHit(local);
    // A nav-cube view selection (not a drag-rotate) also frames the model:
    // tween the fit target/distance alongside the orientation for a smooth
    // rotate-and-zoom-to-fit.
    this.animateOrbitTo(target.theta, target.phi, 480, this.computeFrame());
  }

  /** REQ 868 — orient to a named view (keyboard shortcuts). Same animated
   * rotate-and-frame as a nav-cube face click. */
  orientToView(view: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso') {
    const dirs: Record<typeof view, [number, number, number]> = {
      front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0],
      top: [0, 0, 1], bottom: [0, 0, -1], iso: [1, -1, 1],
    };
    const [dx, dy, dz] = dirs[view];
    const len = Math.hypot(dx, dy, dz) || 1;
    let { theta, phi } = dirToOrbit(dx / len, dy / len, dz / len);
    if (phi < 0.001) phi = 0.001;
    if (phi > Math.PI - 0.001) phi = Math.PI - 0.001;
    this.animateOrbitTo(theta, phi, 480, this.computeFrame());
  }

  /** Convert a hit point on the beveled cube (in local cube space) to a
   * target (theta, phi). Classification uses the central-face boundary as
   * the threshold: hits inside the central face on a given axis don't
   * contribute that axis to the target direction, hits on a bevel surface
   * do. The axis with the largest |coord| is the "primary" face and
   * always contributes its sign so face-centre hits still produce a
   * canonical orthographic view. Must stay in sync with buildBeveledCube's
   * inner = r - d. */
  private cubeTargetFromHit(local: THREE.Vector3): { theta: number; phi: number } {
    const T = 0.5 - 0.15 - 1e-3;  // central-face half-extent, minus epsilon for float slop
    const absX = Math.abs(local.x), absY = Math.abs(local.y), absZ = Math.abs(local.z);
    const maxAbs = Math.max(absX, absY, absZ);
    // Face-normal axis: always contributes. Other axes contribute when
    // outside the centre cell.
    const axis = (a: number, abs: number) => abs === maxAbs ? Math.sign(a) : (abs > T ? Math.sign(a) : 0);
    let tx = axis(local.x, absX);
    let ty = axis(local.y, absY);
    let tz = axis(local.z, absZ);
    const len = Math.hypot(tx, ty, tz) || 1;
    tx /= len; ty /= len; tz /= len;
    // Spherical (Z-up): phi from +Z axis, theta the azimuth in the XY plane.
    let { theta, phi } = dirToOrbit(tx, ty, tz);
    if (phi < 0.001)           phi = 0.001;
    if (phi > Math.PI - 0.001) phi = Math.PI - 0.001;
    return { theta, phi };
  }

  /** Smoothly tween orbitTheta/orbitPhi to the target over `durationMs`.
   * Cancels any in-flight cube animation. Uses a simple cubic ease-in-out
   * so face transitions feel intentional rather than mechanical. */
  private animateOrbitTo(targetTheta: number, targetPhi: number, durationMs: number,
                          frame?: { center: THREE.Vector3; distance: number } | null) {
    if (this.cubeAnimHandle) cancelAnimationFrame(this.cubeAnimHandle);
    const startTheta = this.orbitTheta;
    const startPhi   = this.orbitPhi;
    // Optional simultaneous zoom-to-fit tween (nav-cube view selection).
    const startTarget = this.orbitTarget.clone();
    const startDist   = this.orbitDistance;
    // Target up-vector. For non-pole targets the turntable up (world +Z) is
    // correct. At the poles (Top/Bottom) world-Z is parallel to the look
    // direction and gimbal-locks to an arbitrary roll — so use a fixed
    // horizontal up that yields the canonical, axis-aligned view:
    //   Top    (phi→0) → +Y up  (standard: looking down -Z, +X right, +Y up)
    //   Bottom (phi→π) → -Y up
    const su = this.camera.up.clone();
    const tu = targetPhi < 0.01
      ? new THREE.Vector3(0, 1, 0)
      : targetPhi > Math.PI - 0.01
        ? new THREE.Vector3(0, -1, 0)
        : WORLD_UP.clone();
    // Shortest-arc theta: pick whichever direction (±) is closer.
    let deltaTheta = targetTheta - startTheta;
    while (deltaTheta >  Math.PI) deltaTheta -= 2 * Math.PI;
    while (deltaTheta < -Math.PI) deltaTheta += 2 * Math.PI;
    const deltaPhi = targetPhi - startPhi;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // cubic ease-in-out
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.orbitTheta = startTheta + deltaTheta * e;
      this.orbitPhi   = startPhi   + deltaPhi   * e;
      // Tween the up-vector alongside so pole views land on a well-defined up
      // (set before updateCamera, whose lookAt reuses camera.up).
      this.camera.up.set(
        su.x + (tu.x - su.x) * e,
        su.y + (tu.y - su.y) * e,
        su.z + (tu.z - su.z) * e,
      ).normalize();
      if (frame) {
        this.orbitTarget.lerpVectors(startTarget, frame.center, e);
        this.orbitDistance = startDist + (frame.distance - startDist) * e;
      }
      this.updateCamera();
      if (t < 1) this.cubeAnimHandle = requestAnimationFrame(step);
      else { this.camera.up.copy(tu); this.updateCamera(); this.cubeAnimHandle = 0; }
    };
    this.cubeAnimHandle = requestAnimationFrame(step);
  }

  private onPointerDown = (ev: PointerEvent) => {
    this.lastPointer = { x: ev.clientX, y: ev.clientY };
    this.didNavDrag = false;
    const inSketch = this.activeSketchId() !== null;
    // SolidWorks-style input map. MMB is the navigation button in both
    // 3D and sketch modes:
    //   MMB              = orbit
    //   Shift + MMB      = pan
    //   Ctrl  + MMB drag = zoom (drag down zooms in, up zooms out)
    //   Wheel            = zoom at cursor
    //   LMB (3D)         = select (dispatched by onClick)
    //   LMB (sketch)     = sketch tool action
    //   RMB (3D)         = feature context menu (onContextMenu)
    //   RMB (sketch)     = no-op (context menu suppressed in sketch mode)
    if (ev.button === 1) {
      if (ev.shiftKey) this.panning = true;
      else if (ev.ctrlKey || ev.metaKey) this.zoomDragging = true;
      else this.orbiting = true;
    } else if (ev.button === 0 && !inSketch) {
      // CAD-782: in assembly mode, a left press on a draggable component arms a
      // drag candidate (it translates the component) instead of orbiting. A
      // press on a NON-draggable component just selects (no orbit) — only a
      // press on empty space falls through to orbit the camera.
      if (this.assemblyDrag()) {
        this.updatePointer(ev);
        const id = this.pickFeatureInfo(ev).featureId;
        if (id) {
          if (this.draggableInstanceIds().has(id)) {
            this.dragCandidate = { instanceId: id, startX: ev.clientX, startY: ev.clientY };
            (ev.target as Element).setPointerCapture?.(ev.pointerId);
          }
          // Pressed on a component (draggable or not): don't orbit. onClick
          // still fires for selection.
          return;
        }
      }
      // Left-drag navigates per the active nav-mode button; a click (no drag)
      // still falls through to onClick for selection.
      const m = this.navMode();
      if (m === 'select' && ev.pointerType !== 'touch') {
        // REQ 867 — arm the box-selection marquee (engages past a small
        // threshold in pointermove; a plain click still selects normally).
        this.marquee = { startX: ev.clientX, startY: ev.clientY, curX: ev.clientX, curY: ev.clientY, active: false, shiftKey: ev.shiftKey };
      }
      else if (m === 'pan') this.panning = true;
      else if (m === 'zoom') this.zoomDragging = true;
      else if (m === 'orbit') this.orbiting = true;
      else this.orbiting = true;  // touch in select mode keeps one-finger orbit
    } else if (ev.button === 0 && inSketch) {
      const p = this.toSketchCoords(ev);
      if (p) {
        const tolerance = this.pixelsToSketchUnits(this.PICK_PX);
        const pointTolerance = this.pixelsToSketchUnits(this.POINT_PICK_PX);
        this.zone.run(() => this.sketchPointerDown.emit({ ...p, tolerance, pointTolerance }));
      }
    }
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  };

  private onPointerMove = (ev: PointerEvent) => {
    // Two-finger touch gesture owns the camera — ignore the pointer stream it
    // also emits (onTouchMove does the zoom/pan).
    if (this.touchNav === 'multi') return;
    const dx = ev.clientX - this.lastPointer.x;
    const dy = ev.clientY - this.lastPointer.y;
    this.lastPointer = { x: ev.clientX, y: ev.clientY };
    if ((this.orbiting || this.panning || this.zoomDragging) && (dx || dy)) this.didNavDrag = true;
    // REQ 867 — box-selection marquee tracking (select nav mode).
    if (this.marquee) {
      this.marquee.curX = ev.clientX;
      this.marquee.curY = ev.clientY;
      if (!this.marquee.active
        && Math.hypot(ev.clientX - this.marquee.startX, ev.clientY - this.marquee.startY) > 4) {
        this.marquee.active = true;
        this.didNavDrag = true;  // suppress the follow-up click selection
      }
      if (this.marquee.active) {
        const host = this.renderer.domElement.getBoundingClientRect();
        this.zone.run(() => this.marqueeSig.set({
          left: Math.min(this.marquee!.startX, this.marquee!.curX) - host.left,
          top: Math.min(this.marquee!.startY, this.marquee!.curY) - host.top,
          width: Math.abs(this.marquee!.curX - this.marquee!.startX),
          height: Math.abs(this.marquee!.curY - this.marquee!.startY),
          crossing: this.marquee!.curX < this.marquee!.startX,
        }));
      }
      return;
    }
    // CAD-782: assembly component drag takes priority over the nav gestures
    // (which are never armed while a drag candidate is active).
    if (this.dragCandidate) {
      const cand = this.dragCandidate;
      const totalDx = ev.clientX - cand.startX;
      const totalDy = ev.clientY - cand.startY;
      if (this.dragActiveInstanceId || exceedsDragThreshold(totalDx, totalDy)) {
        if (!this.dragActiveInstanceId) {
          this.dragActiveInstanceId = cand.instanceId;
          // Edges aren't tagged per instance, so suppress the whole edge layer
          // during the drag to avoid a ghost outline trailing the moved faces;
          // it's restored from the regen rebuild on release.
          this.edgeGroup.visible = false;
          this.didNavDrag = true; // suppress the trailing click-select
        }
        const delta = this.dragWorldDelta(totalDx, totalDy);
        this.offsetDraggedInstance(delta);
      }
      return;
    }
    if (this.orbiting) {
      // Orbiting in sketch mode RELEASES the head-on pin so the user can 3D-
      // rotate freely (the "Normal to" button re-orients to the sketch normal).
      // orbitTheta/Phi were synced to the plane normal on sketch entry, so the
      // free-orbit continues smoothly from the head-on orientation.
      this.sketchPlaneNormal = null;
      // Free orbit is a world-Z-up turntable. Re-establish +Z up when orbiting
      // away from a canonical pole view (Top/Bottom, which set a horizontal ±Y
      // up). GUARD against the poles: near ±Z the world-up is ~parallel to the
      // view direction, so copying it would make `lookAt` degenerate and snap
      // the roll to an arbitrary angle — the "view jumps when I rotate after
      // exiting a Top/Bottom sketch" bug. Only re-establish once tilted enough.
      if (this.camera.up.z < 0.999 && this.orbitPhi > 0.3 && this.orbitPhi < Math.PI - 0.3) {
        this.camera.up.copy(WORLD_UP);
      }
      // Horizontal drag rotates the model the SAME direction the cursor
      // moves (drag right → model spins right). Vertical drag tilts up
      // (drag up → top of model toward camera). Sign is negative under the
      // Z-up azimuth (theta winds CCW-from-top, opposite the old Y-up frame),
      // so `-= dx` keeps "drag right → spins right".
      this.orbitTheta -= dx * 0.005;
      this.orbitPhi = Math.max(0.05, Math.min(Math.PI - 0.05, this.orbitPhi - dy * 0.005));
      this.updateCamera();
    } else if (this.panning) {
      const k = this.orbitDistance * 0.0015;
      const cam = this.camera;
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
      this.orbitTarget.addScaledVector(right, -dx * k);
      this.orbitTarget.addScaledVector(up, dy * k);
      this.updateCamera();
    } else if (this.zoomDragging) {
      // Ctrl+MMB drag: dragging DOWN moves the camera CLOSER (zoom in),
      // dragging UP moves it AWAY (zoom out). Same convention as SW.
      const factor = Math.exp(-dy * 0.01);
      this.orbitDistance = Math.max(5, Math.min(2000, this.orbitDistance * factor));
      this.updateCamera();
    } else if (this.activeSketchId() !== null) {
      // In a sketch we still drive the 3D pick hover so the user sees the
      // edge/face under the cursor (edge-pick edges, and — for plain hover or
      // face-pick — the hovered face's boundary EDGES, not the face fill). Run
      // it BEFORE emitting the sketch move so the sketch tool co-exists.
      this.updatePointer(ev);
      this.updateHover();
      const p = this.toSketchCoords(ev);
      if (p) {
        // Zoom-adaptive pick tolerances — sent every move so the hover pick
        // tracks the current zoom (matching the drawn influence outlines)
        // instead of using a stale fixed value from the last click.
        const tolerance = this.pixelsToSketchUnits(this.PICK_PX);
        const pointTolerance = this.pixelsToSketchUnits(this.POINT_PICK_PX);
        // The projected-edge hover buffer in sketch units, so the editor can
        // compare a sketch entity against a model edge in the SAME metric and
        // keep only the closest highlighted.
        const edgeTolerance = this.pixelsToSketchUnits(this.SKETCH_EDGE_HOVER_PX);
        this.zone.run(() => this.sketchPointerMove.emit({ ...p, tolerance, pointTolerance, edgeTolerance }));
      }
    } else {
      this.updatePointer(ev);
      this.updateHover();
    }
  };

  private onPointerUp = (ev: PointerEvent) => {
    // REQ 867 — finish a box selection: resolve an engaged marquee; a
    // sub-threshold press-release falls through to onClick for plain select.
    if (this.marquee) {
      const m = this.marquee;
      this.marquee = null;
      this.zone.run(() => this.marqueeSig.set(null));
      if (m.active) {
        m.curX = ev.clientX; m.curY = ev.clientY;
        this.resolveMarquee(m);
        (ev.target as Element).releasePointerCapture?.(ev.pointerId);
        return;
      }
    }
    // CAD-783: finish an assembly component drag — emit the final world delta
    // for the editor to persist + re-solve. A candidate that never engaged a
    // drag (press-release under threshold) falls through to onClick for select.
    if (this.dragCandidate) {
      const cand = this.dragCandidate;
      const activeId = this.dragActiveInstanceId;
      this.dragCandidate = null;
      this.dragActiveInstanceId = null;
      (ev.target as Element).releasePointerCapture?.(ev.pointerId);
      if (activeId) {
        const delta = this.dragWorldDelta(ev.clientX - cand.startX, ev.clientY - cand.startY);
        // Optimistic hold: keep the dragged faces at the drop position (their
        // live mesh offset) and keep the stale edge layer hidden until the
        // regen result arrives — syncGeometry rebuilds both with the solved
        // placement and restores edge visibility.
        this.zone.run(() => this.instanceDragEnd.emit({ instanceId: activeId, delta }));
      }
      return;
    }
    if (this.activeSketchId() !== null && ev.button === 0) {
      const p = this.toSketchCoords(ev);
      if (p) this.zone.run(() => this.sketchPointerUp.emit(p));
    }
    this.orbiting = false;
    this.panning = false;
    this.zoomDragging = false;
    (ev.target as Element).releasePointerCapture?.(ev.pointerId);
  };

  // REQ 616 — convert a screen-space mouse event to 2D coords on the active
  // sketch's host plane. Returns null if the pointer ray misses the plane (e.g.
  // sketch plane is edge-on to the camera).
  /**
   * Convert a pixel count on screen to sketch-plane world units at the
   * current camera distance. Used by the editor's pickEntity calls so the
   * pick tolerance stays fixed in PIXELS (consistent feel regardless of
   * zoom) instead of fixed in sketch units (microscopic when zoomed in,
   * giant when zoomed out).
   */
  private pixelsToSketchUnits(pixels: number): number {
    if (!this.camera || !this.renderer) return pixels;
    const canvasH = this.renderer.domElement.clientHeight || 1;
    // Orthographic: visible world height = top − bottom = 2 * orbitDistance.
    // No camera-distance factor (parallel rays).
    const visibleH = this.camera.top - this.camera.bottom;
    return (pixels / canvasH) * visibleH;
  }

  /** Standard pick-radius for general entity picking, in pixels. */
  private readonly PICK_PX = 5;
  /** Larger pick-radius for points specifically — points are small visual
   * targets, so a slightly bigger dead-zone around each point matches
   * user intent (clicks near a point grab the point, not a passing line). */
  private readonly POINT_PICK_PX = 8;
  /** Edge-hover buffer in sketch mode: when the cursor is within this many
   * pixels of a model edge, the SINGLE edge highlights (preferred over the
   * face's whole-boundary highlight). Wider than the general pick radius so a
   * cursor near — or just past — the face silhouette still grabs the edge
   * rather than dropping the highlight entirely. */
  private readonly SKETCH_EDGE_HOVER_PX = 14;

  private toSketchCoords(ev: MouseEvent): { x: number; y: number } | null {
    const sketchId = this.activeSketchId();
    if (!sketchId) return null;
    const sketch = this.sketchDoc()?.sketches[sketchId];
    if (!sketch) return null;
    this.updatePointer(ev);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const normal = new THREE.Vector3(...sketch.plane.normal).normalize();
    const origin = new THREE.Vector3(...sketch.plane.origin);
    const ray = this.raycaster.ray;
    const denom = ray.direction.dot(normal);
    // Only a ray exactly parallel to the plane (a truly edge-on view) cannot
    // project. Otherwise intersect the INFINITE line and allow t<0: this is an
    // orthographic camera with a symmetric -5000/+5000 clip range, so it
    // renders the sketch on BOTH sides of the camera position. Zooming in can
    // drift the camera onto the far side of the sketch plane (plane "behind"
    // the ray origin) — the sketch is still visible and editable, so picking
    // must still map. THREE.Ray.intersectPlane rejects t<0 (correct for a
    // perspective pick, wrong for a parallel projection onto an unbounded
    // plane); that rejection was the "cursor freezes when zoomed in" bug.
    if (Math.abs(denom) < 1e-9) return null;
    const t = origin.clone().sub(ray.origin).dot(normal) / denom;
    const offset = ray.origin.clone().addScaledVector(ray.direction, t).sub(origin);
    const xAxis = new THREE.Vector3(...sketch.plane.xAxis);
    const yAxis = new THREE.Vector3(...sketch.plane.yAxis);
    return { x: offset.dot(xAxis), y: offset.dot(yAxis) };
  }

  /** CAD-782: total screen-pixel delta since drag start → world translation in
   * the camera view plane, using the camera's right/up basis at the current
   * orbit distance (units-per-pixel = visible world height / canvas height). */
  private dragWorldDelta(totalDx: number, totalDy: number): [number, number, number] {
    const unitsPerPixel = this.pixelsToSketchUnits(1);
    const m = this.camera.matrix;
    const right = new THREE.Vector3().setFromMatrixColumn(m, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(m, 1).normalize();
    return screenDeltaToWorld(
      totalDx, totalDy,
      [right.x, right.y, right.z], [up.x, up.y, up.z],
      unitsPerPixel,
    );
  }

  /** CAD-782: live-offset every face mesh of the dragged component by `delta`
   * (world units). Faces carry `userData.featureId === instanceId` in assembly
   * mode. Pass [0,0,0] to clear before the regen rebuild on release. */
  private offsetDraggedInstance(delta: [number, number, number]): void {
    const id = this.dragActiveInstanceId;
    if (!id) return;
    for (const mesh of this.faceMeshes.values()) {
      if ((mesh.userData as { featureId?: string | null }).featureId === id) {
        mesh.position.set(delta[0], delta[1], delta[2]);
      }
    }
  }

  // ── Touch navigation (mobile) ───────────────────────────────────────────────
  // 1 finger = orbit (3D mode), 2 fingers = pinch-zoom + drag-to-pan. Pointer
  // events also fire for touch, so we cancel/guard those for the multi-touch
  // gesture and let one-finger taps still select (touchMoved gates that).
  private onTouchStart = (ev: TouchEvent) => {
    if (ev.touches.length === 2) {
      ev.preventDefault();
      this.touchNav = 'multi';
      this.touchMoved = false;
      // Cancel anything the first finger's pointer events started.
      this.orbiting = this.panning = this.zoomDragging = false;
      this.dragCandidate = null;
      const a = ev.touches[0], b = ev.touches[1];
      this.lastPinchDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      this.lastPinchMid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    }
    // One-finger touch is deliberately NOT handled here: the canvas has
    // touch-action:none, so the browser still synthesizes pointer events for
    // it and the onPointerDown/Move path already orbits (and tap-selects).
    // Handling it here too applied every orbit delta TWICE (double-speed
    // rotation). Single-finger sketching likewise stays on the pointer path.
  };

  private onTouchMove = (ev: TouchEvent) => {
    if (this.touchNav === 'multi' && ev.touches.length === 2) {
      ev.preventDefault();
      this.touchMoved = true;
      const a = ev.touches[0], b = ev.touches[1];
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
      // Pinch → zoom (fingers apart = zoom in).
      if (this.lastPinchDist > 0 && dist > 0) {
        this.orbitDistance = Math.max(5, Math.min(2000, this.orbitDistance * (this.lastPinchDist / dist)));
      }
      // Two-finger drag (midpoint movement) → pan. 1:1 with the fingers: the
      // ortho frustum half-height is orbitDistance (see updateOrthoFrustum), so
      // the visible world height is 2·orbitDistance and world-per-pixel is that
      // over the canvas height. (The fixed 0.0015 MMB factor under-moves badly on
      // a short mobile canvas — this tracks the fingers at any screen size.)
      const dx = mx - this.lastPinchMid.x, dy = my - this.lastPinchMid.y;
      const hPx = this.renderer?.domElement.clientHeight || 600;
      const k = (2 * this.orbitDistance) / hPx;
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
      this.orbitTarget.addScaledVector(right, -dx * k);
      this.orbitTarget.addScaledVector(up, dy * k);
      this.lastPinchDist = dist;
      this.lastPinchMid = { x: mx, y: my };
      this.updateCamera();
    }
  };

  private onTouchEnd = (ev: TouchEvent) => {
    // A real pinch/pan drag must not also fire a tap-select.
    if (this.touchMoved) this.didNavDrag = true;
    if (ev.touches.length >= 2) {
      // 3→2 fingers: keep the gesture but RE-SEED the pinch baseline from the
      // remaining pair — the stale distance/midpoint from before the lift
      // would otherwise apply a zoom/pan jump on the next move.
      const a = ev.touches[0], b = ev.touches[1];
      this.lastPinchDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      this.lastPinchMid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
      this.touchNav = 'multi';
    } else {
      this.touchNav = 'none';  // 0 or 1 finger left — gesture over
    }
  };

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    // REQ 873: per-user wheel-direction preference flips the sign.
    const dy = this.invertZoom() ? -ev.deltaY : ev.deltaY;
    const factor = dy > 0 ? 1.1 : 1 / 1.1;
    const next = Math.max(5, Math.min(2000, this.orbitDistance * factor));
    const applied = next / this.orbitDistance;  // actual scale after clamping
    // Cursor-anchored zoom (SolidWorks-style): shift orbitTarget within the view
    // plane so the world point under the cursor stays put on screen. For an
    // orthographic camera the target plane spans ±halfW·right ±halfH·up around
    // the target, so to hold a point at NDC (nx,ny) fixed while the half-extents
    // scale by `applied`, move the target by (1-applied)·(nx·halfW·R + ny·halfH·U).
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    const aspect = rect.width / Math.max(1, rect.height);
    const halfH = this.orbitDistance;          // before zoom
    const halfW = halfH * aspect;
    this.camera.updateMatrixWorld();
    const e = this.camera.matrixWorld.elements;
    const k = 1 - applied;
    const sx = nx * halfW * k, sy = ny * halfH * k;
    this.orbitTarget.x += e[0] * sx + e[4] * sy;  // camera right + up (world basis)
    this.orbitTarget.y += e[1] * sx + e[5] * sy;
    this.orbitTarget.z += e[2] * sx + e[6] * sy;
    this.orbitDistance = next;
    this.updateCamera();
  };

  /** SolidWorks-style arrow-key view rotation. Plain arrow = 15°, Shift +
   * arrow = 90°. Directions match the viewport MMB-orbit convention (Z-up):
   * Right rotates the view right (orbitTheta decreases, same as dragging the
   * canvas rightward), Up tilts phi up. Skipped when focus is in a text input
   * so typed text doesn't also rotate the model. */
  @HostListener('document:keydown', ['$event'])
  onViewerKeydown(ev: KeyboardEvent) {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const step = ev.shiftKey ? Math.PI / 2 : Math.PI / 12;
    let dTheta = 0, dPhi = 0;
    switch (ev.key) {
      case 'ArrowLeft':  dTheta = +step; break;
      case 'ArrowRight': dTheta = -step; break;
      case 'ArrowUp':    dPhi   = +step; break;
      case 'ArrowDown':  dPhi   = -step; break;
      default: return;
    }
    ev.preventDefault();  // stop arrows from also scrolling the surrounding page
    const targetTheta = this.orbitTheta + dTheta;
    const targetPhi   = Math.max(0.05, Math.min(Math.PI - 0.05, this.orbitPhi + dPhi));
    this.animateOrbitTo(targetTheta, targetPhi, 340);
  }

  private onClick = (ev: MouseEvent) => {
    // A left-drag that navigated (orbit/pan/zoom) must not also select.
    if (this.didNavDrag) { this.didNavDrag = false; return; }
    // REQ 616: in sketch mode the click dispatches to the sketch toolbar's click
    // handler with 2D plane coords; selection of 3D faces/datums is paused…
    // EXCEPT when a 3D edge/face picker is armed (Convert Entities, etc.) —
    // those need to reach the 3D raycaster so the user can click on the
    // body's geometry while the sketch is active.
    if (this.activeSketchId() !== null) {
      this.updatePointer(ev);
      // Cross-part Convert Entities (in-context): a reference VERTEX is a small
      // target — check it first so aiming at one wins over the edge behind it.
      if (this.edgePickMode()) {
        const cpv = this._pickReferenceVertex();
        if (cpv) { this.zone.run(() => this.crossPartVertexPicked.emit(cpv)); return; }
      }
      // Edge-pick under sketch — Convert Entities projects a body edge (local)
      // or another component's edge (cross-part) onto the sketch plane.
      if (this.edgePickMode()) {
        const prevThreshold = this.raycaster.params.Line?.threshold ?? 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        // Match the wider sketch-mode edge HOVER buffer so a click selects the
        // same edge the highlight previewed near a face boundary.
        this.raycaster.params.Line = { threshold: this.pixelsToSketchUnits(this.SKETCH_EDGE_HOVER_PX) };
        const candidates: THREE.Object3D[] = [];
        for (const set of this.faceEdges.values()) {
          if ((set.front.userData as { edgeId?: string }).edgeId) candidates.push(set.front);
        }
        if (this.referenceGroup) {
          for (const o of this.referenceGroup.children) {
            if ((o.userData as { overlayEdge?: OverlayEdge }).overlayEdge) candidates.push(o);
          }
        }
        const hits = this.raycaster.intersectObjects(candidates, false);
        this.raycaster.params.Line = { threshold: prevThreshold };
        // Defer to the sketch click when a sketch entity is the hover winner —
        // selecting a line drawn ON an edge must select the line, matching the
        // highlight (Select mode). Convert leaves preferSketchOverEdgePick false.
        if (hits.length > 0 && !this.preferSketchOverEdgePick()) {
          const ud = hits[0].object.userData as {
            edgeRecord?: { edgeId: string; isStraight: boolean; endpoints: [[number, number, number], [number, number, number]]; polylineLength: number };
            overlayEdge?: OverlayEdge;
          };
          if (ud.overlayEdge) { this.zone.run(() => this.crossPartEdgePicked.emit(ud.overlayEdge!)); return; }
          if (ud.edgeRecord) { this.zone.run(() => this.edgePicked.emit(ud.edgeRecord!)); return; }
        }
        // Edge picker armed but no hit — fall through to sketch click
        // so the user can still draw / select on the sketch plane.
      }
      // Face-pick under sketch — projects all of a face's boundary edges
      // (local) or another component's face's boundary (cross-part).
      if (this.facePickMode()) {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const faceCandidates: THREE.Object3D[] = [...this.faceGroup.children];
        if (this.referenceGroup) {
          for (const o of this.referenceGroup.children) {
            if ((o.userData as { overlayFace?: OverlayFace }).overlayFace) faceCandidates.push(o);
          }
        }
        const hits = this.raycaster.intersectObjects(faceCandidates, false);
        if (hits.length > 0) {
          const hit = hits[0];
          const ud = hit.object.userData as { faceId?: string; overlayFace?: OverlayFace };
          if (ud.overlayFace) { this.zone.run(() => this.crossPartFacePicked.emit(ud.overlayFace!)); return; }
          if (ud.faceId) {
            const p = hit.point;
            const n = hit.face?.normal
              ? hit.face.normal.clone().transformDirection((hit.object as THREE.Object3D).matrixWorld).normalize()
              : new THREE.Vector3(0, 0, 1);
            this.zone.run(() => {
              this.facePicked.emit(ud.faceId!);
              this.facePickedAt.emit({ faceId: ud.faceId!, point: [p.x, p.y, p.z], normal: [n.x, n.y, n.z] });
            });
            return;
          }
        }
      }
      const p = this.toSketchCoords(ev);
      if (p) {
        const tolerance = this.pixelsToSketchUnits(this.PICK_PX);
        const pointTolerance = this.pixelsToSketchUnits(this.POINT_PICK_PX);
        // REQ 871: Ctrl (or Cmd) extends the sketch selection like Shift.
        this.zone.run(() => this.sketchClick.emit({ x: p.x, y: p.y, shiftKey: ev.shiftKey || ev.ctrlKey || ev.metaKey, tolerance, pointTolerance }));
      }
      return;
    }
    this.updatePointer(ev);
    // Vertex picker runs first when armed. Originally vertex-pick was
    // exclusive (return on miss), but the Measure tool arms vertex +
    // edge + face simultaneously and expects misses to fall through to
    // the next picker. So we only `return` on hit OR when no other
    // pick mode is also armed — matches the edge→face fall-through
    // pattern below.
    if (this.vertexPickMode()) {
      const vid = this.pickVertex();
      if (vid !== null) {
        // Look up the vertex's world position from the pick mesh,
        // and probe the face under the cursor for an axis hint.
        const vMesh = this.vertexPickMeshes.get(vid);
        const vPos: [number, number, number] = vMesh
          ? [vMesh.position.x, vMesh.position.y, vMesh.position.z]
          : [0, 0, 0];
        let faceNormal: [number, number, number] | undefined;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const faceHits = this.raycaster.intersectObjects(this.faceGroup.children, false);
        if (faceHits.length > 0 && faceHits[0].face?.normal) {
          const n = faceHits[0].face.normal.clone()
            .transformDirection((faceHits[0].object as THREE.Object3D).matrixWorld)
            .normalize();
          faceNormal = [n.x, n.y, n.z];
        }
        this.zone.run(() => {
          this.vertexPicked.emit(vid);
          this.vertexPickedAt.emit({ vertexId: vid, position: vPos, ...(faceNormal ? { faceNormal } : {}) });
        });
        return;
      }
      if (!this.edgePickMode() && !this.facePickMode() && !this.axisPickMode()) return;
    }
    // Edge picker runs BEFORE face picker so that with both modes active
    // (blend sidebar that supports face → edges expansion), clicking
    // directly on an edge wins, while clicking on empty face area falls
    // through to the face picker below.
    if (this.edgePickMode()) {
      const prevThreshold = this.raycaster.params.Line?.threshold ?? 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      this.raycaster.params.Line = { threshold: this.pixelsToSketchUnits(this.PICK_PX) };  // zoom-adaptive: constant on-screen edge-pick zone
      const candidates: THREE.Object3D[] = [];
      for (const set of this.faceEdges.values()) {
        if ((set.front.userData as { edgeId?: string }).edgeId) candidates.push(set.front);
      }
      const hits = this.raycaster.intersectObjects(candidates, false);
      this.raycaster.params.Line = { threshold: prevThreshold };
      if (hits.length > 0) {
        const ud = hits[0].object.userData as { edgeRecord?: { edgeId: string; isStraight: boolean; endpoints: [[number, number, number], [number, number, number]]; polylineLength: number } };
        if (ud.edgeRecord) this.zone.run(() => this.edgePicked.emit(ud.edgeRecord!));
        return;
      }
      // Edge mode armed but no edge hit — fall through to face/axis
      // picks below if those modes are also active (blend-sidebar case).
      if (!this.facePickMode() && !this.axisPickMode()) return;
    }
    // Face picker — raycast against faceGroup only. Self-face filtering
    // was here briefly but had to be removed: after a merging extrude
    // fuses into an existing body, OCCT re-tags upstream faces with the
    // merging feature's id, so the filter would block legitimate picks
    // of pre-existing geometry. The editor now ships a fallback plane
    // alongside the faceId so the backend can resolve the target by
    // geometry when the upstream-faceMap lookup misses.
    if (this.facePickMode()) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.faceGroup.children, false);
      // Datum picking: a component datum plane/axis/origin can also be a mate
      // reference (emitted as a face-style `instanceId::datumId` ref).
      const datumHits = this.datumGroup ? this.raycaster.intersectObjects(this.datumGroup.children, true) : [];
      const faceD = hits.length ? hits[0].distance : Infinity;
      const datumD = datumHits.length ? datumHits[0].distance : Infinity;
      if (datumHits.length && datumD <= faceD) {
        const ref = this.componentDatumFaceRef(this.datumIdOfObject(datumHits[0].object));
        if (ref) {
          const p = datumHits[0].point;
          this.zone.run(() => {
            this.facePicked.emit(ref);
            this.facePickedAt.emit({ faceId: ref, point: [p.x, p.y, p.z], normal: [0, 0, 1] });
          });
          return;
        }
      }
      if (hits.length > 0) {
        const hit = hits[0];
        const fid = (hit.object.userData as { faceId?: string }).faceId;
        if (fid) {
          const p = hit.point;
          const n = hit.face?.normal
            ? hit.face.normal.clone().transformDirection((hit.object as THREE.Object3D).matrixWorld).normalize()
            : new THREE.Vector3(0, 0, 1);
          this.zone.run(() => {
            this.facePicked.emit(fid);
            this.facePickedAt.emit({ faceId: fid, point: [p.x, p.y, p.z], normal: [n.x, n.y, n.z] });
          });
        }
      }
      return;
    }
    // Axis picker — Revolve sidebar. Raycast against axis-pick overlay
    // only; sketch/face/datum picks are suppressed while this mode is on.
    if (this.axisPickMode()) {
      const aid = this.pickAxis();
      if (aid !== null) this.zone.run(() => this.axisPicked.emit(aid));
      return;
    }
    // Profile-region picker wins over face picks when the Extrude sidebar is
    // open. Without this, a click on a fill that overlaps a face would
    // select the underlying face and miss the region toggle.
    const fillIndex = this.pickProfileFill();
    if (fillIndex !== null) {
      this.zone.run(() => this.profileFillClick.emit(fillIndex));
      return;
    }
    // When region-picker overlays exist (Extrude sidebar open), the click
    // is committed to that mode: missing a fill is a no-op, not a fall-
    // through to selecting model faces or datums. Avoids the user
    // accidentally selecting a face behind the canvas while trying to
    // pick a region.
    if (this.profileFills().length > 0) return;
    // REQ 870 — Alt+click cycles through every hit under the cursor along
    // the ray (Select Other): occluded faces and body-covered datum planes
    // become reachable. Repeated Alt+clicks near the same spot advance and
    // wrap; the feature-level multi-select emit is skipped so the cycled
    // pick isn't clobbered by the top face's feature.
    if (ev.altKey) {
      const all = this.pickEntityAll();
      if (all.length === 0) {
        this.selectOtherCycle = null;
        this.zone.run(() => this.selectionChange.emit(null));
        return;
      }
      const near = this.selectOtherCycle
        && Math.hypot(ev.clientX - this.selectOtherCycle.x, ev.clientY - this.selectOtherCycle.y) < 5;
      const index = near ? (this.selectOtherCycle!.index + 1) % all.length : 0;
      this.selectOtherCycle = { x: ev.clientX, y: ev.clientY, index };
      this.zone.run(() => this.selectionChange.emit(all[index]));
      return;
    }
    this.selectOtherCycle = null;
    const id = this.pickEntity();
    // REQ 623 — emit both the legacy face-id selection (for datum + pick-plane
    // flows) and the new featureClick (for feature-level multi-select).
    this.zone.run(() => this.selectionChange.emit(id));
    this.zone.run(() => this.featureClick.emit(this.pickFeatureInfo(ev)));
  };

  private onContextMenu = (ev: MouseEvent) => {
    ev.preventDefault();
    if (this.activeSketchId() !== null) return;  // right-click in sketch mode = orbit only
    this.updatePointer(ev);
    const info = this.pickFeatureInfo(ev);
    // Empty space still emits (featureId: null) — the editor shows the
    // view menu there (REQ 872) instead of the feature menu.
    this.zone.run(() => this.featureContextMenu.emit({
      featureId: info.featureId,
      faceId: info.faceId,
      clientX: ev.clientX,
      clientY: ev.clientY,
    }));
  };

  // Picks the face under the pointer and resolves its featureId + flatness.
  private pickFeatureInfo(ev: MouseEvent): {
    featureId: string | null; faceId: string | null; isFlat: boolean;
    shiftKey: boolean; ctrlKey: boolean;
  } {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.faceGroup.children, false);
    if (hits.length === 0) {
      return { featureId: null, faceId: null, isFlat: false, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey || ev.metaKey };
    }
    const ud = hits[0].object.userData as { faceId?: string; featureId?: string | null; isFlat?: boolean };
    return {
      featureId: ud.featureId ?? null,
      faceId: ud.faceId ?? null,
      isFlat: ud.isFlat === true,
      shiftKey: ev.shiftKey,
      ctrlKey: ev.ctrlKey || ev.metaKey,
    };
  }

  /** Walk up to the datum id stored on a datum mesh/group (axes wrap the line
   * in a group; planes carry it on the mesh). */
  private datumIdOfObject(obj: THREE.Object3D | undefined): string | null {
    let o: THREE.Object3D | null | undefined = obj;
    while (o) { const id = (o.userData as { datumId?: string }).datumId; if (id) return id; o = o.parent; }
    return null;
  }
  /** Convert a COMPONENT datum id (`inst:<instanceId>:<datumId>`) into a
   * face-style scoped mate reference (`<instanceId>::<datumId>`). The assembly's
   * own origin datums (no `inst:` prefix) aren't mateable instances → null. */
  private componentDatumFaceRef(datumId: string | null): string | null {
    if (!datumId) return null;
    const m = /^inst:([^:]+):(.+)$/.exec(datumId);
    return m ? `${m[1]}::${m[2]}` : null;
  }

  private updatePointer(ev: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** Raycast against the topology-edge lines and set `hoveredEdgeId`.
   * Only the front-layer line per edge participates (the hidden-line
   * layers share the same geometry but draw with depth conditions that
   * make raycast results ambiguous). */
  private _updateEdgeHover(pxThreshold: number = this.PICK_PX): void {
    const prevThreshold = this.raycaster.params.Line?.threshold ?? 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.params.Line = { threshold: this.pixelsToSketchUnits(pxThreshold) };  // zoom-adaptive: constant on-screen edge-pick zone
    const candidates: THREE.Object3D[] = [];
    for (const set of this.faceEdges.values()) {
      if ((set.front.userData as { edgeId?: string }).edgeId) candidates.push(set.front);
    }
    const hits = this.raycaster.intersectObjects(candidates, false);
    this.raycaster.params.Line = { threshold: prevThreshold };
    const next = hits.length > 0
      ? ((hits[0].object.userData as { edgeId?: string }).edgeId ?? null)
      : null;
    if (this.hoveredEdgeId() !== next) this.hoveredEdgeId.set(next);
  }

  /** Clear the transient projected-edge + face-boundary hover highlight. Called
   * (same pointer event, after updateHover) when the editor determines a sketch
   * entity is closer to the cursor than any model edge, so only the sketch
   * entity highlights — not the model edge, nor the hovered face's boundary. */
  clearProjectedEdgeHover(): void {
    if (this.hoveredEdgeId() !== null) this.hoveredEdgeId.set(null);
    this._clearHoveredFaceEdges();
  }

  /** Highlight a SINGLE projected model edge (editor-driven, works in every
   * sketch pick tool — e.g. Smart Dimension, where the viewer's own 3D edge
   * raycast doesn't run). Also drops the hovered face's whole-boundary loop so
   * only the one edge shows. */
  highlightSketchEdge(edgeId: string): void {
    this._clearHoveredFaceEdges();
    if (this.hoveredEdgeId() !== edgeId) this.hoveredEdgeId.set(edgeId);
  }

  /** Clear only the single projected-edge hover (keeping any face-boundary
   * highlight) — used when the cursor leaves every edge but is still over a
   * face interior. */
  clearSketchEdgeOnly(): void {
    if (this.hoveredEdgeId() !== null) this.hoveredEdgeId.set(null);
  }

  /** Datum-only raycast — used when the face raycast missed but the
   * face hover code path still needs to detect a datum (plane / axis /
   * point) under the cursor. Walks parent chain to find the userData
   * carrying `datumId`. */
  private _pickDatumOnly(): string | null {
    const datumHits = this.raycaster.intersectObjects(this.datumGroup.children, true);
    if (datumHits.length === 0) return null;
    let obj: THREE.Object3D | null = datumHits[0].object;
    while (obj && !(obj.userData as any).datumId) obj = obj.parent;
    if (obj) return `datum:${(obj.userData as any).datumId}`;
    return null;
  }

  /** Raycast face meshes ignoring material side. Body faces render `FrontSide`
   * (back-face culling, to stop interior walls bleeding through at
   * silhouettes), but OCCT up-to / boolean results occasionally emit a
   * reversed-orientation face — which the FrontSide raycaster then SKIPS, so a
   * hover falls through to the face BEHIND the one the user can see. We flip
   * each face material to DoubleSide for the (CPU) raycast only and restore it
   * immediately, so the GPU never renders double-sided (no bleed-through). */
  private intersectFacesBothSides(objects: THREE.Object3D[]): THREE.Intersection[] {
    const saved: Array<[THREE.Material, THREE.Side]> = [];
    for (const o of objects) {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && (mat as { side?: THREE.Side }).side !== undefined) {
        saved.push([mat, mat.side]);
        mat.side = THREE.DoubleSide;
      }
    }
    try {
      return this.raycaster.intersectObjects(objects, false);
    } finally {
      for (const [mat, side] of saved) mat.side = side;
    }
  }

  // REQ 867 — box-selection marquee (select nav mode). Screen coords;
  // `active` flips once the drag passes the engage threshold.
  marquee: { startX: number; startY: number; curX: number; curY: number; active: boolean; shiftKey: boolean } | null = null;
  marqueeSig = signal<{ left: number; top: number; width: number; height: number; crossing: boolean } | null>(null);

  /** REQ 867 — resolve the marquee to hits. Projects every face-mesh vertex
   * to screen space: window mode (L→R) needs ALL of a face's vertices inside
   * the box; crossing (R→L) needs ANY. Emits face ids + owning feature ids. */
  private resolveMarquee(m: { startX: number; startY: number; curX: number; curY: number; shiftKey: boolean }): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const minX = Math.min(m.startX, m.curX), maxX = Math.max(m.startX, m.curX);
    const minY = Math.min(m.startY, m.curY), maxY = Math.max(m.startY, m.curY);
    const crossing = m.curX < m.startX;
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    const faceIds: string[] = [];
    const featureIds = new Set<string>();
    for (const mesh of this.faceMeshes.values()) {
      if (!mesh.visible) continue;
      const geom = (mesh as THREE.Mesh).geometry as THREE.BufferGeometry;
      const pos = geom.getAttribute('position');
      if (!pos) continue;
      let anyIn = false, allIn = true;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld).project(this.camera);
        const sx = rect.left + (v.x + 1) / 2 * rect.width;
        const sy = rect.top + (1 - v.y) / 2 * rect.height;
        const inside = v.z < 1 && sx >= minX && sx <= maxX && sy >= minY && sy <= maxY;
        if (inside) anyIn = true; else allIn = false;
        if (anyIn && !allIn && crossing) break;  // crossing: first hit decides
      }
      const selected = crossing ? anyIn : (allIn && pos.count > 0);
      if (!selected) continue;
      const ud = mesh.userData as { faceId?: string; featureId?: string | null };
      if (ud.faceId) faceIds.push(ud.faceId);
      if (ud.featureId) featureIds.add(ud.featureId);
    }
    this.zone.run(() => this.boxSelect.emit({ faceIds, featureIds: [...featureIds], crossing, shiftKey: m.shiftKey }));
  }

  /** REQ 870 — Select Other cycle state: last Alt+click position + index. */
  private selectOtherCycle: { x: number; y: number; index: number } | null = null;

  /** Every pickable id under the cursor, nearest first: faces (both sides),
   * then datum planes/axes — deduped. Powers Alt+click cycling (REQ 870). */
  private pickEntityAll(): string[] {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const ranked: Array<{ d: number; id: string }> = [];
    for (const h of this.intersectFacesBothSides(this.faceGroup.children)) {
      const id = (h.object.userData as { faceId?: string }).faceId;
      if (id) ranked.push({ d: h.distance, id });
    }
    for (const h of this.raycaster.intersectObjects(this.datumGroup.children, true)) {
      let obj: THREE.Object3D | null = h.object;
      while (obj && !(obj.userData as { datumId?: string }).datumId) obj = obj.parent;
      if (obj) ranked.push({ d: h.distance, id: `datum:${(obj.userData as { datumId?: string }).datumId}` });
    }
    ranked.sort((a, b) => a.d - b.d);
    const ids: string[] = [];
    for (const r of ranked) if (!ids.includes(r.id)) ids.push(r.id);
    return ids;
  }

  private pickEntity(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const faceHits = this.intersectFacesBothSides(this.faceGroup.children);
    if (faceHits.length > 0) {
      const obj = faceHits[0].object;
      const id = (obj.userData as any).faceId;
      if (id) return id;
    }
    const datumHits = this.raycaster.intersectObjects(this.datumGroup.children, true);
    if (datumHits.length > 0) {
      // Datums are nested in subgroups — walk up to find one with userData.datumId.
      let obj: THREE.Object3D | null = datumHits[0].object;
      while (obj && !(obj.userData as any).datumId) obj = obj.parent;
      if (obj) return `datum:${(obj.userData as any).datumId}`;
    }
    return null;
  }

  /** Template-callable wrapper for the hover row of the debug overlay. */
  shortPickLabelPublic(id: string): string {
    return this._shortPickLabel(id);
  }

  /** Short human label for a pick id: face persistent-name JSON collapses to
   * `f3p1v6l122 top` / `f… #4`; datum / edge ids pass through (truncated). */
  private _shortPickLabel(id: string): string {
    if (id.startsWith('datum:')) return id;
    try {
      const o = JSON.parse(id) as { feature_id?: string; role?: string; sub_index?: number };
      const feat = (o.feature_id || '?').split('#')[0];
      const role = o.role === 'cap_top' ? 'top' : o.role === 'cap_bottom' ? 'bottom' : (o.role || '');
      const sub = o.role === 'side' && o.sub_index !== undefined ? ` #${o.sub_index}` : '';
      return `${feat} ${role}${sub}`;
    } catch {
      return id.length > 28 ? `${id.slice(0, 28)}…` : id;
    }
  }

  /** Build the 3D pick-debug payload from this pointermove's raycasts: all
   * face hits (depth order, nearest = the would-be winner), edge hits within
   * the zoom-adaptive threshold (capped at depthCap, like the real edge
   * hover), datum hits, and a vertex hit when vertex picking is armed.
   * Runs with raycaster.far already set to depthCap by the caller. */
  private _updatePickDebug(
    faceHits: THREE.Intersection[],
    frontFaceDist: number,
    depthCap: number,
  ): void {
    const items: Array<{ kind: string; label: string; dist: string; winner: boolean }> = [];
    // Faces — uncapped hits the caller already computed; everything after the
    // first is what the cursor is "near but behind".
    faceHits.slice(0, 8).forEach((h, i) => {
      const id = (h.object.userData as { faceId?: string }).faceId;
      if (!id) return;
      items.push({ kind: 'face', label: this._shortPickLabel(id), dist: h.distance.toFixed(1), winner: i === 0 });
    });
    // Edges within the pick threshold (same params as _updateEdgeHover).
    const prevThreshold = this.raycaster.params.Line?.threshold ?? 1;
    this.raycaster.params.Line = { threshold: this.pixelsToSketchUnits(this.PICK_PX) };
    const edgeCandidates: THREE.Object3D[] = [];
    for (const set of this.faceEdges.values()) {
      if ((set.front.userData as { edgeId?: string }).edgeId) edgeCandidates.push(set.front);
    }
    const edgeHits = this.raycaster.intersectObjects(edgeCandidates, false);
    this.raycaster.params.Line = { threshold: prevThreshold };
    edgeHits.slice(0, 4).forEach((h, i) => {
      const id = (h.object.userData as { edgeId?: string }).edgeId;
      if (!id) return;
      items.push({ kind: 'edge', label: id, dist: h.distance.toFixed(1), winner: i === 0 && this.edgePickMode() });
    });
    // Datums (always raycast — they only win when faces miss).
    const datumHits = this.raycaster.intersectObjects(this.datumGroup.children, true);
    if (datumHits.length > 0) {
      let obj: THREE.Object3D | null = datumHits[0].object;
      while (obj && !(obj.userData as { datumId?: string }).datumId) obj = obj.parent;
      if (obj) {
        items.push({
          kind: 'datum',
          label: String((obj.userData as { datumId?: string }).datumId),
          dist: datumHits[0].distance.toFixed(1),
          winner: faceHits.length === 0,
        });
      }
    }
    if (this.vertexPickMode()) {
      const vid = this.pickVertex();
      if (vid) items.push({ kind: 'vertex', label: vid, dist: '—', winner: true });
    }
    const modes = [
      this.vertexPickMode() ? 'vertex' : '',
      this.edgePickMode() ? 'edge' : '',
      this.facePickMode() ? 'face' : '',
    ].filter(Boolean).join('+') || 'select';
    const cap = frontFaceDist === Infinity ? '∞' : `${frontFaceDist.toFixed(1)} (+${(depthCap - frontFaceDist).toFixed(1)})`;
    const key = `${modes}|${cap}|${items.map(i => `${i.kind}:${i.label}:${i.dist}:${i.winner}`).join(',')}`;
    if (key === this.lastPickDebugKey) return;
    this.lastPickDebugKey = key;
    this.pickDebug.set({ modes, cap, items });
  }

  private updateHover() {
    // Compute the nearest front-face hit distance ONCE per pointermove.
    // Used as a depth cap for vertex / edge raycasts so picks on the
    // back of the body (which line/sphere raycasts otherwise happily
    // return) get rejected. Without this cap, hovering over the front
    // of a cube would sometimes highlight an edge on the far side.
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // Single-sided here ON PURPOSE: this hit feeds the depth cap and the
    // sketch-mode face-hover (which highlights a model face's boundary-edge
    // LOOP). Both want only VISIBLE front faces — a double-sided hit would
    // catch back faces behind the sketch plane and light up loops everywhere.
    // 3D-view face SELECTION still uses the double-sided pickEntity below to
    // catch reversed-orientation faces.
    const faceHits = this.raycaster.intersectObjects(this.faceGroup.children, false);
    const frontFaceDist = faceHits.length > 0 ? faceHits[0].distance : Infinity;
    // Small additive bias so picks visually AT the front edge still
    // qualify as "in front" (line/sphere distance includes off-axis
    // distance, so a line drawn right at the silhouette can score
    // slightly larger than the face it sits on).
    const depthCap = frontFaceDist === Infinity ? Infinity : frontFaceDist + Math.max(0.5, this.orbitDistance * 0.01);
    const prevFar = this.raycaster.far;
    this.raycaster.far = depthCap;
    try {
      // Debug overlay: collect EVERY candidate near the cursor before the
      // mode branches below pick a single winner (their early returns would
      // otherwise skip it).
      this._updatePickDebug(faceHits, frontFaceDist, depthCap);
      // Vertex pick runs FIRST when armed. If a vertex marker is in
      // front of (or on) the nearest face, it wins.
      if (this.vertexPickMode()) {
        this.updateVertexHover();
        if (this.lastHoveredVertexId !== null) {
          if (this.hovered() !== null) this.hovered.set(null);
          if (this.hoveredEdgeId() !== null) this.hoveredEdgeId.set(null);
          this._clearHoveredFaceEdges();
          return;
        }
        if (!this.edgePickMode() && !this.facePickMode()) {
          if (this.hovered() !== null) this.hovered.set(null);
          this._clearHoveredFaceEdges();
          return;
        }
      }
      // Edge pick takes priority over face pick when both are armed
      // (Convert Entities arms both — edges are thinner and more
      // specific). Same order as the onClick handler. In a sketch, widen the
      // edge zone so the boundary edge near the cursor is preferred over the
      // face's whole-boundary highlight (buffer requested by users).
      if (this.edgePickMode()) {
        this._updateEdgeHover(this.activeSketchId() !== null ? this.SKETCH_EDGE_HOVER_PX : this.PICK_PX);
        if (this.hoveredEdgeId() !== null) {
          if (this.hovered() !== null) this.hovered.set(null);
          this._clearHoveredFaceEdges();  // a specific edge wins over the face's edges
          return;
        }
      } else if (this.hoveredEdgeId() !== null) {
        this.hoveredEdgeId.set(null);
      }
      // In a sketch, a face hover (over the face interior — a specific edge or
      // vertex already returned above) highlights the face's boundary EDGES,
      // NOT the face fill. Runs even when edgePickMode is armed (it is, in the
      // Select tool, for edge-relation snapping) — that's why this lives here
      // rather than at the top of updateHover.
      if (this.activeSketchId() !== null) {
        const ud = faceHits.length > 0 ? (faceHits[0].object.userData as { boundaryEdgeIds?: string[] }) : null;
        const nextSet = new Set<string>(ud?.boundaryEdgeIds ?? []);
        if (this.hovered() !== null) this.hovered.set(null);
        if (!this._sameStringSet(this.hoveredFaceEdgeIds(), nextSet)) this.hoveredFaceEdgeIds.set(nextSet);
        return;
      }
      this._clearHoveredFaceEdges();
      // Face hover — use the front-face hit we already computed above
      // instead of redoing the raycast inside pickEntity().
      if (this.facePickMode()) {
        let next: string | null = null;
        if (faceHits.length > 0) {
          const id = (faceHits[0].object.userData as any).faceId as string | undefined;
          if (id) next = id;
        }
        if (next === null) next = this._pickDatumOnly();
        if (this.hovered() !== next) this.hovered.set(next);
        return;
      }
      // Sketch-plane pick: highlight ONLY a sketchable target — the nearest
      // flat model face or datum plane. Curved faces, datum axes, and datum
      // points aren't valid sketch planes, so they don't highlight.
      if (this.planePickMode()) {
        let next: string | null = null;
        let bestDist = Infinity;
        if (faceHits.length > 0) {
          const ud = faceHits[0].object.userData as { faceId?: string; isFlat?: boolean };
          if (ud.faceId && ud.isFlat) { next = ud.faceId; bestDist = faceHits[0].distance; }
        }
        // Nearest datum PLANE in front of that face (datumHits are distance-sorted).
        const datumHits = this.raycaster.intersectObjects(this.datumGroup.children, true);
        for (const dh of datumHits) {
          let o: THREE.Object3D | null = dh.object;
          while (o && !(o.userData as { datumId?: string }).datumId) o = o.parent;
          if (!o) continue;
          const ud = o.userData as { datumId?: string; datumPlane?: boolean };
          if (ud.datumPlane === true && dh.distance < bestDist) {
            next = `datum:${ud.datumId}`;
          }
          break; // only consider the nearest datum hit
        }
        if (this.hovered() !== next) this.hovered.set(next);
        return;
      }
    } finally {
      this.raycaster.far = prevFar;
    }
    // Axis pick mode: the axis overlay IS the pickable target — clear
    // any stale face/datum highlight so the user isn't distracted by
    // dual signals.
    if (this.axisPickMode()) {
      if (this.hovered() !== null) this.hovered.set(null);
      return;
    }
    // Region-selection mode: the profile-fill overlay IS the user's
    // target. Highlighting the 3D face underneath the cursor is
    // distracting and ambiguous — the orange face-highlight would
    // compete with the region tint for attention. Skip face hover
    // entirely while any profile fills are active; only profile-fill
    // hover dispatch runs.
    if (this.profileFills().length > 0) {
      if (this.hovered() !== null) this.hovered.set(null);
      const fillIndex = this.pickProfileFill();
      if (fillIndex !== this.lastProfileFillHover) {
        this.lastProfileFillHover = fillIndex;
        this.zone.run(() => this.profileFillHover.emit(fillIndex));
      }
      return;
    }
    const prev = this.hovered();
    const next = this.pickEntity();
    if (prev !== next) this.hovered.set(next);
    // Profile-fill hover dispatch. Compared against the last-emitted value
    // so we only fire on transitions (the parent re-renders on each emit).
    const fillIndex = this.pickProfileFill();
    if (fillIndex !== this.lastProfileFillHover) {
      this.lastProfileFillHover = fillIndex;
      this.zone.run(() => this.profileFillHover.emit(fillIndex));
    }
  }

  /** Last hover index emitted to the parent, for edge-triggered events. */
  private lastProfileFillHover: number | null = null;
  /** Last hovered vertex id, for edge-triggered marker recoloring. */
  private lastHoveredVertexId: string | null = null;

  private updateVertexHover(): void {
    const id = this.pickVertex();
    if (id === this.lastHoveredVertexId) return;
    // Markers are invisible (opacity 0) by default. Restore the
    // previously-hovered marker to invisible, then make the new one
    // visible + orange so a single dot appears under the cursor.
    if (this.lastHoveredVertexId) {
      const prev = this.vertexPickMeshes.get(this.lastHoveredVertexId);
      if (prev) {
        const m = prev.material as THREE.MeshBasicMaterial;
        m.color.setHex(0xffd54f);
        m.opacity = 0;
      }
    }
    if (id) {
      const next = this.vertexPickMeshes.get(id);
      if (next) {
        const m = next.material as THREE.MeshBasicMaterial;
        m.color.setHex(0xff9800);
        m.opacity = 0.95;
      }
    }
    this.lastHoveredVertexId = id;
  }

  private syncDatums(datums: DatumElement[]) {
    // Clear old.
    for (const obj of this.datumMeshes.values()) {
      this.datumGroup.remove(obj);
      obj.traverse(child => {
        if (child instanceof CSS2DObject) { child.element.remove(); return; }
        const m = (child as THREE.Mesh).material as THREE.Material | undefined;
        if (m) Array.isArray(m) ? m.forEach(x => x.dispose()) : m.dispose();
        const g = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (g) g.dispose();
      });
    }
    this.datumMeshes.clear();
    this.datumLabels = [];
    for (const d of datums) this.addDatum(d);
  }

  /** Hide datum plane labels that sit behind solid geometry. CSS2D labels are
   * a DOM overlay with no depth test, so without this they read through parts.
   * Orthographic camera → cast a ray along the view direction through each
   * label and hide it when a face is in front of it. */
  private updateLabelOcclusion() {
    const labels = this.datumLabels;
    if (labels.length === 0) return;
    const faces = this.faceGroup.children;
    if (faces.length === 0) { for (const l of labels) l.visible = true; return; }
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const BIG = 100000;
    const p = new THREE.Vector3();
    const origin = new THREE.Vector3();
    for (const label of labels) {
      label.getWorldPosition(p);
      origin.copy(p).addScaledVector(forward, -BIG);
      this.occlusionRaycaster.set(origin, forward);
      const hits = this.occlusionRaycaster.intersectObjects(faces, false);
      // A hit closer than the label (distance < BIG) sits in front → occluded.
      label.visible = !(hits.length > 0 && hits[0].distance < BIG - 1);
    }
  }

  /** Highlight color for a selected datum (point / axis / plane) in the 3D
   *  viewer — a vivid cyan distinct from every datum base color (X red /
   *  Y green / Z blue / user amber / origin white). */
  private static readonly DATUM_SELECT_COLOR = 0x00e5ff;

  private addDatum(d: DatumElement) {
    const selected = this.selectedDatums().has(d.id);
    const hi = CadViewerComponent.DATUM_SELECT_COLOR;
    if (d.kind === 'point') {
      // User-defined Datum Point features (REQ 661) carry a sidecar
      // `position` to place the sphere off-origin; the origin row's
      // built-in 'origin' datum has no sidecar and draws at (0,0,0).
      const sidecar = (d as { position?: [number, number, number] }).position;
      const isUserPoint = !!sidecar;
      const base = isUserPoint ? 0xffb74d : 0xffffff;
      const geom = new THREE.SphereGeometry(isUserPoint ? 2.2 : 1.2, 16, 16);
      const mat = new THREE.MeshBasicMaterial({ color: selected ? hi : base });
      const mesh = new THREE.Mesh(geom, mat);
      if (sidecar) mesh.position.set(sidecar[0], sidecar[1], sidecar[2]);
      mesh.userData = { datumId: d.id, datumBaseColor: base };
      this.datumGroup.add(mesh);
      this.datumMeshes.set(d.id, mesh);
    } else if (d.kind === 'axis' && d.direction) {
      // Built-in origin axes use canonical X/Y/Z colors and run
      // through the world origin; user-defined Datum Axis features
      // (REQ 660) draw in amber and use the sidecar `axis.origin`
      // for their midpoint.
      const sidecarAxis = (d as { axis?: { origin: [number, number, number]; direction: [number, number, number] } }).axis;
      const isUserAxis = !!sidecarAxis;
      const base = isUserAxis ? 0xffb74d
        : d.id === 'x_axis' ? 0xe53935
        : d.id === 'y_axis' ? 0x43a047
        : 0x1e88e5;
      const color = selected ? hi : base;
      const center = sidecarAxis
        ? new THREE.Vector3(sidecarAxis.origin[0], sidecarAxis.origin[1], sidecarAxis.origin[2])
        : new THREE.Vector3();
      const dir = new THREE.Vector3(...(sidecarAxis?.direction ?? d.direction)).normalize();
      const end = center.clone().add(dir.clone().multiplyScalar(60));
      const start = center.clone().add(dir.clone().multiplyScalar(-60));
      const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
      const mat = new THREE.LineBasicMaterial({ color });
      const line = new THREE.Line(geom, mat);
      const group = new THREE.Group();
      group.add(line);
      group.userData = { datumId: d.id, datumBaseColor: base };
      this.datumGroup.add(group);
      this.datumMeshes.set(d.id, group);
    } else if (d.kind === 'plane' && d.direction) {
      // Origin datums get their canonical X/Y/Z colors; user-defined
      // datum planes (REQ 657) get amber so they read as "added by
      // me" vs the always-there origin set.
      const isOrigin = d.id === 'xy_plane' || d.id === 'yz_plane' || d.id === 'xz_plane';
      const base = d.id === 'xy_plane' ? 0x1e88e5
                  : d.id === 'yz_plane' ? 0xe53935
                  : d.id === 'xz_plane' ? 0x43a047
                  : 0xffb74d;
      const color = selected ? hi : base;
      const geom = new THREE.PlaneGeometry(80, 80);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: selected ? 0.4 : 0.18, side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      // User datums carry a full Plane3 sidecar (origin + xAxis +
      // yAxis + normal); use the basis directly so the quad lands at
      // the right position AND orientation. Origin datums skip the
      // sidecar and use the normal-only orientation pinned at world 0.
      const sidecar = (d as any).plane as { origin: [number, number, number]; xAxis: [number, number, number]; yAxis: [number, number, number]; normal: [number, number, number] } | undefined;
      if (!isOrigin && sidecar) {
        const m4 = new THREE.Matrix4();
        m4.makeBasis(
          new THREE.Vector3(sidecar.xAxis[0], sidecar.xAxis[1], sidecar.xAxis[2]),
          new THREE.Vector3(sidecar.yAxis[0], sidecar.yAxis[1], sidecar.yAxis[2]),
          new THREE.Vector3(sidecar.normal[0], sidecar.normal[1], sidecar.normal[2]),
        );
        m4.setPosition(sidecar.origin[0], sidecar.origin[1], sidecar.origin[2]);
        mesh.applyMatrix4(m4);
      } else {
        const normal = new THREE.Vector3(...d.direction).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        mesh.quaternion.copy(quat);
      }
      mesh.userData = { datumId: d.id, datumBaseColor: base, datumPlane: true };
      // Small corner label with the plane name (REQ — shown only for visible
      // planes, since `datums` is already visibility-filtered upstream). Added
      // as a child of the quad so it tracks the plane's position/orientation.
      const labelEl = document.createElement('div');
      labelEl.textContent = this.datumPlaneName(d);
      labelEl.style.cssText = 'font: 600 11px ui-monospace, SFMono-Regular, monospace; opacity: 0.92; pointer-events: none; user-select: none; white-space: nowrap; text-shadow: 0 0 3px rgba(0,0,0,0.75);';
      labelEl.style.color = '#' + base.toString(16).padStart(6, '0');
      const labelObj = new CSS2DObject(labelEl);
      labelObj.position.set(-38, 38, 0); // top-left corner of the 80×80 quad (plane-local)
      mesh.add(labelObj);
      this.datumLabels.push(labelObj);
      this.datumGroup.add(mesh);
      this.datumMeshes.set(d.id, mesh);
    }
  }

  /** Re-tint datum meshes to reflect the current `selectedDatums()` without a
   *  full rebuild — selected datums turn cyan (planes also get more opaque),
   *  unselected restore their stored base color. Point/plane meshes carry the
   *  material directly; an axis is a Group whose first child is the Line. */
  /** Transient hover highlight for a datum (amber-yellow) — distinct from the
   *  cyan tree/selection tint. Used for sketch-plane-pick hover. */
  private static readonly DATUM_HOVER_COLOR = 0xffeb3b;

  private recolorDatums() {
    const sel = this.selectedDatums();
    const hovered = this.hovered();
    const transSel = this.selected();
    const SELC = CadViewerComponent.DATUM_SELECT_COLOR;
    const HOVC = CadViewerComponent.DATUM_HOVER_COLOR;
    for (const [id, obj] of this.datumMeshes) {
      const ud = obj.userData as { datumBaseColor?: number; datumPlane?: boolean };
      if (ud.datumBaseColor === undefined) continue;
      const fullId = `datum:${id}`;
      const hot = hovered === fullId;
      const on = sel.has(id) || transSel === fullId;
      const target = obj instanceof THREE.Mesh ? obj : (obj as THREE.Group).children[0] as THREE.Line;
      const mat = target.material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial;
      mat.color.setHex(hot ? HOVC : on ? SELC : ud.datumBaseColor);
      if (ud.datumPlane && mat instanceof THREE.MeshBasicMaterial) {
        mat.opacity = (hot || on) ? 0.4 : 0.18;
      }
    }
  }

  /** Display name for a datum plane's corner label (origin planes get their
   *  friendly Top/Front/Right name; user datums use their own name). */
  private datumPlaneName(d: DatumElement): string {
    return originPlaneLabel(d.id) ?? ((d as { name?: string }).name || 'Plane');
  }

  /** CAD-790 — render the other components as translucent ghosts in the edited
   * part's frame. Meshes carry `userData.instanceId` + scoped ids so a
   * cross-part Convert-Entities pick can report which component was clicked. */
  /** Raycast the reference-vertex Points cloud (cross-part Convert). Returns
   * the hit OverlayVertex, or null. The pointer must already be updated. */
  private _pickReferenceVertex(): OverlayVertex | null {
    if (!this.referenceGroup) return null;
    const cloud = this.referenceGroup.children.find(
      (o) => (o.userData as { overlayVertices?: OverlayVertex[] }).overlayVertices,
    ) as THREE.Points | undefined;
    if (!cloud) return null;
    const prev = this.raycaster.params.Points?.threshold ?? 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.params.Points = { threshold: 4 };
    const hits = this.raycaster.intersectObject(cloud, false);
    this.raycaster.params.Points = { threshold: prev };
    if (!hits.length || hits[0].index == null) return null;
    return (cloud.userData as { overlayVertices: OverlayVertex[] }).overlayVertices[hits[0].index] ?? null;
  }

  private syncReference(ref: InContextOverlay | null) {
    if (!this.referenceGroup) return;
    for (const o of this.referenceMeshes) {
      this.referenceGroup.remove(o);
      o.traverse((c) => {
        const m = (c as THREE.Mesh).material as THREE.Material | undefined;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
        const g = (c as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (g) g.dispose();
      });
    }
    this.referenceMeshes = [];
    if (!ref) return;
    for (const f of ref.faces) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(f.positions, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(f.normals, 3));
      geom.setIndex(new THREE.BufferAttribute(f.indices, 1));
      const mat = new THREE.MeshStandardMaterial({
        color: 0x6f7a8a, metalness: 0.05, roughness: 0.85,
        transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      // `overlayFace` carries the full source descriptor so a cross-part
      // Convert pick can enumerate the face's boundary edges in the editor.
      mesh.userData = { reference: true, instanceId: f.instanceId, faceId: f.faceId, overlayFace: f };
      this.referenceGroup.add(mesh);
      this.referenceMeshes.push(mesh);
    }
    for (const e of ref.edges) {
      const pts = e.polyline.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      if (pts.length < 2) continue;
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0x8a96a6, transparent: true, opacity: 0.55 }));
      line.userData = {
        reference: true, instanceId: e.instanceId, overlayEdge: e,
        edgeRecord: { edgeId: e.id, isStraight: e.isStraight, endpoints: [e.polyline[0], e.polyline[e.polyline.length - 1]], polylineLength: e.polyline.length },
      };
      this.referenceGroup.add(line);
      this.referenceMeshes.push(line);
    }
    if (ref.vertices.length) {
      // One Points cloud for all reference vertices; the hit index maps back to
      // the overlay vertex (carried on the cloud's userData) for cross-part
      // vertex Convert.
      const arr = new Float32Array(ref.vertices.length * 3);
      for (let i = 0; i < ref.vertices.length; i++) {
        arr[i * 3] = ref.vertices[i].position[0];
        arr[i * 3 + 1] = ref.vertices[i].position[1];
        arr[i * 3 + 2] = ref.vertices[i].position[2];
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const pts = new THREE.Points(geom, new THREE.PointsMaterial({ color: 0x8a96a6, size: 5, sizeAttenuation: false, transparent: true, opacity: 0.7 }));
      pts.userData = { reference: true, overlayVertices: ref.vertices };
      this.referenceGroup.add(pts);
      this.referenceMeshes.push(pts);
    }
  }

  private syncGeometry(g: ModelGeometry) {
    // Datums driven by visibility settings on the model.
    this.syncDatums(g.datums);
    // Re-show the edge layer (hidden during an assembly component drag — the
    // rebuild below repopulates it at the solved positions).
    this.edgeGroup.visible = true;
    // Clear and rebuild face + edge meshes (face IDs reshuffle on every regen).
    for (const mesh of this.faceMeshes.values()) {
      this.faceGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.faceMeshes.clear();
    for (const set of this.faceEdges.values()) {
      this.edgeGroup.remove(set.front);
      this.edgeGroup.remove(set.hiddenSolid);
      this.edgeGroup.remove(set.hiddenDashed);
      set.front.geometry.dispose();
    }
    this.faceEdges.clear();

    // Edge rendering strategy is picked once per regen:
    //   - NEW kernel (any topology edge ships a `polyline`): render each
    //     BRep edge as a single Line from the kernel's analytic sampling.
    //     Curves are smooth, every edge is drawn exactly once.
    //   - OLD kernel (no polyline data, every edge marked is_straight):
    //     fall back to per-face THREE.EdgesGeometry. Curved face boundaries
    //     come out as chord polylines (the original behavior). This avoids
    //     drawing a single straight chord across a curve when we can't tell
    //     where the curve actually goes.
    const hasPolylineData = !!g.topology?.edges?.some(e => e.polyline && e.polyline.length >= 2);

    for (const f of g.faces) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(f.positions, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(f.normals, 3));
      geom.setIndex(new THREE.BufferAttribute(f.indices, 1));
      const mat = new THREE.MeshStandardMaterial({
        color: 0x8aa0c4, metalness: 0.1, roughness: 0.6,
        // FrontSide → back-face culling. OCCT's tessellation produces
        // outward-facing normals for solids; rendering both sides made
        // the interior walls of cylinders/holes bleed through and read
        // as a translucent "draft" tint at silhouettes. With back faces
        // culled, faces whose normals point away from the camera are
        // hidden by the GPU pipeline instead of competing for pixels.
        side: THREE.FrontSide,
        // polygonOffset pushes face fragments slightly back so coplanar edges
        // (depthFunc = LessEqualDepth) reliably win the depth test.
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { faceId: f.faceId, featureId: f.featureId ?? null, isFlat: f.isFlat === true, boundaryEdgeIds: f.boundaryEdgeIds ?? [] };
      this.faceGroup.add(mesh);
      this.faceMeshes.set(f.faceId, mesh);

      // Old-kernel fallback path: feature-edge extraction. Threshold of
      // 45° suppresses tessellation-facet seams on small curved faces
      // (a 1mm-radius cylinder sampled at chord tolerance 0.05 has
       // ~37° per-facet dihedral, which a 15° threshold would emit as
      // visible vertical stripes on the cylinder side). Cost is that
      // genuine geometric features with very shallow dihedrals (gentle
      // chamfers, soft fillets) get suppressed too — once the kernel
      // ships polyline data, the smooth-curve path takes over and this
      // threshold no longer matters.
      if (!hasPolylineData) {
        const edgeGeom = new THREE.EdgesGeometry(geom, 45);
        const front = new THREE.LineSegments(edgeGeom, this.frontEdgeMaterial);
        const hiddenSolid = new THREE.LineSegments(edgeGeom, this.hiddenSolidMaterial);
        const hiddenDashed = new THREE.LineSegments(edgeGeom, this.hiddenDashedMaterial);
        hiddenDashed.computeLineDistances();
        this.edgeGroup.add(front);
        this.edgeGroup.add(hiddenSolid);
        this.edgeGroup.add(hiddenDashed);
        this.faceEdges.set(f.faceId, { front, hiddenSolid, hiddenDashed });
      }
    }

    if (hasPolylineData) this.rebuildTopologyEdges(g.topology);

    this.recolor(this.selected(), this.hovered(), this.selectedFeatures(), this.pickedFaceIds());
    this.applyDisplayMode(this.displayMode());
  }

  /** Render every BRep edge once from topology. Straight edges become a
   * single segment between their two endpoints; curved edges (cylinder
   * top/bottom rings, revolve fuses with non-coplanar bodies, fillets,
   * etc.) use the kernel-supplied polyline so they paint as smooth
   * curves rather than stacked chord polylines from per-face mesh
   * tessellation. Caller pre-clears `faceEdges`. */
  private rebuildTopologyEdges(topology: ModelTopology | undefined): void {
    if (!topology || topology.edges.length === 0) return;
    for (const e of topology.edges) {
      const points: THREE.Vector3[] = [];
      if (!e.isStraight && e.polyline && e.polyline.length >= 2) {
        for (const p of e.polyline) points.push(new THREE.Vector3(p[0], p[1], p[2]));
      } else {
        const [a, b] = e.endpoints;
        points.push(new THREE.Vector3(a[0], a[1], a[2]));
        points.push(new THREE.Vector3(b[0], b[1], b[2]));
      }
      if (points.length < 2) continue;
      // Three.js Line draws as connected polyline (each consecutive pair
      // becomes a segment), so a polyline approximation paints as a
      // single continuous curve rather than a chord per pair.
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      // Tangent edges (fillet/chamfer blend boundaries, parametric seams)
      // get the lighter dashed style instead of the regular dark solid.
      const isTangent = e.isTangent === true;
      const front = new THREE.Line(geom, isTangent ? this.frontTangentEdgeMaterial : this.frontEdgeMaterial);
      const hiddenSolid = new THREE.Line(geom, isTangent ? this.hiddenTangentMaterial : this.hiddenSolidMaterial);
      const hiddenDashed = new THREE.Line(geom, isTangent ? this.hiddenTangentMaterial : this.hiddenDashedMaterial);
      // Front-layer tangent edges need computeLineDistances() so the
      // dashed material renders; matches what we already do for
      // hiddenDashed below.
      if (isTangent) front.computeLineDistances();
      // Tag the front-layer line with this edge's topology id so the
      // edge-pick mode can raycast it back to the original BRep edge.
      // Carries the full record (id/isStraight/endpoints/polyline len)
      // so the editor can display debug info without re-looking it up.
      front.userData = {
        edgeId: e.id,
        edgeRecord: {
          edgeId: e.id,
          isStraight: e.isStraight,
          endpoints: e.endpoints,
          polylineLength: e.polyline?.length ?? 0,
        },
      };
      hiddenDashed.computeLineDistances();
      this.edgeGroup.add(front);
      this.edgeGroup.add(hiddenSolid);
      this.edgeGroup.add(hiddenDashed);
      this.faceEdges.set(`edge:${e.id}`, { front, hiddenSolid, hiddenDashed });
    }
  }

  /** Tear down and rebuild the ghost-preview group from new mesh data.
   * Material colour depends on `pv.kind`: green-blue for additive
   * (extrude / revolve), red for subtractive (cut). Both render with
   * `transparent: true` + opacity ~ 0.35 + DoubleSide so the volume
   * reads through the existing committed body. */
  private rebuildFeaturePreview(pv: {
    kind: 'add' | 'cut';
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
  } | null): void {
    while (this.featurePreviewGroup.children.length > 0) {
      const child = this.featurePreviewGroup.children.pop()!;
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const m = mesh.material as THREE.Material | undefined;
      if (m) Array.isArray(m) ? m.forEach(x => x.dispose()) : m.dispose();
    }
    if (!pv) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pv.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(pv.normals, 3));
    geom.setIndex(new THREE.BufferAttribute(pv.indices, 1));
    const mat = new THREE.MeshStandardMaterial({
      color: pv.kind === 'cut' ? 0xef5350 : 0x66bb6a,
      metalness: 0.0,
      roughness: 0.55,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,  // don't occlude the committed body's edges
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 8;
    this.featurePreviewGroup.add(mesh);
  }

  // REQ 619 — toggle each face's color/depth write + edge-layer visibility
  // according to the chosen mode.
  private applyDisplayMode(mode: DisplayMode) {
    const spec = DISPLAY_MODES[mode];
    for (const mesh of this.faceMeshes.values()) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      m.colorWrite = spec.facesShaded;
      m.depthWrite = spec.facesDepth;
      // Don't draw faces at all if neither color nor depth is needed.
      mesh.visible = spec.facesShaded || spec.facesDepth;
    }
    for (const set of this.faceEdges.values()) {
      set.front.visible = spec.showFrontEdges;
      set.hiddenSolid.visible = spec.showHiddenSolid;
      set.hiddenDashed.visible = spec.showHiddenDashed;
    }
  }

  // REQ 615: project each visible non-active sketch's entities into the 3D
  // scene as line geometry on the sketch's host plane.
  private syncSketches(doc: SketchDocument | null, activeSketchId: string | null, selectedSet: Set<string> = new Set(), axisId: string | null = null) {
    // Tear down stale overlays. REQ 631: skip disposal of the shared
    // selectedSketchMaterial (and the analogous mirrorAxisMaterial) — they
    // persist across rebuilds. CSS2DObject children must also detach their
    // DOM nodes so the previous frame's dimension labels don't pile up in
    // the overlay layer.
    for (const [, group] of this.sketchOverlays) {
      this.sketchGroup.remove(group);
      group.traverse(child => {
        if (child instanceof CSS2DObject) {
          child.element.remove();
          return;
        }
        const m = (child as THREE.Mesh).material as THREE.Material | undefined;
        if (m && m !== this.selectedSketchMaterial && m !== this.mirrorAxisMaterial && m !== this.hoverSketchMaterial) {
          Array.isArray(m) ? m.forEach(x => x.dispose()) : m.dispose();
        }
        const g = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (g) g.dispose();
      });
    }
    this.sketchOverlays.clear();
    if (!doc) return;
    for (const sketch of Object.values(doc.sketches)) {
      // REQ 616: active sketch ALSO renders (no filter on activeSketchId). The
      // visibility flag still applies.
      if (sketch.visible === false) continue;
      const isActive = sketch.id === activeSketchId;
      const group = this.buildSketchOverlay(sketch, isActive, selectedSet, axisId);
      if (group.children.length === 0) continue;
      this.sketchGroup.add(group);
      this.sketchOverlays.set(sketch.id, group);
    }
  }

  // REQ 629 — preview overlay. Clears the group, then rebuilds the rubber-band
  // line/circle/arc + snap indicator from `items`, projected onto the active
  // sketch's plane. Returns early when there's no active sketch.
  private rebuildPreview(items: SketchPreview[], activeSketchId: string | null) {
    while (this.sketchPreviewGroup.children.length > 0) {
      const child = this.sketchPreviewGroup.children.pop()!;
      child.traverse(c => {
        // inference-badge labels are CSS2DObjects whose .element is a
        // detached <div> in the labelRenderer's DOM overlay. Popping the
        // Three.js parent doesn't remove the DOM node, so without this
        // the labels accumulate forever — visible bug as "stuck"
        // alignment/constraint hints when drawing.
        if (c instanceof CSS2DObject) c.element.remove();
        const m = (c as THREE.Mesh).material as THREE.Material | undefined;
        if (m) Array.isArray(m) ? m.forEach(x => x.dispose()) : m.dispose();
        const g = (c as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (g) g.dispose();
      });
    }
    if (!activeSketchId) return;
    const sketch = this.sketchDoc()?.sketches[activeSketchId];
    if (!sketch) return;
    const project = (p: { x: number; y: number }) => this.project2DTo3D(sketch, p);
    for (const item of items) {
      const obj = this.buildPreviewItem(item, sketch.plane, project);
      if (obj) this.sketchPreviewGroup.add(obj);
    }
  }

  private buildPreviewItem(
    item: SketchPreview, plane: Plane3,
    project: (p: { x: number; y: number }) => THREE.Vector3,
  ): THREE.Object3D | null {
    const previewColor = 0xffb74d;  // orange to read as "draft / in progress"
    switch (item.kind) {
      case 'line':
        return this.makePreviewLine([project(item.start), project(item.end)], previewColor);
      case 'circle': {
        const pts = tessellateCircle(item.center, item.radius, this.sketchChordTol());
        return this.makePreviewLine(pts.map(project), previewColor);
      }
      case 'arc': {
        const startAngle = Math.atan2(item.start.y - item.center.y, item.start.x - item.center.x);
        const endAngle = Math.atan2(item.end.y - item.center.y, item.end.x - item.center.x);
        const pts = tessellateArc(item.center, item.radius, startAngle, endAngle, item.ccw, this.sketchChordTol());
        return this.makePreviewLine(pts.map(project), previewColor);
      }
      case 'point-marker': {
        // Adaptive size → constant on-screen (this preview rebuilds on cursor move).
        const baseR = (item.style === 'cursor' ? 0.9 : 1.3) * (this.orbitDistance / 180);
        const geom = new THREE.SphereGeometry(Math.max(0.02, baseR), 12, 8);
        const mat = new THREE.MeshBasicMaterial({
          color: item.style === 'cursor' ? 0xffffff : previewColor,
          depthTest: false,
        });
        const m = new THREE.Mesh(geom, mat);
        m.position.copy(project({ x: item.x, y: item.y }));
        m.renderOrder = 5;
        return m;
      }
      case 'snap-indicator': {
        // Distinct glyph per snap kind so the user can read WHY they
        // snapped: square = endpoint, triangle = midpoint, X = intersection,
        // diamond = quadrant, ring = on-edge. Drawn at a CONSTANT on-screen
        // size (the preview rebuilds on cursor move, so adaptive build size
        // keeps it steady regardless of zoom).
        const r = 2.5 * (this.orbitDistance / 180);
        const yellow = 0xffeb3b;
        const kind = item.snapKind ?? 'endpoint';
        const pts: Array<{ x: number; y: number }> = [];
        if (kind === 'endpoint') {
          // Square box centered on the snap point, drawn as a closed polyline.
          pts.push(
            { x: item.x - r, y: item.y - r },
            { x: item.x + r, y: item.y - r },
            { x: item.x + r, y: item.y + r },
            { x: item.x - r, y: item.y + r },
            { x: item.x - r, y: item.y - r },
          );
          return this.makePreviewLine(pts.map(project), yellow, true);
        }
        if (kind === 'midpoint') {
          // Upward-pointing triangle.
          pts.push(
            { x: item.x - r, y: item.y - r * 0.7 },
            { x: item.x + r, y: item.y - r * 0.7 },
            { x: item.x,     y: item.y + r },
            { x: item.x - r, y: item.y - r * 0.7 },
          );
          return this.makePreviewLine(pts.map(project), yellow, true);
        }
        if (kind === 'quadrant') {
          // Diamond (square rotated 45°).
          pts.push(
            { x: item.x,     y: item.y + r },
            { x: item.x + r, y: item.y },
            { x: item.x,     y: item.y - r },
            { x: item.x - r, y: item.y },
            { x: item.x,     y: item.y + r },
          );
          return this.makePreviewLine(pts.map(project), yellow, true);
        }
        if (kind === 'on-edge') {
          // Ring (small circle) — "coincident with a model edge". Distinct from
          // the point-snap glyphs so the user reads it as an on-edge inference.
          const SEG = 16;
          for (let i = 0; i <= SEG; i++) {
            const a = (i / SEG) * Math.PI * 2;
            pts.push({ x: item.x + r * Math.cos(a), y: item.y + r * Math.sin(a) });
          }
          return this.makePreviewLine(pts.map(project), yellow, true);
        }
        if (kind === 'center') {
          // Concentric arc-center inference (REQ 830): a ring with a crosshair
          // through it — reads as "snap to this arc/circle center" (concentric /
          // coincident-to-center), distinct from the plain on-edge ring.
          const group = new THREE.Group();
          const ring: Array<{ x: number; y: number }> = [];
          const SEG = 16;
          for (let i = 0; i <= SEG; i++) {
            const a = (i / SEG) * Math.PI * 2;
            ring.push({ x: item.x + r * Math.cos(a), y: item.y + r * Math.sin(a) });
          }
          group.add(this.makePreviewLine(ring.map(project), yellow, true));
          group.add(this.makePreviewLine(
            [project({ x: item.x - r * 1.4, y: item.y }), project({ x: item.x + r * 1.4, y: item.y })],
            yellow, true,
          ));
          group.add(this.makePreviewLine(
            [project({ x: item.x, y: item.y - r * 1.4 }), project({ x: item.x, y: item.y + r * 1.4 })],
            yellow, true,
          ));
          return group;
        }
        // intersection — render as an X (two crossed line segments).
        const group = new THREE.Group();
        const arm1 = this.makePreviewLine(
          [project({ x: item.x - r, y: item.y - r }), project({ x: item.x + r, y: item.y + r })],
          yellow, true,
        );
        const arm2 = this.makePreviewLine(
          [project({ x: item.x - r, y: item.y + r }), project({ x: item.x + r, y: item.y - r })],
          yellow, true,
        );
        group.add(arm1); group.add(arm2);
        return group;
      }
      case 'edit-hover': {
        // Trim hover: solid red segment that would be removed.
        // Extend hover: dashed red segment that would be added.
        const red = 0xff5252;
        const pts = item.points && item.points.length >= 2
          ? item.points.map(project)
          : [project(item.start), project(item.end)];
        return this.makePreviewLine(pts, red, item.mode === 'remove');
      }
      case 'alignment-guide': {
        // Dashed yellow alignment guide — same hue as the snap indicators,
        // but dashed and a touch dimmer so it reads as a hint, not draft
        // geometry.
        return this.makePreviewLine([project(item.start), project(item.end)], 0xfbc02d, false);
      }
      case 'inference-badge': {
        // CSS2D text label so it stays a fixed size in screen pixels
        // regardless of camera zoom. Lifecycle is automatic — the overlay
        // rebuild loop tears down the underlying DOM element when this
        // item disappears from the SketchPreview list.
        const el = document.createElement('div');
        el.textContent = item.label;
        Object.assign(el.style, {
          font: '600 11px monospace',
          color: '#fbc02d',
          background: 'rgba(0, 0, 0, 0.6)',
          padding: '1px 6px',
          borderRadius: '3px',
          pointerEvents: 'none',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        });
        const obj = new CSS2DObject(el);
        obj.position.copy(project({ x: item.x, y: item.y }));
        obj.renderOrder = 6;
        return obj;
      }
    }
  }

  private makePreviewLine(points: THREE.Vector3[], color: number, solid = false): THREE.Line {
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = solid
      ? new THREE.LineBasicMaterial({ color, depthTest: false })
      : new THREE.LineDashedMaterial({ color, dashSize: 1.2, gapSize: 0.6, depthTest: false });
    const line = new THREE.Line(geom, mat);
    if (!solid) line.computeLineDistances();
    line.renderOrder = 5;
    return line;
  }

  // ────────── Profile-region overlays (Extrude sidebar picker) ──────────

  /** REQ 663 — rebuild the translucent hole previews. One drill
   * cylinder per placement, plus an entry-side counterbore cylinder
   * or countersink cone when those are selected. Cheap on every
   * input change since the meshes are tiny. */
  private rebuildHolePreviews(previews: HolePreview[]): void {
    // Tear down whatever's there.
    while (this.holePreviewGroup.children.length > 0) {
      const child = this.holePreviewGroup.children[0] as THREE.Mesh;
      this.holePreviewGroup.remove(child);
      child.geometry?.dispose?.();
      const mat = child.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat?.dispose?.();
    }
    if (previews.length === 0) return;
    const drillMat = new THREE.MeshBasicMaterial({
      color: 0xff9800, transparent: true, opacity: 0.35,
      depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const accentMat = new THREE.MeshBasicMaterial({
      color: 0xffc107, transparent: true, opacity: 0.30,
      depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    });
    /** Place a cylinder whose central axis runs from `origin` along
     * `dir` for `length` units, radius `radius`. THREE's
     * CylinderGeometry is Y-aligned by default; we build an orientation
     * matrix that rotates +Y onto `dir`. */
    const cyl = (origin: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, mat: THREE.Material) => {
      const geom = new THREE.CylinderGeometry(radius, radius, length, 32, 1, true);
      // Translate so the base sits at the origin (CylinderGeometry centers on its midpoint by default).
      geom.translate(0, length / 2, 0);
      const mesh = new THREE.Mesh(geom, mat);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      mesh.quaternion.copy(q);
      mesh.position.copy(origin);
      mesh.renderOrder = 12;  // above face fills + vertex pickers
      return mesh;
    };
    /** Cone tapering from `radius` at base (at `origin`) to 0 at
     * `origin + dir*length`. */
    const cone = (origin: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, mat: THREE.Material) => {
      const geom = new THREE.CylinderGeometry(0, radius, length, 32, 1, true);
      // Base at y=0 (top of the default Y-up cone is radius=0).
      geom.translate(0, length / 2, 0);
      // Default geometry has the radius=0 tip at +y and the radius=`radius` base at -y.
      // We want the BASE at the origin and the tip at +dir*length, so we flip the geometry.
      geom.rotateX(Math.PI);
      geom.translate(0, length, 0);
      const mesh = new THREE.Mesh(geom, mat);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      mesh.quaternion.copy(q);
      mesh.position.copy(origin);
      mesh.renderOrder = 12;
      return mesh;
    };
    for (const p of previews) {
      const origin = new THREE.Vector3(p.position[0], p.position[1], p.position[2]);
      const dir = new THREE.Vector3(p.axis[0], p.axis[1], p.axis[2]);
      if (dir.lengthSq() < 1e-9) continue;
      // Drill barrel — always rendered. Clamp absurd through-all
      // lengths to a sensible preview value so the cylinder doesn't
      // shoot off to infinity when end condition is "through all".
      const drillLen = Math.min(p.drillDepth, 200);
      this.holePreviewGroup.add(cyl(origin, dir, drillLen, p.drillDiameter / 2, drillMat));
      if (p.counterbore) {
        this.holePreviewGroup.add(cyl(origin, dir, p.counterbore.depth, p.counterbore.diameter / 2, accentMat));
      }
      if (p.countersink) {
        this.holePreviewGroup.add(cone(origin, dir, p.countersink.depth, p.countersink.diameter / 2, accentMat));
      }
    }
  }

  /** REQ 665 — OnShape-style cosmetic threads: stripe pattern band
   * around the inside cylindrical face of each tap-drill cut. Each
   * placement gets its own cylinder (radius = drillDia/2 − tiny
   * inset to sit just inside the carved face) with a procedural
   * canvas texture that repeats every `pitch` mm along the axis. */
  private rebuildCosmeticThreads(threads: CosmeticThread[]): void {
    while (this.cosmeticThreadGroup.children.length > 0) {
      const child = this.cosmeticThreadGroup.children[0] as THREE.Mesh;
      this.cosmeticThreadGroup.remove(child);
      child.geometry?.dispose?.();
      const mat = child.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat?.dispose?.();
    }
    if (threads.length === 0) return;
    // Reusable ray + temporary vectors for through-all length probes.
    const probe = new THREE.Raycaster();
    const probeOrigin = new THREE.Vector3();
    for (const t of threads) {
      const dir = new THREE.Vector3(t.axis[0], t.axis[1], t.axis[2]);
      if (dir.lengthSq() < 1e-9) continue;
      // Default length = the requested depth (or 200mm fallback for
      // Infinity sentinels). For through-all holes, override by
      // raycasting from inside the body along the hole axis to find
      // the exit face — the shell stops at the part's far surface.
      let len = Number.isFinite(t.depth) ? Math.min(t.depth, 200) : 200;
      if (t.fitToBody) {
        const norm = dir.clone().normalize();
        // Start the ray a hair inside the body so the entry face
        // doesn't itself get hit. 0.01mm offset is well below any
        // face mesh resolution we care about.
        probeOrigin.set(
          t.position[0] + norm.x * 0.01,
          t.position[1] + norm.y * 0.01,
          t.position[2] + norm.z * 0.01,
        );
        probe.set(probeOrigin, norm);
        const hits = probe.intersectObjects(this.faceGroup.children, false);
        if (hits.length > 0) {
          // Use the first exit hit + a small slop so the band ends
          // flush with the far face rather than poking past it.
          len = Math.max(0.1, hits[0].distance + 0.01);
        }
      }
      // Sit essentially ON the tap-drill face. Tiny inset (0.1%)
      // just to avoid z-fighting against the existing carved
      // cylinder; combined with polygonOffset this reads as part
      // of the face, not a separate cylinder.
      const r = (t.drillDiameter / 2) * 0.999;
      const geom = new THREE.CylinderGeometry(r, r, len, 48, 1, true);
      geom.translate(0, len / 2, 0);
      // Semi-transparent BLACK stripes: where the band falls, the
      // drill face renders ~50% darker — looks like shading on the
      // face. BackSide so the inward-facing wall is what's drawn
      // (matches the orientation of the carved hole's inside).
      const mat = new THREE.MeshBasicMaterial({
        map: this._makeThreadStripeTexture(len, t.pitch),
        color: 0xffffff, transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(geom, mat);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      mesh.quaternion.copy(q);
      mesh.position.set(t.position[0], t.position[1], t.position[2]);
      mesh.renderOrder = 18;
      this.cosmeticThreadGroup.add(mesh);
    }
  }
  /** Build a tiny canvas texture for cosmetic threads: dark amber
   * bands on a translucent background, repeated along the cylinder
   * axis at the thread pitch. UV mapping on Three's CylinderGeometry
   * runs U around the cylinder (0→1) and V along the axis (0→1), so
   * the V-axis repeat count = length / pitch. */
  private _makeThreadStripeTexture(length: number, pitch: number): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 4;     // U direction — pattern is invariant around the cylinder
    canvas.height = 16;   // V — one full pitch period spans this
    const ctx = canvas.getContext('2d')!;
    // Fully transparent base — the existing drill face shows
    // through between bands so the user reads the pattern as
    // shading ON the face rather than a separate cylinder.
    ctx.clearRect(0, 0, 4, 16);
    // One dark band per period: semi-transparent black, which
    // darkens whatever's behind it (the body's face color) without
    // tinting it. ~50% opacity gives a clear stripe without
    // overwhelming the face material underneath.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, 4, 7);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    // Number of pitch periods that fit in the cylinder length.
    const periods = Math.max(1, Math.round(length / Math.max(0.1, pitch)));
    tex.repeat.set(1, periods);
    tex.needsUpdate = true;
    return tex;
  }

  private rebuildProfileFills(fills: ProfileFill[]): void {
    for (const mesh of this.profileFillMeshes.values()) {
      this.profileFillGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.profileFillMeshes.clear();
    if (fills.length === 0) return;
    const selected = this.profileFillsSelected();
    const hovered = this.profileFillsHovered();
    for (const fill of fills) {
      const mesh = this.buildProfileFillMesh(fill);
      if (!mesh) continue;
      this.applyProfileFillStyle(mesh, fill.index, selected, hovered);
      this.profileFillGroup.add(mesh);
      this.profileFillMeshes.set(fill.index, mesh);
    }
  }

  private buildProfileFillMesh(fill: ProfileFill): THREE.Mesh | null {
    const poly = fill.polygon3d;
    if (poly.length < 3) return null;
    const holes3d = (fill.holePolygons3d ?? []).filter(h => h.length >= 3);
    // Triangulate in 2D using a plane-local basis derived from the polygon's
    // first edge + the supplied normal. Three.js's ShapeUtils.triangulateShape
    // expects coplanar Vector2 input + a holes array (also Vector2[]); we
    // project each vertex into the shared basis, triangulate, and use the
    // resulting indices against a flattened [outer, ...holes] 3D vertex
    // buffer (matching how triangulateShape returns indices into the
    // combined contour-then-holes vertex list).
    const n = new THREE.Vector3(fill.normal[0], fill.normal[1], fill.normal[2]).normalize();
    const u = new THREE.Vector3(
      poly[1][0] - poly[0][0],
      poly[1][1] - poly[0][1],
      poly[1][2] - poly[0][2],
    );
    // If the first edge is degenerate, fall back to an arbitrary in-plane axis.
    if (u.lengthSq() < 1e-12) {
      const helper = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      u.copy(helper).sub(n.clone().multiplyScalar(helper.dot(n)));
    }
    u.normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const origin = new THREE.Vector3(poly[0][0], poly[0][1], poly[0][2]);
    const toFlat = (p: [number, number, number]): THREE.Vector2 => {
      const d = new THREE.Vector3(p[0], p[1], p[2]).sub(origin);
      return new THREE.Vector2(d.dot(u), d.dot(v));
    };
    const outerFlat = poly.map(toFlat);
    const holesFlat = holes3d.map(h => h.map(toFlat));
    const triangles = THREE.ShapeUtils.triangulateShape(outerFlat, holesFlat);
    if (triangles.length === 0) return null;
    // Build the combined 3D vertex buffer in the same order
    // triangulateShape's indices reference: outer first, then each hole.
    const lift = 0.01;
    const combined: Array<[number, number, number]> = [
      ...poly,
      ...holes3d.flat(),
    ];
    const positions = new Float32Array(combined.length * 3);
    for (let i = 0; i < combined.length; i++) {
      positions[i * 3 + 0] = combined[i][0] + n.x * lift;
      positions[i * 3 + 1] = combined[i][1] + n.y * lift;
      positions[i * 3 + 2] = combined[i][2] + n.z * lift;
    }
    const indices: number[] = [];
    for (const tri of triangles) indices.push(tri[0], tri[1], tri[2]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.35,
      side: THREE.DoubleSide, depthWrite: false, depthTest: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData = { profileFillIndex: fill.index };
    mesh.renderOrder = 10;  // above faces/sketch overlays/preview so the
                            // user can always pick the region even when
                            // the sketch sits inside another body.
    return mesh;
  }

  private recolorProfileFills(selected: Set<number>, hovered: number | null): void {
    for (const [index, mesh] of this.profileFillMeshes) {
      this.applyProfileFillStyle(mesh, index, selected, hovered);
    }
  }

  private applyProfileFillStyle(
    mesh: THREE.Mesh, index: number, selected: Set<number>, hovered: number | null,
  ): void {
    const isSelected = selected.has(index);
    const isHovered = hovered === index;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (isSelected) {
      mat.color.setHex(isHovered ? 0xffd54f : 0xffb74d);  // selected = orange, brighter on hover
      mat.opacity = isHovered ? 0.55 : 0.45;
    } else {
      mat.color.setHex(isHovered ? 0xb0bec5 : 0x90a4ae);  // unselected = grey
      mat.opacity = isHovered ? 0.35 : 0.22;
    }
  }

  // ────────── Vertex-pick overlay (Up to Vertex end condition) ──────────

  private rebuildVertexMarkers(vertices: Array<{ id: string; position: [number, number, number] }>): void {
    for (const mesh of this.vertexPickMeshes.values()) {
      this.vertexPickGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.vertexPickMeshes.clear();
    if (vertices.length === 0) return;
    // Slightly oversize sphere + bright material; depthTest:false so it
    // stays clickable even when the vertex is behind a face. Like the
    // profile-fill overlay, render order is bumped so the markers paint
    // last.
    for (const v of vertices) {
      const geom = new THREE.SphereGeometry(1.5, 12, 8);
      // Invisible by default (opacity 0). The hover handler raises
      // opacity on the marker under the cursor so the user sees a dot
      // appear only on the active hover target. Raycaster still hits
      // transparent materials so the click-pick path continues to work.
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd54f, depthTest: false, depthWrite: false, transparent: true, opacity: 0,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(v.position[0], v.position[1], v.position[2]);
      mesh.userData = { vertexId: v.id };
      mesh.renderOrder = 11;  // above profile fills (10) + everything else
      this.vertexPickGroup.add(mesh);
      this.vertexPickMeshes.set(v.id, mesh);
    }
  }

  /** Raycast against the vertex-pick overlay. Returns the vertex id
   * under the pointer or null. Only called when vertexPickMode() is on. */
  private pickVertex(): string | null {
    if (!this.vertexPickGroup.visible || this.vertexPickMeshes.size === 0) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // intersectObjects with a generous threshold — spheres are small in
    // world units and a 5-pixel slop matches the rest of the picker
    // tolerances.
    const hits = this.raycaster.intersectObjects(this.vertexPickGroup.children, false);
    if (hits.length === 0) return null;
    const ud = hits[0].object.userData as { vertexId?: string };
    return ud.vertexId ?? null;
  }

  /** Rebuild the axis-pick overlay: one thin cylinder per candidate so the
   * raycaster (which doesn't pixel-pick THREE.Lines without extra setup)
   * can hit-test against a real volume. Cylinders are bright orange and
   * sit on top of all faces (depthTest:false, renderOrder bumped). */
  private rebuildAxisPickMarkers(
    candidates: Array<{ id: string; p1: [number, number, number]; p2: [number, number, number]; construction?: boolean }>,
    selectedId: string | null,
  ): void {
    while (this.axisPickGroup.children.length > 0) {
      const child = this.axisPickGroup.children.pop()!;
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      if (mat) Array.isArray(mat) ? mat.forEach(m => m.dispose()) : mat.dispose();
    }
    if (candidates.length === 0) return;
    const upY = new THREE.Vector3(0, 1, 0);
    for (const c of candidates) {
      const a = new THREE.Vector3(c.p1[0], c.p1[1], c.p1[2]);
      const b = new THREE.Vector3(c.p2[0], c.p2[1], c.p2[2]);
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      if (len < 1e-6) continue;
      dir.normalize();
      const geom = new THREE.CylinderGeometry(1.2, 1.2, len, 8, 1, false);
      const isSelected = c.id === selectedId;
      const mat = new THREE.MeshBasicMaterial({
        color: isSelected ? 0xffb74d : 0x42a5f5,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: isSelected ? 0.95 : 0.6,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(a).addScaledVector(dir, len / 2);
      // CylinderGeometry is oriented along +Y; rotate to match `dir`.
      mesh.quaternion.setFromUnitVectors(upY, dir);
      mesh.userData = { axisLineId: c.id };
      mesh.renderOrder = 12;
      this.axisPickGroup.add(mesh);
    }
  }

  /** Persistent highlight for the currently picked axis. Always visible
   * (when something is selected) so the user can SEE which sketched line
   * is the rotation axis without re-entering pick mode. One cylinder,
   * brighter orange than the in-picker highlight, slightly thicker so it
   * reads as the "committed" choice vs the "previewing options" state. */
  private rebuildSelectedAxisHighlight(
    candidates: Array<{ id: string; p1: [number, number, number]; p2: [number, number, number]; construction?: boolean }>,
    selectedId: string | null,
  ): void {
    while (this.selectedAxisHighlightGroup.children.length > 0) {
      const child = this.selectedAxisHighlightGroup.children.pop()!;
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      if (mat) Array.isArray(mat) ? mat.forEach(m => m.dispose()) : mat.dispose();
    }
    if (!selectedId) return;
    const cand = candidates.find(c => c.id === selectedId);
    if (!cand) return;
    const a = new THREE.Vector3(cand.p1[0], cand.p1[1], cand.p1[2]);
    const b = new THREE.Vector3(cand.p2[0], cand.p2[1], cand.p2[2]);
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-6) return;
    dir.normalize();
    // Slightly thicker than the picker cylinders (1.2) and a more
    // saturated orange so it reads as "committed" rather than a hover.
    const geom = new THREE.CylinderGeometry(1.6, 1.6, len, 12, 1, false);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff8a00,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(a).addScaledVector(dir, len / 2);
    const upY = new THREE.Vector3(0, 1, 0);
    mesh.quaternion.setFromUnitVectors(upY, dir);
    mesh.renderOrder = 13;  // above the axisPickGroup (12) so it stays visible during pick mode too
    this.selectedAxisHighlightGroup.add(mesh);
  }

  /** Paint a thick bright line on top of the edge with the given id.
   * Cheap: just one polyline per call. Used by Convert Entities to
   * preview which edge will be projected on the next click. */
  private _sameStringSet(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

  private _clearHoveredFaceEdges(): void {
    if (this.hoveredFaceEdgeIds().size > 0) this.hoveredFaceEdgeIds.set(new Set());
  }

  private _rebuildEdgeHoverHighlight(edgeId: string | null, pickedEdgeIds: Set<string> = new Set(), hoveredFaceEdgeIds: Set<string> = new Set()): void {
    while (this.edgeHoverHighlightGroup.children.length > 0) {
      const child = this.edgeHoverHighlightGroup.children.pop()!;
      const obj = child as THREE.Line;
      obj.geometry?.dispose();
      const mat = obj.material as THREE.Material | undefined;
      // Shared sketch materials (orange selection / cyan hover) are long-lived —
      // don't dispose them here or the next sketch repaint draws nothing.
      if (mat && mat !== this.selectedSketchMaterial && mat !== this.hoverSketchMaterial) {
        Array.isArray(mat) ? mat.forEach(m => m.dispose()) : mat.dispose();
      }
    }
    // In a sketch, projected model edges adopt the SAME look as sketch
    // entities: thick cyan on hover, thick orange when selected (shared Line2
    // materials). Outside a sketch, the legacy thin overlay colors apply.
    const inSketch = this.activeSketchId() !== null;
    // Helper: copy the stored line's positions and add a highlight overlay.
    // `thickMat` (sketch mode) renders a pixel-width Line2 in the shared
    // material; otherwise a thin LineBasicMaterial in `color`. Returns silently
    // if the edge id isn't in faceEdges (e.g. between regens).
    const addOverlay = (id: string, color: number, opacity: number, thickMat?: LineMaterial) => {
      const stored = this.faceEdges.get(`edge:${id}`);
      if (!stored) return;
      const src = stored.front.geometry as THREE.BufferGeometry;
      const positionAttr = src.getAttribute('position');
      if (!positionAttr) return;
      const positions = new Float32Array(positionAttr.array as ArrayLike<number>);
      if (thickMat) {
        const geom = new LineGeometry();
        geom.setPositions(Array.from(positions));
        const line = new Line2(geom, thickMat);
        line.computeLineDistances();
        line.renderOrder = 14;
        this.edgeHoverHighlightGroup.add(line);
        return;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity,
        linewidth: 3,
      });
      const line = new THREE.Line(geom, mat);
      line.renderOrder = 14;  // above face hover, above selected-axis
      this.edgeHoverHighlightGroup.add(line);
    };
    // Hovered-face boundary edges (sketch mode) — cyan hover style, painted
    // under the sticky/hover edge overlays so an explicit edge pick still wins.
    for (const id of hoveredFaceEdgeIds) addOverlay(id, 0x40c4ff, 0.95, inSketch ? this.hoverSketchMaterial : undefined);
    // Sticky picked/selected edges next, then the transient hover edge on top.
    // Sketch mode mirrors sketch entities: selected = orange, hover = cyan;
    // outside a sketch, the legacy medium-blue / orange overlay colors apply.
    for (const id of pickedEdgeIds) {
      if (id === edgeId) continue;  // skip — hover overlay covers it
      addOverlay(id, 0x1976d2, 0.95, inSketch ? this.selectedSketchMaterial : undefined);
    }
    if (edgeId) addOverlay(edgeId, 0xff8a00, 0.95, inSketch ? this.hoverSketchMaterial : undefined);
  }

  /** Apply / clear sticky highlight on picked vertex markers. Markers
   * are invisible (opacity 0) by default; ids in `pickedIds` get raised
   * to full opacity in the picked color. Updates every regen + every
   * pickedVertexIds change. */
  private _applyPickedVertexMarkers(pickedIds: Set<string>): void {
    for (const [id, mesh] of this.vertexPickMeshes) {
      const m = mesh.material as THREE.MeshBasicMaterial;
      // The hover handler (updateVertexHover) may have overridden
      // opacity for the cursor target; resetting here is fine —
      // updateVertexHover re-applies on the next pointermove.
      if (pickedIds.has(id)) {
        m.color.setHex(0x1976d2);
        m.opacity = 0.95;
      } else if (id !== this.lastHoveredVertexId) {
        m.color.setHex(0xffd54f);
        m.opacity = 0;
      }
    }
  }

  /** Rebuild the datum-plane preview overlay. One translucent square
   * oriented to the computed plane, sized relative to the model. Null
   * input clears the overlay. */
  private _rebuildDatumPlanePreview(
    pv: { origin: [number, number, number]; xAxis: [number, number, number]; yAxis: [number, number, number]; normal: [number, number, number] } | null,
  ): void {
    while (this.datumPlanePreviewGroup.children.length > 0) {
      const child = this.datumPlanePreviewGroup.children.pop()!;
      const m = (child as THREE.Mesh | THREE.Line).geometry;
      if (m) m.dispose();
      const mat = (child as any).material as THREE.Material | undefined;
      if (mat) (Array.isArray(mat) ? mat.forEach(x => x.dispose()) : mat.dispose());
    }
    if (!pv) return;
    // Size the quad relative to the model so it stays visually
    // proportional regardless of part scale. Fall back to a fixed
    // 80mm side when no model is loaded yet.
    const box = new THREE.Box3().setFromObject(this.faceGroup);
    const diag = box.isEmpty() ? 80 : box.getSize(new THREE.Vector3()).length();
    const size = Math.max(40, diag * 0.6);
    // Build a quad spanning [-s/2, +s/2] in the plane's basis, anchored
    // at the plane origin. Two triangles via PlaneGeometry, then
    // orient via the basis vectors.
    const geom = new THREE.PlaneGeometry(size, size);
    // Default PlaneGeometry lies in XY with normal +Z. We rotate so
    // its normal aligns with the target plane's normal by constructing
    // a basis matrix from xAxis/yAxis/normal directly.
    const m4 = new THREE.Matrix4();
    m4.makeBasis(
      new THREE.Vector3(pv.xAxis[0], pv.xAxis[1], pv.xAxis[2]),
      new THREE.Vector3(pv.yAxis[0], pv.yAxis[1], pv.yAxis[2]),
      new THREE.Vector3(pv.normal[0], pv.normal[1], pv.normal[2]),
    );
    m4.setPosition(pv.origin[0], pv.origin[1], pv.origin[2]);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb74d,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.applyMatrix4(m4);
    mesh.renderOrder = 11;
    this.datumPlanePreviewGroup.add(mesh);
    // Edge outline so the plane reads as bordered even when the fill
    // is faint. Cheap: build a closed loop from the four corners.
    const half = size / 2;
    const corners: THREE.Vector3[] = [
      new THREE.Vector3(-half, -half, 0),
      new THREE.Vector3( half, -half, 0),
      new THREE.Vector3( half,  half, 0),
      new THREE.Vector3(-half,  half, 0),
      new THREE.Vector3(-half, -half, 0),
    ];
    const lineGeom = new THREE.BufferGeometry().setFromPoints(corners);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffb74d, transparent: true, opacity: 0.9 });
    const outline = new THREE.Line(lineGeom, lineMat);
    outline.applyMatrix4(m4);
    outline.renderOrder = 12;
    this.datumPlanePreviewGroup.add(outline);
  }

  /** Rebuild the pattern preview overlay. Clones every mesh in
   * `faceGroup` (the live body geometry) once per transform in the
   * preview's list, applies the transform's Matrix4, and renders the
   * clone in a ghost material. Translates / rotates / mirrors are
   * supported one-to-one with the kernel's PatternTransform enum.
   * REQ 658. */
  private _rebuildPatternPreview(
    pv: {
      kind: 'mirror' | 'linearPattern' | 'circularPattern';
      transforms: Array<
        | { kind: 'translate'; dx: number; dy: number; dz: number }
        | { kind: 'rotate'; origin: [number, number, number]; direction: [number, number, number]; angleRad: number }
        | { kind: 'mirror'; origin: [number, number, number]; normal: [number, number, number] }
      >;
    } | null,
  ): void {
    while (this.patternPreviewGroup.children.length > 0) {
      const child = this.patternPreviewGroup.children.pop()!;
      const m = (child as THREE.Mesh).geometry;
      if (m) m.dispose();
      const mat = (child as any).material as THREE.Material | undefined;
      if (mat) (Array.isArray(mat) ? mat.forEach(x => x.dispose()) : mat.dispose());
    }
    if (!pv || pv.transforms.length === 0) return;
    if (this.faceGroup.children.length === 0) return;
    // One ghost material shared across every cloned mesh — cheap, and
    // hover/selection don't interact with the preview group (it never
    // ends up in the raycast list).
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0xffb74d,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    // When the upstream body is multi-solid (e.g. user is creating a
    // new pattern downstream of an existing pattern), `faceGroup`
    // contains faces from every solid. Cloning the whole thing at each
    // transform would show "pattern of a pattern" — N transforms × M
    // solids ghosts — which the user reads as wrong. For linear /
    // circular preview, restrict the source set to ONE solid so the
    // preview is N ghosts (one per transform). Mirror keeps everything
    // because reflecting a single solid hides what the actual mirror
    // does to the rest of the body. Pick the lexically-smallest body
    // suffix as "the source solid" — arbitrary but stable. Faces
    // outside a multi-solid context (no body suffix) all pass through.
    const sourceMeshes = pv.kind === 'mirror'
      ? this.faceGroup.children
      : filterToFirstBody(this.faceGroup.children);
    for (const t of pv.transforms) {
      const m4 = patternTransformToMatrix4(t);
      for (const src of sourceMeshes) {
        const srcMesh = src as THREE.Mesh;
        if (!srcMesh.geometry) continue;
        const clone = new THREE.Mesh(srcMesh.geometry, ghostMat);
        clone.applyMatrix4(m4);
        clone.matrixAutoUpdate = false;
        clone.updateMatrix();
        clone.renderOrder = 11;
        this.patternPreviewGroup.add(clone);
      }
    }
  }

  /** Rebuild the shell preview overlay. For each picked face id,
   * find the corresponding mesh in `faceGroup` and clone it with a
   * translucent red material so the user sees what faces will be cut
   * away. Faces that no longer exist in faceGroup (e.g. between
   * regens) silently drop out — re-picking refreshes them. REQ 659. */
  private _rebuildShellPreview(
    pv: { faceIds: string[]; thickness: number; direction: 'inward' | 'outward' } | null,
  ): void {
    while (this.shellPreviewGroup.children.length > 0) {
      const child = this.shellPreviewGroup.children.pop()!;
      const g = (child as THREE.Mesh).geometry;
      if (g) g.dispose();
      const mat = (child as any).material as THREE.Material | undefined;
      if (mat) (Array.isArray(mat) ? mat.forEach(x => x.dispose()) : mat.dispose());
    }
    if (!pv || pv.faceIds.length === 0) return;
    // Distinct red overlay — different from the orange used for
    // datum-plane / pattern previews so "this gets removed" reads as
    // destructive at a glance, not just "selected".
    const removeMat = new THREE.MeshBasicMaterial({
      color: 0xe53935,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
      // Push the overlay slightly forward so it wins the depth test
      // against the underlying body face it's mirroring (otherwise
      // GPU z-fighting splotches red and base color).
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const wanted = new Set(pv.faceIds);
    for (const src of this.faceGroup.children) {
      const ud = (src as THREE.Object3D).userData as { faceId?: string };
      if (!ud.faceId || !wanted.has(ud.faceId)) continue;
      const srcMesh = src as THREE.Mesh;
      if (!srcMesh.geometry) continue;
      const clone = new THREE.Mesh(srcMesh.geometry, removeMat);
      clone.renderOrder = 12;
      this.shellPreviewGroup.add(clone);
    }
  }

  /** Rebuild the 3D fillet/chamfer preview overlay. For each picked
   * edge: copy its geometry into a bright highlight line, plus a
   * translucent tube (fillet — radius = value) or two parallel offset
   * lines (chamfer — distance = value) so the user sees the blend
   * extent before committing. Edges that no longer exist in `faceEdges`
   * (e.g. between regens) fall back to a straight line between the
   * stored endpoints. */
  private _rebuildEdgeBlendPreview(
    pv: { kind: 'fillet' | 'chamfer'; value: number; edges: Array<{ edgeId: string; start: [number, number, number]; end: [number, number, number] }> } | null,
  ): void {
    while (this.edgeBlendPreviewGroup.children.length > 0) {
      const child = this.edgeBlendPreviewGroup.children.pop()!;
      const obj = child as THREE.Line | THREE.Mesh;
      (obj as any).geometry?.dispose();
      const mat = (obj as any).material as THREE.Material | undefined;
      if (mat) Array.isArray(mat) ? mat.forEach(m => m.dispose()) : mat.dispose();
    }
    if (!pv || pv.edges.length === 0) return;
    // Compute model-relative tube radius. WebGL's LineBasicMaterial.linewidth
    // is fixed at 1px regardless of value, so for a visible highlight we
    // sweep a thin tube along the edge instead. 0.4% of the model diagonal
    // gives a fat colored line that reads well at any zoom.
    const modelBox = new THREE.Box3().setFromObject(this.faceGroup);
    const diag = modelBox.isEmpty() ? 1 : modelBox.getSize(new THREE.Vector3()).length();
    const tubeRadius = Math.max(0.05, diag * 0.004);
    const isFillet = pv.kind === 'fillet';
    const highlightColor = isFillet ? 0x42a5f5 : 0xffb74d;
    const highlightMat = new THREE.MeshBasicMaterial({
      color: highlightColor,
      // depthTest off so the highlight sits on top of the body without
      // z-fighting with the actual edge lines or the face it lives on.
      depthTest: false, depthWrite: false,
      transparent: true, opacity: 0.95,
    });

    for (const e of pv.edges) {
      // Prefer the analytic polyline from the topology-edge group (smooth
      // curves); fall back to a straight segment between stored endpoints
      // when the edge id no longer matches (post-regen renumbering).
      let curvePoints: THREE.Vector3[] | null = null;
      for (const obj of this.edgeGroup.children) {
        const ud = (obj as any).userData as { edgeId?: string } | undefined;
        if (ud?.edgeId === e.edgeId && (obj as any).geometry?.getAttribute?.('position')) {
          const a = (obj as any).geometry.getAttribute('position').array as ArrayLike<number>;
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i < a.length; i += 3) pts.push(new THREE.Vector3(a[i], a[i + 1], a[i + 2]));
          if (pts.length >= 2) { curvePoints = pts; break; }
        }
      }
      if (!curvePoints) {
        curvePoints = [new THREE.Vector3(...e.start), new THREE.Vector3(...e.end)];
      }
      // Skip degenerate (zero-length) edges — TubeGeometry rejects them
      // and a zero-length highlight reads as visual noise.
      let span = 0;
      for (let i = 0; i + 1 < curvePoints.length; i++) span += curvePoints[i].distanceTo(curvePoints[i + 1]);
      if (span < 1e-6) continue;
      const curve = new THREE.CatmullRomCurve3(curvePoints, false, 'catmullrom', 0.0);
      const tubularSegments = Math.max(8, curvePoints.length * 2);
      const tubeGeom = new THREE.TubeGeometry(curve, tubularSegments, tubeRadius, 8, false);
      const mesh = new THREE.Mesh(tubeGeom, highlightMat);
      mesh.renderOrder = 14;
      this.edgeBlendPreviewGroup.add(mesh);
    }
  }

  /** Raycast against axis-pick overlay. Only called when axisPickMode is on. */
  private pickAxis(): string | null {
    if (!this.axisPickGroup.visible || this.axisPickGroup.children.length === 0) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.axisPickGroup.children, false);
    if (hits.length === 0) return null;
    const ud = hits[0].object.userData as { axisLineId?: string };
    return ud.axisLineId ?? null;
  }

  /** Raycast against the profile-fill overlay. Returns the loop index
   * under the pointer, or null. Called from the click + pointermove
   * handlers before the regular face/datum pick path. */
  private pickProfileFill(): number | null {
    if (this.profileFillMeshes.size === 0) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.profileFillGroup.children, false);
    if (hits.length === 0) return null;
    const ud = hits[0].object.userData as { profileFillIndex?: number };
    return typeof ud.profileFillIndex === 'number' ? ud.profileFillIndex : null;
  }

  /** Attach press-and-drag handlers to the label DOM. Below the drag
   * threshold, the gesture resolves as a click → opens the inline editor.
   * Past the threshold, every pointermove emits a live placement update;
   * pointerup emits a final commit-flagged update so the editor saves. */
  private attachDimensionDragHandlers(el: HTMLDivElement, constraintId: string): void {
    const DRAG_PX = 3;
    // Pointer-capture on `el` itself doesn't survive a drag: every live
    // `dimensionDragged` emit (commit:false) triggers a state update that
    // re-runs syncSketches, which tears down `el` and creates a new DOM
    // node for the same dimension. The capture on the now-detached node
    // is silently released, so further pointermoves never reach us.
    //
    // Document-level move/up listeners side-step the rebuild: they live on
    // `document`, which doesn't get torn down, and the constraintId is
    // bound by closure so subsequent emits address the right constraint
    // even after its label DOM has been replaced.
    el.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const downX = ev.clientX, downY = ev.clientY;
      let dragging = false;

      const moveHandler = (ev2: PointerEvent) => {
        const dx = ev2.clientX - downX, dy = ev2.clientY - downY;
        if (!dragging && Math.hypot(dx, dy) < DRAG_PX) return;
        dragging = true;
        const sketchPoint = this.toSketchCoords(ev2);
        if (!sketchPoint) return;
        this.zone.run(() =>
          this.dimensionDragged.emit({ id: constraintId, placement: sketchPoint, commit: false }),
        );
      };
      const upHandler = (ev2: PointerEvent) => {
        document.removeEventListener('pointermove', moveHandler);
        document.removeEventListener('pointerup', upHandler);
        if (!dragging) {
          // Stationary press-release → treat as a single click on the label.
          this.zone.run(() => this.dimensionLabelClicked.emit(constraintId));
          return;
        }
        const sketchPoint = this.toSketchCoords(ev2);
        if (sketchPoint) {
          this.zone.run(() =>
            this.dimensionDragged.emit({ id: constraintId, placement: sketchPoint, commit: true }),
          );
        }
      };
      document.addEventListener('pointermove', moveHandler);
      document.addEventListener('pointerup', upHandler);
    });
  }

  /** Project a dimension's 2D geometry onto the sketch plane and add the
   * dimension + extension lines to the overlay group as plain Three.js
   * lines. Each dimension line gets traditional drawing arrowheads at
   * both ends. `dashed` flips between solid (committed) and dashed
   * (preview). */
  private addDimensionLines(
    group: THREE.Group, sketch: Sketch, dim: DimensionRender,
    color: number, dashed: boolean = false,
  ): void {
    const mkLine = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const pts = [this.project2DTo3D(sketch, a), this.project2DTo3D(sketch, b)];
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color, dashSize: 1.2, gapSize: 0.6, depthTest: false })
        : new THREE.LineBasicMaterial({ color, depthTest: false });
      const line = new THREE.Line(geom, mat);
      if (dashed) line.computeLineDistances();
      line.renderOrder = 3;
      return line;
    };
    if (dim.dimensionLine) {
      const [a, b] = dim.dimensionLine;
      group.add(mkLine(a, b));
      // Skip arrows in dashed preview mode since the user is still placing.
      if (!dashed) {
        if (dim.arrowsOutside) {
          // Exterior: arrowheads BEYOND each end pointing inward, with a short
          // stub of the dimension line out to each arrow's base.
          const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
          const al = this.orbitDistance * DIM_ARROW_LEN_FRAC;
          const ux = (dx / L) * al, uy = (dy / L) * al;
          const outA = { x: a.x - ux, y: a.y - uy };
          const outB = { x: b.x + ux, y: b.y + uy };
          group.add(mkLine(a, outA));
          group.add(mkLine(b, outB));
          group.add(this.makeDimArrowhead(sketch, a, outA, color));
          group.add(this.makeDimArrowhead(sketch, b, outB, color));
        } else {
          // Interior (default): arrowheads at each end, tips at the witness lines.
          group.add(this.makeDimArrowhead(sketch, a, b, color));
          group.add(this.makeDimArrowhead(sketch, b, a, color));
        }
      }
    }
    // Angle dimensions render an arc between the two lines (no chord, no vertex
    // lines). Tessellate the arc into a polyline and put tangent arrowheads at
    // each end pointing outward.
    if (dim.arc) {
      const { center, radius, startAngle, endAngle } = dim.arc;
      const SEG = Math.max(8, Math.ceil(Math.abs(endAngle - startAngle) / (Math.PI / 32)));
      const onArc = (ang: number) => ({ x: center.x + radius * Math.cos(ang), y: center.y + radius * Math.sin(ang) });
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= SEG; s++) pts.push(this.project2DTo3D(sketch, onArc(startAngle + (endAngle - startAngle) * (s / SEG))));
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color, dashSize: 1.2, gapSize: 0.6, depthTest: false })
        : new THREE.LineBasicMaterial({ color, depthTest: false });
      const arcLine = new THREE.Line(geom, mat);
      if (dashed) arcLine.computeLineDistances();
      arcLine.renderOrder = 3;
      group.add(arcLine);
      if (!dashed) {
        // Inside: arrow base steps INTO the span (tip points outward at each
        // end). Outside: base steps beyond the span (tip points inward).
        const e = (endAngle - startAngle) * 0.08;
        const eps = dim.arrowsOutside ? -e : e;
        group.add(this.makeDimArrowhead(sketch, onArc(startAngle), onArc(startAngle + eps), color));
        group.add(this.makeDimArrowhead(sketch, onArc(endAngle), onArc(endAngle - eps), color));
      }
    }
    for (const ext of dim.extensionLines) group.add(mkLine(ext[0], ext[1]));
  }

  /** Build a small filled triangular arrowhead at `tip`, pointing away
   * from `from`. Two-sided so it reads from either camera side. Sized
   * from orbitDistance so the arrowhead stays a CONSTANT on-screen size
   * at any zoom (the overlay rebuilds on viewEpoch zoom steps), matching
   * the sketch points / origin marker / hover hints. */
  private makeDimArrowhead(
    sketch: Sketch, tip: { x: number; y: number }, from: { x: number; y: number }, color: number,
  ): THREE.Mesh {
    const ARROW_LEN = this.orbitDistance * DIM_ARROW_LEN_FRAC;
    const ARROW_HALF_WIDTH = this.orbitDistance * DIM_ARROW_WIDTH_FRAC;
    const dx = tip.x - from.x, dy = tip.y - from.y;
    const len = Math.hypot(dx, dy);
    // Direction from `from` to `tip` (the arrow's forward axis in 2D).
    const ux = len < 1e-9 ? 1 : dx / len;
    const uy = len < 1e-9 ? 0 : dy / len;
    const nx = -uy, ny = ux;  // perpendicular
    // Triangle in 2D sketch coords: tip + two base points on the line
    // running back ARROW_LEN units, splayed ARROW_HALF_WIDTH to each side.
    const baseCenter = { x: tip.x - ux * ARROW_LEN, y: tip.y - uy * ARROW_LEN };
    const left  = { x: baseCenter.x + nx * ARROW_HALF_WIDTH, y: baseCenter.y + ny * ARROW_HALF_WIDTH };
    const right = { x: baseCenter.x - nx * ARROW_HALF_WIDTH, y: baseCenter.y - ny * ARROW_HALF_WIDTH };
    const p0 = this.project2DTo3D(sketch, tip);
    const p1 = this.project2DTo3D(sketch, left);
    const p2 = this.project2DTo3D(sketch, right);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(
      [p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z], 3,
    ));
    geom.setIndex([0, 1, 2]);
    geom.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 4;
    return mesh;
  }

  /** Build a small clickable handle (shown on a SELECTED dimension's arrow ends)
   * that flips the arrowheads inside/outside on click (SolidWorks-style). */
  private buildArrowHandleElement(constraintId: string): HTMLDivElement {
    const div = document.createElement('div');
    div.textContent = '⇄';
    Object.assign(div.style, {
      width: '14px', height: '14px', lineHeight: '14px', textAlign: 'center',
      fontSize: '11px', color: '#1e1e1e', background: '#ffb74d',
      border: '1px solid #1e1e1e', borderRadius: '50%',
      cursor: 'pointer', userSelect: 'none', pointerEvents: 'auto',
      transform: 'translate(-50%, -50%)',
    });
    div.title = 'Flip arrows inside/outside';
    // Toggle on pointerup (not 'click'): preventDefault on pointerdown can
    // suppress a synthetic click in some browsers. stopPropagation keeps the
    // canvas/label from also reacting (which would deselect the dimension).
    div.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    div.addEventListener('pointerup', (ev) => {
      ev.stopPropagation();
      this.zone.run(() => this.dimensionArrowsToggled.emit(constraintId));
    });
    return div;
  }

  /** Build the static, click-to-select, drag-to-reposition, dbl-click-
   * to-edit dimension label. Plain yellow text with a dark text-shadow
   * for legibility — no pill (matches traditional engineering drawings).
   * The single-click vs drag disambiguation is in `attachDimensionDrag-
   * Handlers`; double-click is wired separately. Selected dimensions
   * render in orange so the user can see what Delete will remove. */
  private buildDimensionLabelElement(constraintId: string, text: string, drivenExpr: string | null = null): HTMLDivElement {
    const isSelected = this.selectedConstraintId() === constraintId;
    const div = document.createElement('div');
    // Prefix a Σ glyph + style differently when the dim is driven by
    // an equation — same color family as the equation panel's badge so
    // they read as the same concept. Tooltip surfaces the expression
    // text on hover.
    if (drivenExpr !== null) {
      div.textContent = `Σ ${text}`;
      div.title = `= ${drivenExpr}`;
    } else {
      div.textContent = text;
    }
    div.dataset['constraintId'] = constraintId;
    const drivenColor = '#ffc107';
    Object.assign(div.style, {
      padding: '2px 4px',
      color: isSelected ? '#ffb74d' : (drivenExpr !== null ? drivenColor : '#ffeb3b'),
      textShadow:
        '0 0 2px #000, 0 0 2px #000, 1px 0 0 #000, -1px 0 0 #000,'
        + ' 0 1px 0 #000, 0 -1px 0 #000',
      font: (isSelected ? '700' : '500') + ' 12px monospace',
      fontStyle: drivenExpr !== null ? 'italic' : 'normal',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      cursor: 'move',
      pointerEvents: 'auto',
    });
    this.attachDimensionDragHandlers(div, constraintId);
    // Double-click opens the inline value editor.
    div.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      this.zone.run(() => this.dimensionDoubleClicked.emit(constraintId));
    });
    div.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // REQ 855: menu instead of immediate delete — destructive-on-right-click
      // was an accident magnet and left no home for the driven toggle.
      this.zone.run(() => this.dimensionContextMenu.emit({
        id: constraintId, clientX: ev.clientX, clientY: ev.clientY,
      }));
    });
    return div;
  }

  /** Build the inline-edit <input> that replaces the label while the user
   * is typing a new value. Enter commits, Esc cancels, blur commits (SW
   * convention). Auto-focuses + selects on mount so the user can just
   * type immediately. */
  private buildDimensionEditorElement(
    constraintId: string, value: number, isAngle: boolean,
    dimUnit: Unit | undefined, defaultUnit: Unit, drivenExpr: string | null = null,
  ): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    // Pre-fill: when driven by an equation, show `=expression` so the
    // user edits the binding instead of overwriting it accidentally with
    // a literal. Otherwise: angle → degrees; length → value in the dim's
    // effective unit with a unit suffix.
    if (drivenExpr !== null) {
      input.value = `=${drivenExpr}`;
    } else if (isAngle) {
      input.value = formatNumber(value * 180 / Math.PI);
    } else {
      // Always include the unit suffix so the user sees and can re-type
      // the explicit unit — bare numbers are interpreted as the suffix
      // shown, which is whatever this dim is currently using.
      const u: Unit = dimUnit ?? defaultUnit;
      input.value = `${formatNumber(fromMm(value, u))} ${unitSymbol(u)}`;
    }
    input.dataset['constraintId'] = constraintId;
    Object.assign(input.style, {
      padding: '2px 6px',
      width: '80px',
      background: '#1e1e2e',
      color: '#ffeb3b',
      border: '1px solid #ffeb3b',
      borderRadius: '3px',
      font: '500 11px monospace',
      outline: 'none',
      pointerEvents: 'auto',
    });
    requestAnimationFrame(() => { input.focus(); input.select(); });
    const commit = () => {
      const raw = input.value.trim();
      if (!raw) { this.zone.run(() => this.dimensionCanceled.emit()); return; }
      this.zone.run(() => this.dimensionCommitted.emit({ id: constraintId, raw }));
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();  // sketch editor's document-level keydown shouldn't see Delete/Esc here
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); this.zone.run(() => this.dimensionCanceled.emit()); return; }
      // Delete / Backspace with the WHOLE value selected ⇒ delete the
      // dim, not clear the input. Matches the natural flow: editor opens
      // with the value pre-selected, user presses Delete to remove. Once
      // the user has typed or moved the caret, Delete/Backspace revert
      // to normal text-editing behavior.
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? 0;
        const wholeSelected = start === 0 && end === input.value.length && input.value.length > 0;
        if (wholeSelected) {
          ev.preventDefault();
          this.zone.run(() => this.dimensionDeleteRequested.emit(constraintId));
        }
      }
    });
    input.addEventListener('blur', () => commit());
    input.addEventListener('click', (ev) => ev.stopPropagation());
    return input;
  }

  private project2DTo3D(sketch: Sketch, p: { x: number; y: number }): THREE.Vector3 {
    const o = new THREE.Vector3(...sketch.plane.origin);
    const x = new THREE.Vector3(...sketch.plane.xAxis);
    const y = new THREE.Vector3(...sketch.plane.yAxis);
    return o.clone().addScaledVector(x, p.x).addScaledVector(y, p.y);
  }

  private buildSketchOverlay(sketch: Sketch, isActive: boolean, selectedSet: Set<string>, axisId: string | null = null): THREE.Group {
    const group = new THREE.Group();
    group.userData = { sketchId: sketch.id };
    // Dimensional constraints render with full SolidWorks-style geometry:
    // extension lines from each measured feature, a dimension line they
    // pin against, and a CSS2D value pill. The label for the currently-
    // editing dimension swaps to an editable <input>. Only the active
    // sketch shows dimensions to avoid clutter when multiple sketches
    // are visible.
    if (isActive) {
      const editingId = this.editingDimensionId();
      const driven = this.drivenDimensions();
      // Use the LIVE candidates (input) for the active sketch — the stored
      // `sketch.candidates` snapshot is stale/null, so point→edge dimensions
      // (which resolve the edge line by candidate) wouldn't render off it.
      const liveCands = this.sketchCandidates();
      const extEdges = externalEdgeLinesFromCandidates(liveCands.length ? liveCands : (sketch.candidates ?? []));
      for (const dim of dimensionRenders(sketch.state, this.defaultUnit(), extEdges)) {
        this.addDimensionLines(group, sketch, dim, 0xffeb3b);
        const constraint = sketch.state.constraints.find(c => c.id === dim.constraintId);
        const isEditing = dim.constraintId === editingId;
        const drivenExpr = driven[dim.constraintId] ?? null;
        const el = isEditing
          ? this.buildDimensionEditorElement(dim.constraintId, constraint?.value ?? 0, constraint?.type === 'angle', constraint?.unit, this.defaultUnit(), drivenExpr)
          : this.buildDimensionLabelElement(dim.constraintId, dim.text, drivenExpr);
        const obj = new CSS2DObject(el);
        obj.position.copy(this.project2DTo3D(sketch, dim.labelAnchor));
        group.add(obj);
        // SolidWorks-style arrow handles: when this dimension is SELECTED, place
        // a small clickable handle at each arrow end. Clicking flips the
        // arrowheads inside/outside via dimensionArrowsToggled.
        if (this.selectedConstraintId() === dim.constraintId && !isEditing) {
          const ends: Array<{ x: number; y: number }> = dim.dimensionLine
            ? [dim.dimensionLine[0], dim.dimensionLine[1]]
            : dim.arc
              ? [
                  { x: dim.arc.center.x + dim.arc.radius * Math.cos(dim.arc.startAngle), y: dim.arc.center.y + dim.arc.radius * Math.sin(dim.arc.startAngle) },
                  { x: dim.arc.center.x + dim.arc.radius * Math.cos(dim.arc.endAngle), y: dim.arc.center.y + dim.arc.radius * Math.sin(dim.arc.endAngle) },
                ]
              : [];
          for (const end of ends) {
            const h = new CSS2DObject(this.buildArrowHandleElement(dim.constraintId));
            h.position.copy(this.project2DTo3D(sketch, end));
            group.add(h);
          }
        }
      }
      // In-progress Smart Dim preview — orange/dashed render of the
      // dimension that WOULD be committed at the current cursor.
      const preview = this.smartDimPreview();
      if (preview) {
        this.addDimensionLines(group, sketch, preview, 0xffb74d, true);
        const div = document.createElement('div');
        div.textContent = preview.text;
        Object.assign(div.style, {
          padding: '2px 6px',
          background: 'rgba(40, 30, 10, 0.85)',
          color: '#ffb74d',
          border: '1px dashed #ffb74d',
          borderRadius: '3px',
          font: '500 11px monospace',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        });
        const obj = new CSS2DObject(div);
        obj.position.copy(this.project2DTo3D(sketch, preview.labelAnchor));
        group.add(obj);
      }
    }
    // Active sketch gets an origin marker (small sphere + red X axis + green Y
    // axis in the sketch's local basis directions) so the user can see where
    // (0, 0) is and which way is +X / +Y in the 2D plane.
    if (isActive) group.add(this.buildSketchOriginMarker(sketch));
    const project = (p: { x: number; y: number }) => this.project2DTo3D(sketch, p);
    for (const e of sketch.state.entities) {
      const obj = this.buildSketchEntity(sketch, e, project, selectedSet, axisId);
      if (obj) group.add(obj);
    }
    // DEBUG overlay (debug toggle): the pick "area of influence" around each
    // sketch element — the tolerance boundary within which a hover/click
    // resolves to that element. Dashed pink outlines.
    if (isActive && this.debugVisible() && this.showInfluence()) this._buildSketchInfluenceOverlay(sketch, group, project);
    // SolidWorks-style mini constraint badges next to each selected entity.
    // One flex container per entity; all badges for that entity sit inside
    // it, so spacing stays fixed in screen pixels (CSS gap) instead of
    // sketch units that overlap when zoomed in.
    if (isActive) {
      for (const entityId of selectedSet) {
        const g = constraintIconsForEntity(sketch.state, entityId);
        if (!g) continue;
        const container = this.buildConstraintIconCluster(g);
        const obj = new CSS2DObject(container);
        obj.position.copy(this.project2DTo3D(sketch, g.anchor));
        group.add(obj);
      }
    }
    return group;
  }

  /** DEBUG: outline the pick "area of influence" for each sketch element — the
   * region within `tolerance` of the element, inside which a hover/click
   * resolves to it. Mirrors `distanceToEntity`: points get a disk (the larger
   * point tolerance), curves a band at ±curve-tolerance, line ends rounded
   * caps. Dashed pink, zoom-adaptive tolerances (same px → sketch-unit
   * conversion the picker uses). Added to the overlay only when debug is on. */
  private _buildSketchInfluenceOverlay(
    sketch: Sketch, group: THREE.Group,
    project: (p: { x: number; y: number }) => THREE.Vector3,
  ): void {
    const curveTol = this.pixelsToSketchUnits(this.PICK_PX);
    const pointTol = this.pixelsToSketchUnits(this.POINT_PICK_PX);
    const chord = this.sketchChordTol();
    const color = 0xff4081;  // pink — distinct from the cyan/orange highlights
    const addLoop = (pts2: { x: number; y: number }[]) => {
      if (pts2.length < 2) return;
      group.add(this.makeLineSegments(pts2.map(project), color, true));
    };
    const circle = (c: { x: number; y: number }, r: number) => {
      if (r > 1e-6) addLoop(tessellateCircle(c, r, chord));
    };
    for (const e of sketch.state.entities) {
      if (e.construction) continue;  // construction geometry isn't pick-prioritized the same way
      switch (e.kind) {
        case 'point':
          circle(e, pointTol);
          break;
        case 'line': {
          const a = findPoint(sketch.state, e.startId);
          const b = findPoint(sketch.state, e.endId);
          if (!a || !b) break;
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * curveTol, ny = (dx / len) * curveTol;
          addLoop([{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }]);
          addLoop([{ x: a.x - nx, y: a.y - ny }, { x: b.x - nx, y: b.y - ny }]);
          circle(a, curveTol);   // rounded caps (full circle reads clearly enough)
          circle(b, curveTol);
          break;
        }
        case 'circle': {
          const c = findPoint(sketch.state, e.centerId);
          if (!c) break;
          const r = (e as CircleEntity).radius;
          circle(c, r + curveTol);
          circle(c, r - curveTol);
          break;
        }
        case 'arc': {
          const arc = e as ArcEntity;
          const c = findPoint(sketch.state, arc.centerId);
          const s = findPoint(sketch.state, arc.startId);
          const f = findPoint(sketch.state, arc.endId);
          if (!c || !s || !f) break;
          const sa = Math.atan2(s.y - c.y, s.x - c.x);
          const ea = Math.atan2(f.y - c.y, f.x - c.x);
          addLoop(tessellateArc({ x: c.x, y: c.y }, arc.radius + curveTol, sa, ea, arc.ccw, chord));
          if (arc.radius - curveTol > 1e-6) {
            addLoop(tessellateArc({ x: c.x, y: c.y }, arc.radius - curveTol, sa, ea, arc.ccw, chord));
          }
          circle(s, curveTol);   // endpoint caps
          circle(f, curveTol);
          break;
        }
        // ellipse/spline/conic: influence band omitted (debug-only).
      }
    }
    // Projected MODEL edges/vertices — the candidates the picker snaps to.
    // Edges use the wider sketch-mode hover buffer; drawn in orange so they
    // read apart from the pink sketch-element zones.
    const edgeTol = this.pixelsToSketchUnits(this.SKETCH_EDGE_HOVER_PX);
    const edgeColor = 0xffa726;  // orange — projected geometry
    const addEdgeLoop = (pts2: { x: number; y: number }[]) => {
      if (pts2.length >= 2) group.add(this.makeLineSegments(pts2.map(project), edgeColor, true));
    };
    for (const cand of this.sketchCandidates()) {
      if (cand.kind === 'vertex') {
        const v = cand.points[0];
        if (v) addEdgeLoop(tessellateCircle(v, curveTol, chord));
      } else if (cand.kind === 'edge') {
        const a = cand.points[0], b = cand.points[1];
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * edgeTol, ny = (dx / len) * edgeTol;
        addEdgeLoop([{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }]);
        addEdgeLoop([{ x: a.x - nx, y: a.y - ny }, { x: b.x - nx, y: b.y - ny }]);
        addEdgeLoop(tessellateCircle(a, edgeTol, chord));
        addEdgeLoop(tessellateCircle(b, edgeTol, chord));
      }
    }
  }

  /** DEBUG: rebuild the face "area of influence" fills. Each face mesh gets a
   * faint translucent clone (sharing the cloned geometry, shared material), so
   * the user sees the regions where a hover highlights that face's boundary
   * edges. Cleared when `show` is false. */
  private _rebuildFaceInfluenceDebug(show: boolean): void {
    while (this.faceInfluenceDebugGroup.children.length > 0) {
      const c = this.faceInfluenceDebugGroup.children.pop() as THREE.Mesh;
      c.geometry?.dispose();  // owns a clone; shared material isn't disposed
    }
    if (!show) return;
    for (const mesh of this.faceMeshes.values()) {
      const clone = new THREE.Mesh(mesh.geometry.clone(), this.faceInfluenceMaterial);
      clone.position.copy(mesh.position);
      clone.quaternion.copy(mesh.quaternion);
      clone.scale.copy(mesh.scale);
      clone.renderOrder = 1;
      this.faceInfluenceDebugGroup.add(clone);
    }
  }

  /** Build the badge cluster for a single entity. The wrapper is a flex
   * row holding each badge as a child — CSS handles the pixel-perfect
   * spacing regardless of camera zoom. */
  private buildConstraintIconCluster(g: ConstraintIconGroup): HTMLDivElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      display: 'flex',
      flexDirection: 'row',
      gap: '4px',
      pointerEvents: 'none',  // wrapper itself doesn't catch events
    });
    for (const icon of g.icons) wrap.appendChild(this.buildConstraintIconElement(icon));
    return wrap;
  }

  /** Single badge — clickable to SELECT the constraint. When this constraint
   * id matches `selectedConstraintId`, the badge renders in orange with a
   * thicker border so the user can tell at a glance which one is up for
   * a Delete-key removal. Removal itself happens via the keyboard (Delete)
   * or via the X button in the constraint-list panel. */
  private buildConstraintIconElement(icon: ConstraintIcon): HTMLDivElement {
    const isSelected = this.selectedConstraintId() === icon.constraintId;
    const baseBg = isSelected ? 'rgba(255, 152, 0, 0.95)' : 'rgba(66, 165, 245, 0.92)';
    const hoverBg = isSelected ? 'rgba(255, 152, 0, 0.95)' : 'rgba(102, 184, 248, 1)';
    const div = document.createElement('div');
    div.textContent = icon.symbol;
    div.title = isSelected
      ? `${icon.label} — press Delete to remove`
      : `${icon.label} — click to select`;
    div.dataset['constraintId'] = icon.constraintId;
    Object.assign(div.style, {
      width: '18px',
      height: '18px',
      lineHeight: '16px',
      textAlign: 'center',
      background: baseBg,
      color: '#fff',
      border: isSelected ? '2px solid #ff9800' : '1px solid rgba(255, 255, 255, 0.4)',
      borderRadius: '3px',
      font: '600 12px monospace',
      cursor: 'pointer',
      userSelect: 'none',
      pointerEvents: 'auto',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.5)',
    });
    div.addEventListener('mouseenter', () => { div.style.background = hoverBg; });
    div.addEventListener('mouseleave', () => { div.style.background = baseBg; });
    div.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      this.zone.run(() => this.constraintIconClicked.emit(icon.constraintId));
    });
    div.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
    return div;
  }

  private buildSketchOriginMarker(sketch: Sketch): THREE.Group {
    // The group is positioned AT the origin with LOCAL-coord children, so
    // scaling it (for constant on-screen size) scales about the marker centre
    // rather than translating it. Tagged so _scaleSketchPoints keeps it a
    // constant screen size at any zoom (frac 1/180 = "keep default size").
    const markerGroup = new THREE.Group();
    markerGroup.position.set(...sketch.plane.origin);
    const xAxis = new THREE.Vector3(...sketch.plane.xAxis);
    const yAxis = new THREE.Vector3(...sketch.plane.yAxis);
    const AXIS_LEN = 20;
    const zero = new THREE.Vector3(0, 0, 0);

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    sphere.renderOrder = 3;
    markerGroup.add(sphere);

    const xLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([zero.clone(), xAxis.clone().multiplyScalar(AXIS_LEN)]),
      new THREE.LineBasicMaterial({ color: 0xe53935, depthTest: false }),
    );
    xLine.renderOrder = 3;
    markerGroup.add(xLine);

    const yLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([zero.clone(), yAxis.clone().multiplyScalar(AXIS_LEN)]),
      new THREE.LineBasicMaterial({ color: 0x43a047, depthTest: false }),
    );
    yLine.renderOrder = 3;
    markerGroup.add(yLine);

    markerGroup.userData = { sketchPointFrac: 1 / 180 };
    markerGroup.scale.setScalar(Math.max(0.05, this.orbitDistance / 180));
    return markerGroup;
  }

  private buildSketchEntity(
    sketch: Sketch, e: SketchEntity,
    project: (p: { x: number; y: number }) => THREE.Vector3,
    selectedSet: Set<string>,
    axisId: string | null = null,
  ): THREE.Object3D | null {
    // Active-sketch coloring depends on the sketch's DOF state PER ENTITY.
    // SolidWorks-style: each entity colors based on its own determinacy
    // when the global state is 'under'. 'over' (solver inconsistent)
    // forces red on everything; 'fixed' forces green on everything.
    const isActive = sketch.id === this.activeSketchId();
    const fixedColor = 0x4caf50;  // green — fully constrained
    const looseColor = 0x42a5f5;  // blue  — under-constrained
    const errorColor = 0xef5350;  // red   — solver reported conflict
    const dof = this.activeSketchDof();
    const determined = this.determinedEntities();
    let baseColor: number;
    const conflicts = this.conflictEntityIds();
    if (!isActive) {
      baseColor = looseColor;
    } else if (dof === 'over' && conflicts.size > 0) {
      // REQ 860: the solver named the conflicting constraints — flag only
      // their target entities red; everything else keeps its determinacy
      // coloring so the user can see WHERE the conflict lives.
      baseColor = conflicts.has(e.id) ? errorColor
        : determined.has(e.id) ? fixedColor : looseColor;
    } else if (dof === 'over') {
      // Fallback: solver reported inconsistency without naming constraints —
      // every entity is suspect when the system can't satisfy itself.
      baseColor = errorColor;
    } else {
      // Per-entity: this specific entity's determinacy decides the color.
      // We intentionally don't honor a global `fixed` state here — the
      // global DOF count has been unreliable in practice, while the
      // per-entity analyzer is conservative (false-blues, never false-greens).
      baseColor = determined.has(e.id) ? fixedColor : looseColor;
    }
    // Convert Entities link — projected entities render in a distinct
    // violet so the user can tell at a glance which sketch lines track
    // body edges. Overrides the regular DOF coloring (those entities
    // are inherently determined by the source). Construction style
    // (dashed grey) still wins if both flags are set. Source is the
    // on-edge constraint list (SolidWorks-style link).
    const isProjected = isProjectedEntity(sketch.state, e.id);
    let color: number;
    if (e.construction) color = 0x666666;
    else if (isProjected) color = 0xab47bc;
    else color = baseColor;
    const dashed = !!e.construction;
    const selected = selectedSet.has(e.id);
    // Hover highlight (cyan): the entity under the cursor, unless it's already
    // selected (orange wins). Matches the 3D face/edge hover color.
    const hovered = !selected && this.hoveredSketchEntityId() === e.id;
    // Mirror-axis highlight takes precedence over the regular selection
    // highlight so the user always sees the axis line as the distinct
    // magenta even if it happens to also be in the selection set.
    const isAxis = axisId !== null && e.id === axisId;
    // Curve renderer shared by line/circle/arc/ellipse/spline/conic: thick
    // orange when selected, thick cyan when hovered, thin DOF-colored otherwise.
    const drawCurve = (pts: THREE.Vector3[]) =>
      selected ? this.makeThickSketchLine(pts)
        : hovered ? this.makeThickSketchLine(pts, this.hoverSketchMaterial)
          : this.makeLineSegments(pts, color, dashed);
    switch (e.kind) {
      case 'point': {
        // REQ 628 / 631 — sketch endpoints render on top of all faces so
        // they're visible against shaded geometry. Selected points fill in
        // orange and grow slightly so the selection is unambiguous.
        // Fully-determined points in the active sketch fill green to
        // match the line/curve "fully constrained" coloring — gives an
        // at-a-glance view of which corner points still carry free DOFs.
        const isDeterminedNow = isActive && determined.has(e.id)
          && (dof !== 'over' || (conflicts.size > 0 && !conflicts.has(e.id)));
        const fillColor = selected
          ? 0xffb74d
          : hovered
            ? 0x40c4ff
            : e.construction
              ? 0x888888
              : isDeterminedNow
                ? 0x4caf50
                : 0xffffff;
        // Built at unit radius; `_scaleSketchPoints()` (run on every camera
        // change) scales it so it stays a CONSTANT on-screen size regardless of
        // zoom. The per-point screen fraction encodes the selected-vs-not size.
        const geom = new THREE.SphereGeometry(1, 12, 8);
        const fillMat = new THREE.MeshBasicMaterial({ color: fillColor, depthTest: false });
        const mesh = new THREE.Mesh(geom, fillMat);
        mesh.position.copy(project(e));
        mesh.renderOrder = 4;
        mesh.userData = { sketchPointFrac: selected || hovered ? POINT_SCREEN_FRAC_SEL : POINT_SCREEN_FRAC };
        mesh.scale.setScalar(Math.max(0.05, this.orbitDistance * (mesh.userData as { sketchPointFrac: number }).sketchPointFrac));
        return mesh;
      }
      case 'line': {
        const a = findPoint(sketch.state, e.startId);
        const b = findPoint(sketch.state, e.endId);
        if (!a || !b) return null;
        const points = [project(a), project(b)];
        if (isAxis) return this.makeThickSketchLine(points, this.mirrorAxisMaterial);
        return drawCurve(points);
      }
      case 'circle': {
        const c = findPoint(sketch.state, e.centerId);
        if (!c) return null;
        const pts2D = tessellateCircle({ x: c.x, y: c.y }, (e as CircleEntity).radius, this.sketchChordTol());
        const pts3 = pts2D.map(project);
        return drawCurve(pts3);
      }
      case 'arc': {
        const arc = e as ArcEntity;
        const c = findPoint(sketch.state, arc.centerId);
        const s = findPoint(sketch.state, arc.startId);
        const f = findPoint(sketch.state, arc.endId);
        if (!c || !s || !f) return null;
        const startAngle = Math.atan2(s.y - c.y, s.x - c.x);
        const endAngle = Math.atan2(f.y - c.y, f.x - c.x);
        const pts2D = tessellateArc(
          { x: c.x, y: c.y }, arc.radius, startAngle, endAngle, arc.ccw,
          this.sketchChordTol(),
        );
        const pts3 = pts2D.map(project);
        return drawCurve(pts3);
      }
      case 'ellipse': {
        const c = findPoint(sketch.state, e.centerId);
        const m = findPoint(sketch.state, e.majorAxisEndId);
        if (!c || !m) return null;
        const pts2D = tessellateEllipse(
          { x: c.x, y: c.y }, { x: m.x, y: m.y }, e.minorRadius, this.sketchChordTol(),
        );
        const pts3 = pts2D.map(project);
        return drawCurve(pts3);
      }
      case 'spline': {
        const ctrlPts = e.controlPointIds
          .map(id => findPoint(sketch.state, id))
          .filter((p): p is NonNullable<typeof p> => !!p);
        if (ctrlPts.length < e.degree + 1) return null;
        const pts2D = tessellateSpline(
          ctrlPts.map(p => ({ x: p.x, y: p.y })),
          e.degree,
          this.sketchChordTol(),
        );
        const pts3 = pts2D.map(project);
        return drawCurve(pts3);
      }
      case 'ellipticalArc':
      case 'conic':
      case 'equation': {
        // Batch 6 — use the shared tessellator (returns [] for
        // unsupported conic types or invalid expressions).
        const pts2D = tessellateEntity(sketch.state, e, this.sketchChordTol());
        if (pts2D.length < 2) return null;
        const pts3 = pts2D.map(project);
        return drawCurve(pts3);
      }
      case 'text': {
        return this._buildSketchTextPlane(sketch, e, project, color);
      }
      case 'picture': {
        return this._buildSketchPicturePlane(sketch, e, project);
      }
      default:
        return null;
    }
  }

  /** Batch 6 — render sketch text as outline strokes anchored at
   * the typographic BASELINE-LEFT. The dashed construction-line
   * bounding box hugs the glyphs: bottom = baseline, top = cap
   * height (e.size), left = start of first character, right = end
   * of last character. The canvas texture extends below the
   * baseline to accommodate descenders (g, j, p, q, y) but the box
   * stays at baseline → cap height so it reads as the actual text
   * extents like in OnShape. */
  /** Guards a single onFontReady → overlay-rebuild registration while Roboto
   * is still parsing (text glyph loops are unavailable until then). */
  private _textFontRebuildArmed = false;

  private _buildSketchTextPlane(
    sketch: Sketch, e: import('../../../cad/lib/types').TextEntity,
    project: (p: { x: number; y: number }) => THREE.Vector3,
    color: number,
  ): THREE.Object3D | null {
    // New (cornerIds) flow takes precedence over legacy (anchorId + size).
    if (e.cornerIds && e.cornerIds.length === 4) {
      const built = this._buildSketchTextFromCorners(sketch, e, project, color);
      if (built) return built;
    }
    if (e.anchorId === undefined) {
      // RECOVERY: text entity missing both cornerIds and anchorId.
      // Try to infer the bounding rectangle from any 4 construction
      // points that form a rectangle on this sketch. Picks the
      // SMALLEST rect to avoid grabbing an unrelated outline.
      const rect = this._inferTextRectFromConstructionRect(sketch);
      if (rect) {
        const inferred: import('../../../cad/lib/types').TextEntity = {
          ...e,
          cornerIds: [rect.bl, rect.br, rect.tr, rect.tl],
          text: e.text || 'Text',
        };
        return this._buildSketchTextFromCorners(sketch, inferred, project, color);
      }
      return null;
    }
    const anchor2 = findPoint(sketch.state, e.anchorId);
    if (!anchor2 || e.size === undefined) return null;
    // Legacy renderer — synthesize `size` from the entity and run
    // the same geometry as the new flow over a derived box.
    const legacySize = e.size;
    const padding = legacySize * 0.1;
    const legacyText = (e.text ?? '').replace(/#\{([^}]+)\}/g, (full, name) => {
      const v = this.textVariables()[String(name).trim()];
      return v === undefined ? full : v;
    });
    // Measure a width using the legacy approach and synthesize the
    // four corners, then delegate.
    const fontPxLegacy = 96;
    const mctxL = document.createElement('canvas').getContext('2d')!;
    mctxL.font = `${fontPxLegacy}px sans-serif`;
    const mL = mctxL.measureText(legacyText || ' ');
    const ascentL = Math.max(1, Math.ceil(mL.actualBoundingBoxAscent));
    const widthL = Math.max(1, Math.ceil(mL.actualBoundingBoxRight - mL.actualBoundingBoxLeft));
    const mmPerPxL = legacySize / ascentL;
    const wMm = widthL * mmPerPxL;
    const synthEntity: import('../../../cad/lib/types').TextEntity = {
      kind: 'text', id: e.id, text: e.text,
      cornerIds: undefined as any,  // sentinel — we pass corners directly via closure
    };
    return this._buildSketchTextFromBox(
      sketch, synthEntity,
      { x: anchor2.x,        y: anchor2.y },
      { x: anchor2.x + wMm,  y: anchor2.y },
      { x: anchor2.x + wMm,  y: anchor2.y + legacySize },
      { x: anchor2.x,        y: anchor2.y + legacySize },
      color,
    );
  }

  /** Recovery for orphaned text entities: scan the sketch for a
   * 4-construction-point axis-aligned rectangle and return its
   * corner ids in BL/BR/TR/TL order. Returns null when no obvious
   * candidate exists. */
  private _inferTextRectFromConstructionRect(sketch: Sketch): { bl: string; br: string; tr: string; tl: string } | null {
    const pts = sketch.state.entities.filter(p => p.kind === 'point' && p.construction === true) as Array<{ id: string; x: number; y: number; kind: 'point' }>;
    if (pts.length < 4) return null;
    // Find any 4 points that form an axis-aligned rectangle.
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        if (Math.abs(a.x - b.x) < 1e-3 || Math.abs(a.y - b.y) < 1e-3) continue;
        const xmin = Math.min(a.x, b.x), xmax = Math.max(a.x, b.x);
        const ymin = Math.min(a.y, b.y), ymax = Math.max(a.y, b.y);
        const blP = pts.find(p => Math.abs(p.x - xmin) < 1e-3 && Math.abs(p.y - ymin) < 1e-3);
        const brP = pts.find(p => Math.abs(p.x - xmax) < 1e-3 && Math.abs(p.y - ymin) < 1e-3);
        const trP = pts.find(p => Math.abs(p.x - xmax) < 1e-3 && Math.abs(p.y - ymax) < 1e-3);
        const tlP = pts.find(p => Math.abs(p.x - xmin) < 1e-3 && Math.abs(p.y - ymax) < 1e-3);
        if (blP && brP && trP && tlP) return { bl: blP.id, br: brP.id, tr: trP.id, tl: tlP.id };
      }
    }
    return null;
  }

  /** New flow — read the four corner points off the sketch state
   * and use them as the text bounding box. */
  private _buildSketchTextFromCorners(
    sketch: Sketch, e: import('../../../cad/lib/types').TextEntity,
    _project: (p: { x: number; y: number }) => THREE.Vector3,
    color: number,
  ): THREE.Object3D | null {
    if (!e.cornerIds) return null;
    const [blId, brId, trId, tlId] = e.cornerIds;
    const bl = findPoint(sketch.state, blId);
    const br = findPoint(sketch.state, brId);
    const tr = findPoint(sketch.state, trId);
    const tl = findPoint(sketch.state, tlId);
    if (!bl || !br || !tr || !tl) return null;
    return this._buildSketchTextFromBox(sketch, e,
      { x: bl.x, y: bl.y },
      { x: br.x, y: br.y },
      { x: tr.x, y: tr.y },
      { x: tl.x, y: tl.y },
      color);
  }

  /** Shared text-render path. Box corners come from cornerIds (new
   * flow) or a synthesized rect (legacy). Width / height of the box
   * dictate the rendered text's stretch + size. */
  private _buildSketchTextFromBox(
    sketch: Sketch, e: import('../../../cad/lib/types').TextEntity,
    bl: { x: number; y: number },
    br: { x: number; y: number },
    tr: { x: number; y: number },
    tl: { x: number; y: number },
    color: number,
  ): THREE.Object3D | null {
    const boxW = Math.hypot(br.x - bl.x, br.y - bl.y);
    const boxH = Math.hypot(tl.x - bl.x, tl.y - bl.y);
    // Drop only on EXACTLY-degenerate boxes. Tiny ones still get a
    // tiny preview rather than disappearing — useful while the
    // solver settles a dimension that briefly collapses the box.
    if (boxW < 1e-6 || boxH < 1e-6) return null;
    const displayText = (e.text ?? '').replace(/#\{([^}]+)\}/g, (full, name) => {
      const v = this.textVariables()[String(name).trim()];
      return v === undefined ? full : v;
    });
    // Render the SAME Roboto glyph outlines the extrude path consumes
    // (textGlyphs.tryGlyphLoopsForText → profile.extractClosedLoops), so the
    // in-sketch text and the extrude footprint are byte-for-byte identical
    // geometry — no more sans-serif-vs-Roboto mismatch. Loops come back in
    // sketch 2D coords anchored at the box's bottom-left; project each through
    // the sketch plane and draw as plain line geometry (same material/colour
    // as ordinary sketch lines).
    const justify = e.justify ?? 'left';
    const mirror = !!e.mirror;
    const group = new THREE.Group();
    // The box + centerline are REAL construction geometry that rotates with the
    // box (rotateTextBox moves the corner points), so the dispatcher renders
    // them normally — nothing to draw here. Glyphs are laid out axis-aligned
    // then mapped onto the box basis so they follow the rotated corners.
    // Single-line engraving font — open stroke centrelines (built-in, no async
    // load). These don't extrude (open), but render in the sketch.
    if (e.font === 'singleLine') {
      const strokes = singleLineStrokesForText(displayText, { x: bl.x, y: bl.y }, boxH, justify, boxW);
      const strokeLoops = strokes.map(s => s.map(([x, y]) => ({ x, y })));
      const tStrokes = applyTextTransform(strokeLoops, bl, br, tl, boxW, boxH, mirror);
      for (const s of tStrokes) {
        if (s.length < 2) continue;
        group.add(this.makeLineSegments(s.map(p => this.project2DTo3D(sketch, p)), color, false));
      }
      if (group.children.length === 0) return null;
      group.userData = { entityId: e.id };
      return group;
    }
    const loops = tryGlyphLoopsForText(displayText, { x: bl.x, y: bl.y }, boxH, justify, boxW);
    if (loops === null) {
      // Font still parsing — re-render the overlay once Roboto lands.
      if (!this._textFontRebuildArmed) {
        this._textFontRebuildArmed = true;
        onFontReady(() => {
          this._textFontRebuildArmed = false;
          if (this.scene) {
            this.syncSketches(this.sketchDoc(), this.activeSketchId(),
              this.selectedSketchEntities(), this.mirrorAxisId());
          }
        });
      }
      return null;
    }
    // Map glyphs onto the box basis (rotation/mirror via the corners) — matches
    // the extrude path.
    const transformed = applyTextTransform(loops, bl, br, tl, boxW, boxH, mirror);
    for (const loop of transformed) {
      if (loop.length < 2) continue;
      const pts = loop.map(p => this.project2DTo3D(sketch, p));
      group.add(this.makeLineSegments(pts, color, false));
    }
    // Dashed box for legacy (anchorId) entities only — they have no real
    // construction lines.
    if (!e.cornerIds) {
      const w = (p: { x: number; y: number }) => this.project2DTo3D(sketch, p);
      const lineMat = new THREE.LineDashedMaterial({
        color: 0x666666, dashSize: boxH * 0.06, gapSize: boxH * 0.04,
        depthWrite: false, transparent: true, opacity: 0.7,
      });
      const boxGeom = new THREE.BufferGeometry().setFromPoints([w(bl), w(br), w(tr), w(tl), w(bl)]);
      const boxLine = new THREE.Line(boxGeom, lineMat);
      boxLine.computeLineDistances();
      group.add(boxLine);
    }
    if (group.children.length === 0) return null;
    group.userData = { entityId: e.id };
    return group;
  }

  /** Batch 6 — render sketch picture as a textured plane anchored
   * at `anchorId`. Reuses the same plane-orientation math as text. */
  private _buildSketchPicturePlane(
    sketch: Sketch, e: import('../../../cad/lib/types').PictureEntity,
    project: (p: { x: number; y: number }) => THREE.Vector3,
  ): THREE.Object3D | null {
    const anchor2 = findPoint(sketch.state, e.anchorId);
    if (!anchor2) return null;
    const tex = new THREE.TextureLoader().load(e.src);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const geom = new THREE.PlaneGeometry(e.width, e.height);
    geom.translate(e.width / 2, e.height / 2, 0);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: e.opacity,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    const p3 = this.project2DTo3D(sketch, { x: anchor2.x, y: anchor2.y });
    mesh.position.copy(p3);
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(sketch.plane.xAxis[0], sketch.plane.xAxis[1], sketch.plane.xAxis[2]),
      new THREE.Vector3(sketch.plane.yAxis[0], sketch.plane.yAxis[1], sketch.plane.yAxis[2]),
      new THREE.Vector3(sketch.plane.normal[0], sketch.plane.normal[1], sketch.plane.normal[2]),
    );
    // Apply rotation about the sketch normal AFTER the plane orientation.
    if (e.rotation !== 0) {
      const rotM = new THREE.Matrix4().makeRotationAxis(
        new THREE.Vector3(sketch.plane.normal[0], sketch.plane.normal[1], sketch.plane.normal[2]).normalize(),
        e.rotation,
      );
      m.premultiply(rotM);
    }
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.userData = { entityId: e.id };
    return mesh;
  }

  // REQ 631 — selected sketch lines render via Line2 (thick, pixel linewidth)
  // sharing a viewer-owned LineMaterial. Defaults to the orange selection
  // material; callers pass `mirrorAxisMaterial` (or any other long-lived
  // shared material) when they want a different color. Caller flattens the
  // polyline into a single LineGeometry; the polyline closes implicitly if
  // points[0] equals points[length-1].
  private makeThickSketchLine(points: THREE.Vector3[], material: LineMaterial = this.selectedSketchMaterial): Line2 {
    const positions: number[] = [];
    for (const p of points) positions.push(p.x, p.y, p.z);
    const geom = new LineGeometry();
    geom.setPositions(positions);
    const line = new Line2(geom, material);
    line.computeLineDistances();
    line.renderOrder = 3;
    return line;
  }

  // Build a continuous polyline as Three.js Line. For construction (dashed)
  // style we use LineDashedMaterial which requires computeLineDistances().
  private makeLineSegments(points: THREE.Vector3[], color: number, dashed: boolean): THREE.Line {
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 1.5, gapSize: 1, depthTest: false })
      : new THREE.LineBasicMaterial({ color, depthTest: false });
    const line = new THREE.Line(geom, mat);
    if (dashed) line.computeLineDistances();
    line.renderOrder = 2;  // draw on top of faces so the overlay reads clearly
    return line;
  }

  private recolor(selected: string | null, hovered: string | null, selectedFeatures: Set<string> = new Set(), pickedFaces: Set<string> = new Set()) {
    // Colors: single-face selection in deep blue (CAM-style), picker-
    // set faces in medium blue (sticky), feature multi-select in
    // orange, hover in lighter cyan-blue (transient preview).
    // Priority: hover > selected > picked > feature-select > default.
    for (const [id, mesh] of this.faceMeshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const ud = mesh.userData as { featureId?: string | null };
      const ownFeatureSelected = ud.featureId != null && selectedFeatures.has(ud.featureId);
      if (id === hovered) mat.color.setHex(0x40c4ff);
      else if (id === selected) mat.color.setHex(0x0066cc);
      else if (pickedFaces.has(id)) mat.color.setHex(0x1976d2);
      else if (ownFeatureSelected) mat.color.setHex(0xffb74d);
      else mat.color.setHex(0x8aa0c4);
    }
    // Datum coloring (selection + hover) is owned by recolorDatums(), driven by
    // its own effect on selectedDatums/hovered/selected.
  }
}

/** Extract the body-suffix index from a face id JSON string. Face IDs
 * encode the OCCT persistent name like
 * `{"feature_id":"f3#pattern#body2","role":"side","sub_index":4,…}`;
 * the `#bodyN` part identifies which OCCT solid (when the body is a
 * compound). Returns null when no body suffix is present — single-
 * solid bodies skip the suffix entirely. */
function _bodyIndexFromFaceId(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as { feature_id?: string };
    const fid = obj.feature_id ?? '';
    const m = /#body([^#]+)$/.exec(fid);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Return only the face meshes whose face id's body suffix matches the
 * lexically-smallest one in the set. Used by the pattern preview to
 * pick a single "source instance" out of a multi-solid upstream body
 * (e.g. a downstream pattern after an existing pattern). Meshes
 * without a body suffix are treated as belonging to the same source
 * and pass through. REQ 658. */
function filterToFirstBody(children: THREE.Object3D[]): THREE.Object3D[] {
  let smallest: string | null = null;
  let anyHadSuffix = false;
  for (const c of children) {
    const id = _bodyIndexFromFaceId((c.userData as { faceId?: string }).faceId);
    if (id !== null) {
      anyHadSuffix = true;
      if (smallest === null || id < smallest) smallest = id;
    }
  }
  if (!anyHadSuffix || smallest === null) return children;
  return children.filter(c => {
    const id = _bodyIndexFromFaceId((c.userData as { faceId?: string }).faceId);
    return id === null || id === smallest;
  });
}

/** Convert a kernel-protocol PatternTransform into a Three.js Matrix4
 * matching the gp_Trsf the kernel would build server-side. Used by the
 * pattern preview to ghost the body at each transform position. The
 * matrix multiplication order here mirrors OCCT's BRepBuilderAPI_Transform
 * semantics (transform applied to model coords). REQ 658. */
function patternTransformToMatrix4(
  t:
    | { kind: 'translate'; dx: number; dy: number; dz: number }
    | { kind: 'rotate'; origin: [number, number, number]; direction: [number, number, number]; angleRad: number }
    | { kind: 'mirror'; origin: [number, number, number]; normal: [number, number, number] },
): THREE.Matrix4 {
  if (t.kind === 'translate') {
    return new THREE.Matrix4().makeTranslation(t.dx, t.dy, t.dz);
  }
  if (t.kind === 'rotate') {
    // Compose: T(origin) · R(axis, angle) · T(-origin) so the rotation
    // pivots through `origin` rather than through the world origin.
    const axis = new THREE.Vector3(t.direction[0], t.direction[1], t.direction[2]).normalize();
    const rot = new THREE.Matrix4().makeRotationAxis(axis, t.angleRad);
    const toOrigin = new THREE.Matrix4().makeTranslation(-t.origin[0], -t.origin[1], -t.origin[2]);
    const fromOrigin = new THREE.Matrix4().makeTranslation(t.origin[0], t.origin[1], t.origin[2]);
    return new THREE.Matrix4().multiplyMatrices(fromOrigin, rot).multiply(toOrigin);
  }
  // Mirror: build a Householder reflection across the plane through
  // `origin` with normal `normal`. Same composition trick as rotate —
  // translate so the plane goes through world origin, reflect, then
  // translate back.
  const n = new THREE.Vector3(t.normal[0], t.normal[1], t.normal[2]).normalize();
  const refl = new THREE.Matrix4().set(
    1 - 2 * n.x * n.x,     -2 * n.x * n.y,     -2 * n.x * n.z, 0,
        -2 * n.x * n.y, 1 - 2 * n.y * n.y,     -2 * n.y * n.z, 0,
        -2 * n.x * n.z,     -2 * n.y * n.z, 1 - 2 * n.z * n.z, 0,
                     0,                  0,                  0, 1,
  );
  const toOrigin = new THREE.Matrix4().makeTranslation(-t.origin[0], -t.origin[1], -t.origin[2]);
  const fromOrigin = new THREE.Matrix4().makeTranslation(t.origin[0], t.origin[1], t.origin[2]);
  return new THREE.Matrix4().multiplyMatrices(fromOrigin, refl).multiply(toOrigin);
}
