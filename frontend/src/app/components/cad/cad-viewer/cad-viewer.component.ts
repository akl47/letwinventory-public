import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy,
  effect, input, output, signal, NgZone, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
// REQ 631 — Line2 supports a real linewidth (in pixels). Three.js's
// LineBasicMaterial is stuck at 1px on most WebGL implementations.
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

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
  ModelGeometry, DatumElement, SketchDocument, Sketch, SketchEntity, Plane3,
  CircleEntity, ArcEntity,
} from '../../../cad/lib/types';
import { findPoint } from '../../../cad/lib/types';
import { tessellateCircle, tessellateArc, DEFAULT_CHORD_TOLERANCE } from '../../../cad/lib/tessellator';

// REQ 629 — drawing preview overlay. Each item is a transient shape rendered
// on top of the active sketch while the user is mid-gesture. The cad-editor
// builds these from the current tool, draft state, and snapped cursor.
export type SketchPreview =
  | { kind: 'line'; start: { x: number; y: number }; end: { x: number; y: number } }
  | { kind: 'circle'; center: { x: number; y: number }; radius: number }
  | { kind: 'arc'; center: { x: number; y: number }; start: { x: number; y: number }; end: { x: number; y: number }; radius: number; ccw: boolean }
  | { kind: 'point-marker'; x: number; y: number; style: 'cursor' | 'pending' }
  | { kind: 'snap-indicator'; x: number; y: number };

@Component({
  selector: 'app-cad-viewer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="viewer" data-testid="cad-viewer">
      <div #mount class="canvas-mount"></div>
      <div class="hud" *ngIf="loading()">
        Loading kernel… {{ loadProgress() }}
      </div>
    </div>
  `,
  styles: [`
    .viewer { position: relative; width: 100%; height: 100%; background: #1e1e2e; }
    .canvas-mount { width: 100%; height: 100%; }
    .canvas-mount canvas { display: block; }
    .hud { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); padding: 8px 16px; background: rgba(0,0,0,0.7); border-radius: 4px; font-size: 12px; color: #fff; }
  `],
})
export class CadViewerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mount', { static: true }) mountRef!: ElementRef<HTMLDivElement>;

  geometry = input<ModelGeometry | null>(null);
  selected = input<string | null>(null);
  selectedFeatures = input<Set<string>>(new Set());
  hovered = signal<string | null>(null);
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

  // REQ 616: sketch pointer events dispatched when an active sketch exists.
  // Coordinates are in the active sketch's 2D plane space (post ray-plane
  // intersection). The parent component wires these into the sketch tool logic.
  sketchClick = output<{ x: number; y: number; shiftKey: boolean }>();
  sketchPointerDown = output<{ x: number; y: number }>();
  sketchPointerMove = output<{ x: number; y: number }>();
  sketchPointerUp = output<{ x: number; y: number }>();

  private zone = inject(NgZone);

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private faceGroup!: THREE.Group;
  private datumGroup!: THREE.Group;
  private sketchGroup!: THREE.Group;
  private faceMeshes = new Map<string, THREE.Mesh>();
  private datumMeshes = new Map<string, THREE.Object3D>();
  // REQ 619 — edge overlays. Each face produces three LineSegments sharing one
  // EdgesGeometry (threshold-detected feature edges + boundary edges). Mode-
  // toggling flips `.visible` on each layer.
  private faceEdges = new Map<string, {
    front: THREE.LineSegments;
    hiddenSolid: THREE.LineSegments;
    hiddenDashed: THREE.LineSegments;
  }>();
  private edgeGroup!: THREE.Group;
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
  private frontEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x111111, depthFunc: THREE.LessEqualDepth });
  private hiddenSolidMaterial = new THREE.LineBasicMaterial({ color: 0x111111, depthFunc: THREE.GreaterDepth, transparent: true, opacity: 0.5 });
  private hiddenDashedMaterial = new THREE.LineDashedMaterial({ color: 0x111111, depthFunc: THREE.GreaterDepth, dashSize: 1.5, gapSize: 1, transparent: true, opacity: 0.6 });
  // Keyed by sketchId; each entry is one container Group holding the projected
  // line segments and point markers for that sketch.
  private sketchOverlays = new Map<string, THREE.Group>();
  // REQ 629 — separate group for the drawing preview overlay; rebuilt on every
  // sketchPreview input change.
  private sketchPreviewGroup!: THREE.Group;

  private rafHandle = 0;
  private resizeObserver?: ResizeObserver;

  // Orbit / pan / zoom state.
  private orbiting = false;
  private panning = false;
  private orbitTheta = Math.PI / 4;
  private orbitPhi = Math.PI / 4;
  private orbitTarget = new THREE.Vector3(0, 0, 0);
  private orbitDistance = 180;
  private lastPointer = { x: 0, y: 0 };
  // Tracks the last sketchId we oriented for so we re-orient on each *transition*
  // into a sketch (and not on every input mutation while inside one).
  private orientedSketchId: string | null = null;

  constructor() {
    effect(() => {
      const g = this.geometry();
      if (this.scene && g) this.syncGeometry(g);
    });
    effect(() => {
      const sel = this.selected();
      const hov = this.hovered();
      const features = this.selectedFeatures();
      if (this.scene) this.recolor(sel, hov, features);
    });
    effect(() => {
      const doc = this.sketchDoc();
      const active = this.activeSketchId();
      const selected = this.selectedSketchEntities();
      if (this.scene) this.syncSketches(doc, active, selected);
    });
    // REQ 619 — apply display-mode toggles to existing face + edge meshes.
    effect(() => {
      const mode = this.displayMode();
      if (this.scene) this.applyDisplayMode(mode);
    });
    // REQ 629 — rebuild the preview overlay when its input changes.
    effect(() => {
      const preview = this.sketchPreview();
      const sid = this.activeSketchId();
      if (this.scene) this.rebuildPreview(preview, sid);
    });
    // REQ 616 follow-up: when the user enters a sketch, snap the camera to look
    // straight down its plane normal. Re-orient only on transition, so the user
    // can free-orbit inside an active sketch without being yanked back.
    effect(() => {
      const sid = this.activeSketchId();
      if (sid === this.orientedSketchId) return;
      if (!this.scene) return;  // initScene picks up the initial case if any
      const sketch = sid ? this.sketchDoc()?.sketches[sid] : null;
      if (sketch) this.orientToPlane(sketch.plane);
      this.orientedSketchId = sid;
    });
  }

  // Snaps the orbit camera to the plane normal: target = plane origin, camera
  // sits at orbitDistance along +normal so the plane fills the view.
  private orientToPlane(plane: import('../../../cad/lib/types').Plane3) {
    const len = Math.hypot(plane.normal[0], plane.normal[1], plane.normal[2]) || 1;
    const ux = plane.normal[0] / len;
    const uy = plane.normal[1] / len;
    const uz = plane.normal[2] / len;
    this.orbitTarget.set(plane.origin[0], plane.origin[1], plane.origin[2]);
    this.orbitPhi = Math.max(0.05, Math.min(Math.PI - 0.05, Math.acos(uy)));
    const sinPhi = Math.sin(this.orbitPhi);
    this.orbitTheta = sinPhi > 1e-6 ? Math.atan2(uz, ux) : 0;
    this.updateCamera();
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => this.initScene());
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.rafHandle);
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();
    this.scene?.traverse(o => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
      if ((o as THREE.Mesh).material) {
        const m = (o as THREE.Mesh).material;
        Array.isArray(m) ? m.forEach(mat => mat.dispose()) : m.dispose();
      }
    });
  }

  private initScene() {
    const mount = this.mountRef.nativeElement;
    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 600;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1e1e2e);

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 5000);
    this.updateCamera();
    // REQ 631 — Line2 width is computed in screen-pixel space, so the material
    // needs the current canvas resolution.
    this.selectedSketchMaterial.resolution.set(width, height);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(width, height);
    mount.appendChild(this.renderer.domElement);

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
    this.sketchPreviewGroup = new THREE.Group();
    this.scene.add(this.sketchPreviewGroup);
    this.edgeGroup = new THREE.Group();
    this.scene.add(this.edgeGroup);

    // Input handlers.
    const canvas = this.renderer.domElement;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerUp);
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

    // Animate.
    const animate = () => {
      this.rafHandle = requestAnimationFrame(animate);
      this.renderer.render(this.scene, this.camera);
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
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.selectedSketchMaterial.resolution.set(width, height);
  }

  private updateCamera() {
    const x = this.orbitTarget.x + this.orbitDistance * Math.sin(this.orbitPhi) * Math.cos(this.orbitTheta);
    const y = this.orbitTarget.y + this.orbitDistance * Math.cos(this.orbitPhi);
    const z = this.orbitTarget.z + this.orbitDistance * Math.sin(this.orbitPhi) * Math.sin(this.orbitTheta);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.orbitTarget);
  }

  private onPointerDown = (ev: PointerEvent) => {
    this.lastPointer = { x: ev.clientX, y: ev.clientY };
    const inSketch = this.activeSketchId() !== null;
    // REQ 616 input map. In sketch mode: left = sketch, right = orbit, middle = pan.
    // In non-sketch mode (existing behaviour): left = orbit, shift+left = pan.
    if (inSketch) {
      if (ev.button === 0) {
        const p = this.toSketchCoords(ev);
        if (p) this.zone.run(() => this.sketchPointerDown.emit(p));
      } else if (ev.button === 2) {
        this.orbiting = true;
      } else if (ev.button === 1) {
        this.panning = true;
      }
    } else {
      if (ev.button === 0 && !ev.shiftKey) this.orbiting = true;
      else this.panning = true;
    }
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  };

  private onPointerMove = (ev: PointerEvent) => {
    const dx = ev.clientX - this.lastPointer.x;
    const dy = ev.clientY - this.lastPointer.y;
    this.lastPointer = { x: ev.clientX, y: ev.clientY };
    if (this.orbiting) {
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
    } else if (this.activeSketchId() !== null) {
      const p = this.toSketchCoords(ev);
      if (p) this.zone.run(() => this.sketchPointerMove.emit(p));
    } else {
      this.updatePointer(ev);
      this.updateHover();
    }
  };

  private onPointerUp = (ev: PointerEvent) => {
    if (this.activeSketchId() !== null && ev.button === 0) {
      const p = this.toSketchCoords(ev);
      if (p) this.zone.run(() => this.sketchPointerUp.emit(p));
    }
    this.orbiting = false;
    this.panning = false;
    (ev.target as Element).releasePointerCapture?.(ev.pointerId);
  };

  // REQ 616 — convert a screen-space mouse event to 2D coords on the active
  // sketch's host plane. Returns null if the pointer ray misses the plane (e.g.
  // sketch plane is edge-on to the camera).
  private toSketchCoords(ev: MouseEvent): { x: number; y: number } | null {
    const sketchId = this.activeSketchId();
    if (!sketchId) return null;
    const sketch = this.sketchDoc()?.sketches[sketchId];
    if (!sketch) return null;
    this.updatePointer(ev);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const normal = new THREE.Vector3(...sketch.plane.normal).normalize();
    const origin = new THREE.Vector3(...sketch.plane.origin);
    const plane = new THREE.Plane(normal, -normal.dot(origin));
    const target = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, target)) return null;
    const offset = target.sub(origin);
    const xAxis = new THREE.Vector3(...sketch.plane.xAxis);
    const yAxis = new THREE.Vector3(...sketch.plane.yAxis);
    return { x: offset.dot(xAxis), y: offset.dot(yAxis) };
  }

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const factor = ev.deltaY > 0 ? 1.1 : 1 / 1.1;
    this.orbitDistance = Math.max(5, Math.min(2000, this.orbitDistance * factor));
    this.updateCamera();
  };

  private onClick = (ev: MouseEvent) => {
    // REQ 616: in sketch mode the click dispatches to the sketch toolbar's click
    // handler with 2D plane coords; selection of 3D faces/datums is paused.
    if (this.activeSketchId() !== null) {
      const p = this.toSketchCoords(ev);
      if (p) this.zone.run(() => this.sketchClick.emit({ x: p.x, y: p.y, shiftKey: ev.shiftKey }));
      return;
    }
    this.updatePointer(ev);
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
    if (!info.featureId) return;  // empty space — no menu
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

  private updatePointer(ev: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pickEntity(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const faceHits = this.raycaster.intersectObjects(this.faceGroup.children, false);
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

  private updateHover() {
    const prev = this.hovered();
    const next = this.pickEntity();
    if (prev !== next) this.hovered.set(next);
  }

  private syncDatums(datums: DatumElement[]) {
    // Clear old.
    for (const obj of this.datumMeshes.values()) {
      this.datumGroup.remove(obj);
      obj.traverse(child => {
        const m = (child as THREE.Mesh).material as THREE.Material | undefined;
        if (m) Array.isArray(m) ? m.forEach(x => x.dispose()) : m.dispose();
        const g = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (g) g.dispose();
      });
    }
    this.datumMeshes.clear();
    for (const d of datums) this.addDatum(d);
  }

  private addDatum(d: DatumElement) {
    if (d.kind === 'point') {
      const geom = new THREE.SphereGeometry(1.2, 16, 16);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { datumId: d.id };
      this.datumGroup.add(mesh);
      this.datumMeshes.set(d.id, mesh);
    } else if (d.kind === 'axis' && d.direction) {
      const color = d.id === 'x_axis' ? 0xe53935 : d.id === 'y_axis' ? 0x43a047 : 0x1e88e5;
      const dir = new THREE.Vector3(...d.direction).normalize();
      const end = dir.clone().multiplyScalar(60);
      const start = dir.clone().multiplyScalar(-60);
      const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
      const mat = new THREE.LineBasicMaterial({ color });
      const line = new THREE.Line(geom, mat);
      const group = new THREE.Group();
      group.add(line);
      group.userData = { datumId: d.id };
      this.datumGroup.add(group);
      this.datumMeshes.set(d.id, group);
    } else if (d.kind === 'plane' && d.direction) {
      const color = d.id === 'xy_plane' ? 0x1e88e5 : d.id === 'yz_plane' ? 0xe53935 : 0x43a047;
      const geom = new THREE.PlaneGeometry(80, 80);
      // Orient plane: PlaneGeometry default normal is +Z; rotate to match.
      const normal = new THREE.Vector3(...d.direction).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.quaternion.copy(quat);
      mesh.userData = { datumId: d.id };
      this.datumGroup.add(mesh);
      this.datumMeshes.set(d.id, mesh);
    }
  }

  private syncGeometry(g: ModelGeometry) {
    // Datums driven by visibility settings on the model.
    this.syncDatums(g.datums);
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

    for (const f of g.faces) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(f.positions, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(f.normals, 3));
      geom.setIndex(new THREE.BufferAttribute(f.indices, 1));
      const mat = new THREE.MeshStandardMaterial({
        color: 0x8aa0c4, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide,
        // polygonOffset pushes face fragments slightly back so coplanar edges
        // (depthFunc = LessEqualDepth) reliably win the depth test.
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { faceId: f.faceId, featureId: f.featureId ?? null, isFlat: f.isFlat === true };
      this.faceGroup.add(mesh);
      this.faceMeshes.set(f.faceId, mesh);

      // REQ 619 — feature-edge extraction. 15° threshold keeps cylinder
      // lateral facets quiet but emits boundary rings + sharp corners.
      const edgeGeom = new THREE.EdgesGeometry(geom, 15);
      const front = new THREE.LineSegments(edgeGeom, this.frontEdgeMaterial);
      const hiddenSolid = new THREE.LineSegments(edgeGeom, this.hiddenSolidMaterial);
      const hiddenDashed = new THREE.LineSegments(edgeGeom, this.hiddenDashedMaterial);
      hiddenDashed.computeLineDistances();
      this.edgeGroup.add(front);
      this.edgeGroup.add(hiddenSolid);
      this.edgeGroup.add(hiddenDashed);
      this.faceEdges.set(f.faceId, { front, hiddenSolid, hiddenDashed });
    }

    this.recolor(this.selected(), this.hovered());
    this.applyDisplayMode(this.displayMode());
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
  private syncSketches(doc: SketchDocument | null, activeSketchId: string | null, selectedSet: Set<string> = new Set()) {
    // Tear down stale overlays. REQ 631: skip disposal of the shared
    // selectedSketchMaterial — it persists across rebuilds.
    for (const [, group] of this.sketchOverlays) {
      this.sketchGroup.remove(group);
      group.traverse(child => {
        const m = (child as THREE.Mesh).material as THREE.Material | undefined;
        if (m && m !== this.selectedSketchMaterial) {
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
      const group = this.buildSketchOverlay(sketch, isActive, selectedSet);
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
        const pts = tessellateCircle(item.center, item.radius, DEFAULT_CHORD_TOLERANCE);
        return this.makePreviewLine(pts.map(project), previewColor);
      }
      case 'arc': {
        const startAngle = Math.atan2(item.start.y - item.center.y, item.start.x - item.center.x);
        const endAngle = Math.atan2(item.end.y - item.center.y, item.end.x - item.center.x);
        const pts = tessellateArc(item.center, item.radius, startAngle, endAngle, item.ccw, DEFAULT_CHORD_TOLERANCE);
        return this.makePreviewLine(pts.map(project), previewColor);
      }
      case 'point-marker': {
        const geom = new THREE.SphereGeometry(item.style === 'cursor' ? 0.9 : 1.3, 12, 8);
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
        // Ring drawn from a regular-polygon polyline so it scales with the
        // viewer transform like the sketch overlay does. Radius is in sketch
        // units; tweak if it looks too large/small after a first test.
        const radius = 2.5;
        const segs = 24;
        const pts: Array<{ x: number; y: number }> = [];
        for (let i = 0; i <= segs; i++) {
          const t = (i / segs) * Math.PI * 2;
          pts.push({ x: item.x + radius * Math.cos(t), y: item.y + radius * Math.sin(t) });
        }
        return this.makePreviewLine(pts.map(project), 0xffeb3b, true);
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

  private project2DTo3D(sketch: Sketch, p: { x: number; y: number }): THREE.Vector3 {
    const o = new THREE.Vector3(...sketch.plane.origin);
    const x = new THREE.Vector3(...sketch.plane.xAxis);
    const y = new THREE.Vector3(...sketch.plane.yAxis);
    return o.clone().addScaledVector(x, p.x).addScaledVector(y, p.y);
  }

  private buildSketchOverlay(sketch: Sketch, isActive: boolean, selectedSet: Set<string>): THREE.Group {
    const group = new THREE.Group();
    group.userData = { sketchId: sketch.id };
    // Active sketch gets an origin marker (small sphere + red X axis + green Y
    // axis in the sketch's local basis directions) so the user can see where
    // (0, 0) is and which way is +X / +Y in the 2D plane.
    if (isActive) group.add(this.buildSketchOriginMarker(sketch));
    const project = (p: { x: number; y: number }) => this.project2DTo3D(sketch, p);
    for (const e of sketch.state.entities) {
      const obj = this.buildSketchEntity(sketch, e, project, selectedSet);
      if (obj) group.add(obj);
    }
    return group;
  }

  private buildSketchOriginMarker(sketch: Sketch): THREE.Group {
    const markerGroup = new THREE.Group();
    const origin = new THREE.Vector3(...sketch.plane.origin);
    const xAxis = new THREE.Vector3(...sketch.plane.xAxis);
    const yAxis = new THREE.Vector3(...sketch.plane.yAxis);
    const AXIS_LEN = 20;

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    sphere.position.copy(origin);
    sphere.renderOrder = 3;
    markerGroup.add(sphere);

    const xEnd = origin.clone().addScaledVector(xAxis, AXIS_LEN);
    const xGeom = new THREE.BufferGeometry().setFromPoints([origin.clone(), xEnd]);
    const xLine = new THREE.Line(
      xGeom,
      new THREE.LineBasicMaterial({ color: 0xe53935, depthTest: false }),
    );
    xLine.renderOrder = 3;
    markerGroup.add(xLine);

    const yEnd = origin.clone().addScaledVector(yAxis, AXIS_LEN);
    const yGeom = new THREE.BufferGeometry().setFromPoints([origin.clone(), yEnd]);
    const yLine = new THREE.Line(
      yGeom,
      new THREE.LineBasicMaterial({ color: 0x43a047, depthTest: false }),
    );
    yLine.renderOrder = 3;
    markerGroup.add(yLine);

    return markerGroup;
  }

  private buildSketchEntity(
    sketch: Sketch, e: SketchEntity,
    project: (p: { x: number; y: number }) => THREE.Vector3,
    selectedSet: Set<string>,
  ): THREE.Object3D | null {
    const color = e.construction ? 0x666666 : 0x42a5f5;
    const dashed = !!e.construction;
    const selected = selectedSet.has(e.id);
    switch (e.kind) {
      case 'point': {
        // REQ 628 / 631 — sketch endpoints render on top of all faces so
        // they're visible against shaded geometry. Selected points fill in
        // orange and grow slightly so the selection is unambiguous.
        const r = selected ? 1.6 : 1.1;
        const fillColor = selected
          ? 0xffb74d
          : (e.construction ? 0x888888 : 0xffffff);
        const geom = new THREE.SphereGeometry(r, 12, 8);
        const fillMat = new THREE.MeshBasicMaterial({ color: fillColor, depthTest: false });
        const mesh = new THREE.Mesh(geom, fillMat);
        mesh.position.copy(project(e));
        mesh.renderOrder = 4;
        return mesh;
      }
      case 'line': {
        const a = findPoint(sketch.state, e.startId);
        const b = findPoint(sketch.state, e.endId);
        if (!a || !b) return null;
        const points = [project(a), project(b)];
        return selected
          ? this.makeThickSketchLine(points)
          : this.makeLineSegments(points, color, dashed);
      }
      case 'circle': {
        const c = findPoint(sketch.state, e.centerId);
        if (!c) return null;
        const pts2D = tessellateCircle({ x: c.x, y: c.y }, (e as CircleEntity).radius, DEFAULT_CHORD_TOLERANCE);
        const pts3 = pts2D.map(project);
        return selected
          ? this.makeThickSketchLine(pts3)
          : this.makeLineSegments(pts3, color, dashed);
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
          DEFAULT_CHORD_TOLERANCE,
        );
        const pts3 = pts2D.map(project);
        return selected
          ? this.makeThickSketchLine(pts3)
          : this.makeLineSegments(pts3, color, dashed);
      }
      default:
        // Phase B/C entity kinds (ellipse, ellipticalArc, spline, conic) — not yet rendered.
        return null;
    }
  }

  // REQ 631 — selected sketch lines render via Line2 (thick, pixel linewidth)
  // sharing the viewer-owned selectedSketchMaterial. Caller flattens the
  // polyline into a single LineGeometry; the polyline closes implicitly if
  // points[0] equals points[length-1].
  private makeThickSketchLine(points: THREE.Vector3[]): Line2 {
    const positions: number[] = [];
    for (const p of points) positions.push(p.x, p.y, p.z);
    const geom = new LineGeometry();
    geom.setPositions(positions);
    const line = new Line2(geom, this.selectedSketchMaterial);
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

  private recolor(selected: string | null, hovered: string | null, selectedFeatures: Set<string> = new Set()) {
    for (const [id, mesh] of this.faceMeshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const ud = mesh.userData as { featureId?: string | null };
      const ownFeatureSelected = ud.featureId != null && selectedFeatures.has(ud.featureId);
      if (id === selected) mat.color.setHex(0xec407a);
      else if (ownFeatureSelected) mat.color.setHex(0xffb74d);  // orange for multi-select
      else if (id === hovered) mat.color.setHex(0xffeb3b);
      else mat.color.setHex(0x8aa0c4);
    }
    for (const [id, obj] of this.datumMeshes) {
      const fullId = `datum:${id}`;
      const isSel = fullId === selected;
      // Find material on any child of the datum group.
      obj.traverse(child => {
        const m = (child as THREE.Mesh).material as THREE.Material | undefined;
        if (!m) return;
        if (m instanceof THREE.MeshBasicMaterial || m instanceof THREE.LineBasicMaterial) {
          // Save original color, overlay selection.
          if (isSel) {
            (m as any).color?.setHex(0xffeb3b);
          } else {
            // Restore: use the rebuild path. (No-op for now; visual highlight only on hover/select pulse.)
          }
        }
      });
    }
  }
}
