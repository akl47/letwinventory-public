import {
  Component, Input, Output, EventEmitter, inject, signal, viewChild, ElementRef,
  AfterViewInit, OnChanges, OnDestroy, SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CadModelService } from '../../../services/cad-model.service';
import { CadCommitGeometry, CadDefaultView, FaceStatus } from '../../../models/cad-model.model';
import { computeMeasure, fitCircle, MeasureItem, MeasureResultRow } from '../../../cad/lib/measure';

/** Camera pose, used to lock two Compare previews' views together. */
export interface PreviewCamera {
  pos: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

type SnapKind = 'vertex' | 'edge' | 'face';
type Tri3 = [number, number, number];

// Build a face MeasureItem (area / centroid / normal / flatness) from a trimmed
// face mesh, so the preview can measure a whole face like the editor does.
function faceMeasureItem(f: CadCommitGeometry['faces'][number], index: number): MeasureItem {
  const pos = f.positions || [], idx = f.indices || [];
  const cen: Tri3 = [0, 0, 0]; let nv = 0;
  for (let i = 0; i + 2 < pos.length; i += 3) { cen[0] += pos[i]; cen[1] += pos[i + 1]; cen[2] += pos[i + 2]; nv++; }
  if (nv) { cen[0] /= nv; cen[1] /= nv; cen[2] /= nv; }
  const vtx = (i: number): Tri3 => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  let area = 0; const nAcc: Tri3 = [0, 0, 0]; const triNs: Tri3[] = [];
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = vtx(idx[t]), b = vtx(idx[t + 1]), c = vtx(idx[t + 2]);
    const u: Tri3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w: Tri3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: Tri3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const m = Math.hypot(n[0], n[1], n[2]); area += m / 2;
    nAcc[0] += n[0]; nAcc[1] += n[1]; nAcc[2] += n[2];
    if (m > 1e-9) triNs.push([n[0] / m, n[1] / m, n[2] / m]);
  }
  const nm = Math.hypot(nAcc[0], nAcc[1], nAcc[2]) || 1;
  const normal: Tri3 = [nAcc[0] / nm, nAcc[1] / nm, nAcc[2] / nm];
  const isFlat = triNs.every(n => n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] > 0.999);
  return { kind: 'face', id: f.persistentName || `face-${index}`, area, centroid: cen, normal: isFlat ? normal : undefined, isFlat };
}

// Build an edge MeasureItem (straightness / length / circle fit) from a polyline.
function edgeMeasureItem(pts: THREE.Vector3[], index: number): MeasureItem {
  const start: Tri3 = [pts[0].x, pts[0].y, pts[0].z];
  const last = pts[pts.length - 1];
  const end: Tri3 = [last.x, last.y, last.z];
  let length = 0;
  for (let i = 0; i + 1 < pts.length; i++) length += pts[i].distanceTo(pts[i + 1]);
  const chord = pts[0].distanceTo(last);
  const isStraight = pts.length === 2 || Math.abs(length - chord) < Math.max(1e-4, length * 1e-3);
  const poly: Tri3[] = pts.map(p => [p.x, p.y, p.z]);
  const circle = isStraight ? undefined : (fitCircle(poly) || undefined);
  return { kind: 'edge', id: `edge-${index}`, start, end, isStraight, length, circle };
}

// Face colours: neutral, added (green), removed (red) — for the Compare diff.
const FACE_COLORS: Record<'neutral' | FaceStatus, number> = {
  neutral: 0x9fb4d6, unchanged: 0x9fb4d6, added: 0x66bb6a, removed: 0xef5350,
};

// Marker colours per snap kind: vertex amber, edge cyan, face green.
const SNAP_COLORS: Record<SnapKind, number> = { vertex: 0xffb74d, edge: 0x4fc3f7, face: 0x9ccc65 };

// Closest point ON segment [A,B] to the (infinite) ray from O along unit D.
// Used to snap a measurement pick to an edge under the cursor.
function closestPointOnSegmentToRay(O: THREE.Vector3, D: THREE.Vector3, A: THREE.Vector3, B: THREE.Vector3): THREE.Vector3 {
  const v = B.clone().sub(A);            // segment direction
  const w0 = O.clone().sub(A);
  const a = D.dot(D), b = D.dot(v), c = v.dot(v), d = D.dot(w0), e = v.dot(w0);
  const denom = a * c - b * b;
  let t = denom > 1e-9 ? (a * e - b * d) / denom : 0; // param along the segment
  t = Math.max(0, Math.min(1, t));
  return A.clone().addScaledVector(v, t);
}

// An interactive 3D preview of a single commit's geometry (REQ 711/712).
// It shows the stored low-res commit thumbnail as a poster immediately, then
// loads the tessellated faces and replaces the poster with a live WebGL view
// supporting orbit (drag), zoom (wheel) and point-to-point distance
// measurement. Rendering is on-demand (on the OrbitControls 'change' event),
// not a continuous rAF loop, so several previews on a page stay cheap.
@Component({
  selector: 'app-cad-preview-3d',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, MatIconModule],
  template: `
    <div class="p3d" [style.width.px]="w" [style.height.px]="h">
      <div #mount class="mount"></div>
      <img *ngIf="posterUrl() && !ready()" class="poster" [src]="posterUrl()" alt="commit preview" />
      <div class="state" *ngIf="state() !== 'ok'">
        <mat-spinner *ngIf="state()==='loading' && !posterUrl()" [diameter]="22"></mat-spinner>
        <span *ngIf="state()==='empty'">no solid</span>
        <span *ngIf="state()==='error'">no preview</span>
      </div>
      <div class="toolbar" *ngIf="state()==='ok'">
        <button type="button" class="tb" [class.on]="navMode()==='orbit'" title="Orbit (drag to rotate)" (click)="setNav('orbit')"><mat-icon>3d_rotation</mat-icon></button>
        <button type="button" class="tb" [class.on]="navMode()==='pan'" title="Pan (drag to move)" (click)="setNav('pan')"><mat-icon>open_with</mat-icon></button>
        <button type="button" class="tb" [class.on]="navMode()==='zoom'" title="Zoom (drag up/down)" (click)="setNav('zoom')"><mat-icon>zoom_in</mat-icon></button>
        <button type="button" class="tb" [class.on]="measuring()" title="Measure" (click)="toggleMeasure()"><mat-icon>straighten</mat-icon></button>
        <button type="button" class="tb" title="Reset view" (click)="resetView()"><mat-icon>center_focus_strong</mat-icon></button>
      </div>
      <div class="readout" *ngIf="measuring()">
        <div class="msum" *ngIf="measureSummary()">{{ measureSummary() }}</div>
        <div class="mrow" *ngFor="let r of measureRows()"><span class="ml">{{ r.label }}</span><span class="mv">{{ r.value }}</span></div>
        <div class="mhint" *ngIf="!measureRows().length">select a {{ selCount() === 1 ? '2nd' : '1st' }} vertex / edge / face</div>
      </div>
    </div>
  `,
  styles: [`
    .p3d { position: relative; border-radius: 8px; overflow: hidden; background: #1c1c2a; border: 1px solid #34344a; }
    .mount { position: absolute; inset: 0; }
    .mount canvas { display: block; }
    .poster { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .state { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #777; font-size: 12px; }
    .toolbar { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; }
    .tb { width: 24px; height: 24px; padding: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
          background: rgba(42,42,58,0.88); border: 1px solid #3a3a4a; border-radius: 4px; color: #cfd2e0; }
    .tb mat-icon { font-size: 16px; width: 16px; height: 16px; line-height: 16px; }
    .tb:hover { background: #34344a; }
    .tb.on { background: #1976d2; border-color: #1976d2; color: #fff; }
    .readout { position: absolute; bottom: 6px; left: 6px; max-width: calc(100% - 12px); padding: 4px 8px; font-size: 12px; color: #e0e0ee;
               background: rgba(20,20,32,0.86); border: 1px solid #34344a; border-radius: 4px; }
    .readout .msum { color: #9aa3b8; margin-bottom: 2px; }
    .readout .mrow { display: flex; gap: 10px; justify-content: space-between; }
    .readout .ml { color: #9aa3b8; } .readout .mv { color: #fff; font-variant-numeric: tabular-nums; }
    .readout .mhint { color: #8a8a9a; }
  `],
})
export class CadPreview3dComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() modelId!: number;
  @Input() hash!: string;
  @Input() w = 320;
  @Input() h = 230;
  /** Inline geometry to render directly (e.g. a hypothetical merge preview that
   * isn't a commit). When set, it bypasses the by-hash fetch; `geometryKey`
   * identifies the content so changes rebuild. */
  @Input() geometry: CadCommitGeometry | null = null;
  @Input() geometryKey = '';
  /** The model's saved default view — orients the preview to match the editor.
   * Falls back to a generic isometric when null. */
  @Input() defaultView: CadDefaultView | null = null;
  /** Per-face status (by persistentName) for the Compare diff: faces tagged
   * 'added' render green, 'removed' red, everything else neutral. */
  @Input() faceStatus: Record<string, FaceStatus> | null = null;
  /** Emitted when this preview's camera moves (orbit/pan/zoom) — used to lock
   * the two Compare previews together. Suppressed while applying an external pose. */
  @Output() cameraMove = new EventEmitter<PreviewCamera>();

  private mount = viewChild<ElementRef<HTMLDivElement>>('mount');
  private cadApi = inject(CadModelService);

  state = signal<'loading' | 'ok' | 'empty' | 'error'>('loading');
  posterUrl = signal<string | null>(null);
  ready = signal(false);
  measuring = signal(false);
  navMode = signal<'orbit' | 'pan' | 'zoom'>('orbit');
  measureSummary = signal('');
  measureRows = signal<MeasureResultRow[]>([]);
  selCount = signal(0);

  // Geometry cache shared across instances (model+hash → faces).
  private static cache = new Map<string, CadCommitGeometry>();

  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private controls?: OrbitControls;
  private group?: THREE.Group;          // the model faces (raycast target)
  private measureGroup?: THREE.Group;   // markers + line, excluded from picking
  private faceMats?: { neutral: THREE.MeshStandardMaterial; added: THREE.MeshStandardMaterial; removed: THREE.MeshStandardMaterial };
  private raycaster = new THREE.Raycaster();
  private picks: THREE.Vector3[] = [];        // snap points (for the connecting guide line)
  private selItems: MeasureItem[] = [];       // whole-entity selections fed to computeMeasure
  private modelRadius = 1;
  // Snap targets for measurement (REQ 712): topological vertices + edges (kept
  // per-edge so a whole edge can be highlighted, with segments for snapping).
  // Each carries its whole-entity MeasureItem so a pick selects the entity, not
  // just the clicked point.
  private snapVertices: THREE.Vector3[] = [];
  private vertexItems: MeasureItem[] = [];
  private snapEdges: { pts: THREE.Vector3[]; segs: { a: THREE.Vector3; b: THREE.Vector3 }[]; item: MeasureItem }[] = [];
  private faceItemByMesh = new Map<THREE.Mesh, MeasureItem>();
  private occRay = new THREE.Raycaster();  // occlusion test — snap only to visible topology
  private hoverMarker?: THREE.Mesh;     // vertex hover dot
  private hoverFace?: THREE.Mesh;       // face hover overlay (shares the face geometry)
  private hoverEdge?: THREE.Line;       // edge hover overlay
  private viewInit = false;
  private lastKey = '';
  private downAt: { x: number; y: number } | null = null;

  ngAfterViewInit() { this.viewInit = true; this.load(); }
  ngOnChanges(changes: SimpleChanges) {
    if (!this.viewInit) return;
    this.load();
    // Re-orient an already-built preview if the default view arrives/changes
    // without the commit itself changing (load() is a no-op in that case).
    if (changes['defaultView'] && !changes['defaultView'].firstChange && this.ready()) {
      this.frameDefault();
      this.renderOnce();
    }
    // Recolour faces when the diff status arrives/changes after build.
    if (changes['faceStatus'] && !changes['faceStatus'].firstChange && this.ready()) {
      this.recolorFaces();
      this.renderOnce();
    }
  }

  private matForFace(pname?: string): THREE.MeshStandardMaterial {
    const mats = this.faceMats!;
    const st = pname && this.faceStatus ? this.faceStatus[pname] : undefined;
    return st === 'added' ? mats.added : st === 'removed' ? mats.removed : mats.neutral;
  }

  private recolorFaces() {
    if (!this.group || !this.faceMats) return;
    for (const c of this.group.children) {
      const m = c as THREE.Mesh;
      m.material = this.matForFace(m.userData['pname']);
    }
  }
  ngOnDestroy() { this.teardown(); this.revokePoster(); }

  private key() { return `${this.modelId}:${this.hash}`; }

  private load() {
    // Inline geometry (e.g. a merge preview) bypasses the by-hash fetch.
    if (this.geometry) {
      const gk = 'inline:' + (this.geometryKey || '');
      if (gk === this.lastKey) return;
      this.lastKey = gk;
      this.teardown();
      this.ready.set(false);
      this.measureSummary.set(''); this.measureRows.set([]); this.selCount.set(0); this.measuring.set(false);
      this.revokePoster();
      this.state.set('loading');
      this.build(this.geometry);
      return;
    }
    if (!this.modelId || !this.hash) return;
    const k = this.key();
    if (k === this.lastKey) return;
    this.lastKey = k;
    this.teardown();
    this.ready.set(false);
    this.measureSummary.set('');
    this.measureRows.set([]);
    this.selCount.set(0);
    this.measuring.set(false);
    this.state.set('loading');

    // Poster first — show the cached thumbnail immediately if there is one.
    this.revokePoster();
    this.cadApi.getCommitThumbnail(this.modelId, this.hash).subscribe({
      next: blob => { if (this.key() === k) this.posterUrl.set(URL.createObjectURL(blob)); },
      error: () => { /* no thumbnail — fine, the spinner covers the gap */ },
    });

    const cached = CadPreview3dComponent.cache.get(k);
    if (cached) { this.build(cached); return; }
    this.cadApi.getCommitGeometry(this.modelId, this.hash).subscribe({
      next: g => { if (this.key() !== k) return; CadPreview3dComponent.cache.set(k, g); this.build(g); },
      error: () => this.state.set('error'),
    });
  }

  private build(geo: CadCommitGeometry) {
    const host = this.mount()?.nativeElement;
    if (!host) { setTimeout(() => this.build(geo), 30); return; }
    if (!geo.faces || !geo.faces.length) { this.state.set('empty'); return; }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1c1c2a);
    const group = new THREE.Group();
    scene.add(group);
    const measureGroup = new THREE.Group();
    scene.add(measureGroup);

    const box = new THREE.Box3();
    // Three shared face materials so the diff can recolour faces by status.
    const mkMat = (c: number) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.1, roughness: 0.65, flatShading: false, side: THREE.DoubleSide });
    this.faceMats = { neutral: mkMat(FACE_COLORS.neutral), added: mkMat(FACE_COLORS.added), removed: mkMat(FACE_COLORS.removed) };
    this.faceItemByMesh = new Map();
    geo.faces.forEach((f, fi) => {
      if (!f.positions || !f.positions.length || !f.indices || !f.indices.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(f.positions, 3));
      if (f.normals && f.normals.length === f.positions.length) {
        g.setAttribute('normal', new THREE.Float32BufferAttribute(f.normals, 3));
      } else {
        g.computeVertexNormals();
      }
      g.setIndex(f.indices);
      const mesh = new THREE.Mesh(g, this.matForFace(f.persistentName));
      mesh.userData['pname'] = f.persistentName || '';
      group.add(mesh);
      box.expandByObject(mesh);
      this.faceItemByMesh.set(mesh, faceMeasureItem(f, fi));
    });
    if (box.isEmpty()) { this.state.set('empty'); return; }

    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    this.modelRadius = radius;

    // Snap targets: topological vertices + edge segments. Edges are also drawn
    // as a faint wireframe so the user sees what is selectable.
    this.snapVertices = (geo.vertices || []).map(p => new THREE.Vector3(p[0], p[1], p[2]));
    this.vertexItems = this.snapVertices.map((p, i) => ({ kind: 'vertex', id: `vertex-${i}`, position: [p.x, p.y, p.z] }));
    this.snapEdges = [];
    const edgePts: number[] = [];
    for (const e of geo.edges || []) {
      const poly = e.polyline || [];
      if (poly.length < 2) continue;
      const pts = poly.map(p => new THREE.Vector3(p[0], p[1], p[2]));
      const segs: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        segs.push({ a: pts[i], b: pts[i + 1] });
        edgePts.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
      }
      this.snapEdges.push({ pts, segs, item: edgeMeasureItem(pts, this.snapEdges.length) });
    }
    if (edgePts.length) {
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));
      scene.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x11151f })));
    }

    // Reusable hover highlights (live in the scene, toggled visible): a vertex
    // dot, a translucent face overlay, and a bright edge line.
    const hover = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.022, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    hover.visible = false; scene.add(hover); this.hoverMarker = hover;

    const hf = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: SNAP_COLORS.face, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    hf.visible = false; scene.add(hf); this.hoverFace = hf;

    const he = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: SNAP_COLORS.edge, depthTest: false }));
    he.renderOrder = 999; he.visible = false; scene.add(he); this.hoverEdge = he;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(1, 1.4, 0.8);
    scene.add(dir);

    const camera = new THREE.PerspectiveCamera(40, this.w / this.h, radius * 0.05, radius * 50);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(this.w, this.h);
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.target.copy(center);
    controls.addEventListener('change', this.onControlsChange);

    this.scene = scene; this.group = group; this.measureGroup = measureGroup;
    this.camera = camera; this.renderer = renderer; this.controls = controls;

    this.applyNavMode();
    this.frameDefault();

    // Measurement picking — distinguish a click from an orbit drag.
    const el = renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerleave', this.onLeave);

    this.ready.set(true);
    this.state.set('ok');
    this.renderOnce();
  }

  private frameDefault() {
    if (!this.camera || !this.controls) return;
    const r = this.modelRadius;
    const t = this.controls.target;
    // Distance to fit the bounding sphere in the 40° FOV.
    const d = r / Math.sin((40 * Math.PI / 180) / 2) * 1.1;
    // Honour the model's saved default view: its spherical (theta, phi) gives
    // the camera direction (same Y-up convention as the editor viewer). The
    // model stays centered (controls.target = bbox center); only the
    // orientation carries over, and the distance auto-fits the preview frame.
    const v = this.defaultView;
    const dir = v
      ? new THREE.Vector3(
          Math.sin(v.phi) * Math.cos(v.theta),
          Math.cos(v.phi),
          Math.sin(v.phi) * Math.sin(v.theta),
        ).normalize()
      : new THREE.Vector3(0.6, 0.55, 0.6).normalize();
    this.camera.position.copy(t).addScaledVector(dir, d);
    this.camera.near = r * 0.02; this.camera.far = d + r * 8;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  resetView() {
    this.frameDefault();
    this.renderOnce();
  }

  // Which gesture the left mouse button performs. Wheel always zooms; the
  // middle/right buttons keep their defaults. Lets trackpad users without
  // extra buttons orbit / pan / zoom by drag.
  setNav(mode: 'orbit' | 'pan' | 'zoom') { this.navMode.set(mode); this.applyNavMode(); }

  private applyNavMode() {
    if (!this.controls) return;
    const m = this.navMode();
    this.controls.mouseButtons.LEFT = m === 'pan' ? THREE.MOUSE.PAN : m === 'zoom' ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
  }

  private renderOnce() {
    if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
  }

  // ── Camera sync (lock the two Compare previews together) ────────────────────
  private suppressCam = false;

  private onControlsChange = () => {
    this.renderOnce();
    if (!this.suppressCam && this.camera && this.controls) {
      this.cameraMove.emit({
        pos: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
        target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
        up: [this.camera.up.x, this.camera.up.y, this.camera.up.z],
      });
    }
  };

  /** Apply an external camera pose without re-emitting (avoids feedback loops). */
  applyCamera(c: PreviewCamera) {
    if (!this.camera || !this.controls) return;
    this.suppressCam = true;
    this.camera.up.set(c.up[0], c.up[1], c.up[2]);
    this.camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
    this.controls.target.set(c.target[0], c.target[1], c.target[2]);
    this.controls.update();
    this.suppressCam = false;
    this.renderOnce();
  }

  /** Current camera pose, or null before the preview has built. */
  getCamera(): PreviewCamera | null {
    if (!this.camera || !this.controls) return null;
    return {
      pos: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
      up: [this.camera.up.x, this.camera.up.y, this.camera.up.z],
    };
  }

  toggleMeasure() {
    const on = !this.measuring();
    this.measuring.set(on);
    if (!on) this.clearMeasure();
  }

  private clearMeasure() {
    this.picks = [];
    this.selItems = [];
    this.selCount.set(0);
    this.measureRows.set([]);
    this.measureSummary.set('');
    if (this.measureGroup) {
      for (const c of [...this.measureGroup.children]) {
        this.measureGroup.remove(c);
        const o = c as THREE.Mesh;
        if (o.geometry) o.geometry.dispose();
        const mat = o.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else if (mat) mat.dispose();
      }
    }
    this.hideHover();
    this.renderOnce();
  }

  private onDown = (ev: PointerEvent) => { this.downAt = { x: ev.clientX, y: ev.clientY }; };

  private onUp = (ev: PointerEvent) => {
    const d = this.downAt; this.downAt = null;
    if (!d || !this.measuring()) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 4) return; // a drag (orbit), not a pick
    this.pickPoint(ev);
  };

  // Live entity highlight while hovering in measure mode (not mid-drag).
  private onMove = (ev: PointerEvent) => {
    if (!this.measuring() || this.downAt) return;
    const snap = this.snapAt(ev);
    this.hideHover();
    if (snap) {
      if (snap.kind === 'vertex' && this.hoverMarker) { this.hoverMarker.position.copy(snap.point); this.hoverMarker.visible = true; }
      else if (snap.kind === 'edge' && this.hoverEdge && snap.edgePts) { this.setLinePoints(this.hoverEdge, snap.edgePts); this.hoverEdge.visible = true; }
      else if (snap.kind === 'face' && this.hoverFace && snap.faceGeom) { this.hoverFace.geometry = snap.faceGeom; this.hoverFace.visible = true; }
    }
    this.renderOnce();
  };

  private onLeave = () => { this.hideHover(); this.renderOnce(); };

  private hideHover() {
    if (this.hoverMarker) this.hoverMarker.visible = false;
    if (this.hoverFace) this.hoverFace.visible = false;
    if (this.hoverEdge) this.hoverEdge.visible = false;
  }

  private pickPoint(ev: PointerEvent) {
    const snap = this.snapAt(ev);
    if (!snap) return;
    if (this.selItems.length >= 2) this.clearMeasure();
    this.picks.push(snap.point);
    this.selItems.push(snap.item);
    this.selCount.set(this.selItems.length);
    this.addSelectionHighlight(snap);
    if (this.selItems.length === 2) this.addSegment(this.picks[0], this.picks[1]);
    // Whole-entity measurement via the same engine the editor uses.
    const res = computeMeasure(this.selItems, 'mm');
    this.measureSummary.set(res.summary);
    this.measureRows.set(res.rows);
    this.hideHover();
    this.renderOnce();
  }

  // Snap precedence: nearest *visible* vertex within VERT_PX, else nearest
  // visible edge point within EDGE_PX, else the raycast hit on the front face.
  // Distances are screen-space (pixels); the occlusion test keeps snapping from
  // reaching through the model to hidden topology on the far side.
  private snapAt(ev: PointerEvent): { point: THREE.Vector3; kind: SnapKind; item: MeasureItem; faceGeom?: THREE.BufferGeometry; edgePts?: THREE.Vector3[] } | null {
    if (!this.renderer || !this.camera || !this.group) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
    const cam = this.camera, W = rect.width, H = rect.height;
    const screen = (p: THREE.Vector3) => {
      const v = p.clone().project(cam);
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
    };
    const VERT_PX = 12, EDGE_PX = 9;

    let bestVi = -1, bestVd = VERT_PX;
    for (let i = 0; i < this.snapVertices.length; i++) {
      const v = this.snapVertices[i]; const s = screen(v); const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bestVd && !this.occluded(v)) { bestVd = d; bestVi = i; }
    }
    if (bestVi >= 0) return { point: this.snapVertices[bestVi].clone(), kind: 'vertex', item: this.vertexItems[bestVi] };

    this.raycaster.setFromCamera(new THREE.Vector2((cx / W) * 2 - 1, -(cy / H) * 2 + 1), cam);
    const ray = this.raycaster.ray;
    let bestE: THREE.Vector3 | null = null, bestEi = -1, bestEd = EDGE_PX;
    for (let ei = 0; ei < this.snapEdges.length; ei++) {
      for (const seg of this.snapEdges[ei].segs) {
        const cp = closestPointOnSegmentToRay(ray.origin, ray.direction, seg.a, seg.b);
        const s = screen(cp); const d = Math.hypot(s.x - cx, s.y - cy);
        if (d < bestEd && !this.occluded(cp)) { bestEd = d; bestE = cp; bestEi = ei; }
      }
    }
    if (bestE && bestEi >= 0) return { point: bestE, kind: 'edge', item: this.snapEdges[bestEi].item, edgePts: this.snapEdges[bestEi].pts };

    const hits = this.raycaster.intersectObject(this.group, true);
    if (hits.length) {
      const mesh = hits[0].object as THREE.Mesh;
      const item = this.faceItemByMesh.get(mesh);
      if (item) return { point: hits[0].point.clone(), kind: 'face', item, faceGeom: mesh.geometry as THREE.BufferGeometry };
    }
    return null;
  }

  // True if a face sits in front of `p` along the camera→p ray (p is hidden).
  private occluded(p: THREE.Vector3): boolean {
    if (!this.camera || !this.group) return false;
    const camPos = this.camera.position;
    const dist = p.distanceTo(camPos);
    this.occRay.set(camPos, p.clone().sub(camPos).normalize());
    const hit = this.occRay.intersectObject(this.group, true)[0];
    return !!hit && hit.distance < dist - this.modelRadius * 0.012;
  }

  private setLinePoints(line: THREE.Line, pts: THREE.Vector3[]) {
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  // Persistent highlight for a selected entity (cleared with the measurement):
  // an endpoint dot at the snap point plus a face overlay or edge line.
  private addSelectionHighlight(snap: { point: THREE.Vector3; kind: SnapKind; faceGeom?: THREE.BufferGeometry; edgePts?: THREE.Vector3[] }) {
    if (!this.measureGroup) return;
    // Faces/edges are shown by their whole-entity highlight; only a vertex needs
    // a point marker (it IS a point). No click-location dot otherwise.
    if (snap.kind === 'vertex') {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(this.modelRadius * 0.025, 12, 12), new THREE.MeshBasicMaterial({ color: SNAP_COLORS.vertex }));
      dot.position.copy(snap.point);
      this.measureGroup.add(dot);
    }
    if (snap.kind === 'face' && snap.faceGeom) {
      const overlay = new THREE.Mesh(snap.faceGeom.clone(), new THREE.MeshBasicMaterial({
        color: SNAP_COLORS.face, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }));
      this.measureGroup.add(overlay);
    } else if (snap.kind === 'edge' && snap.edgePts) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(snap.edgePts), new THREE.LineBasicMaterial({ color: SNAP_COLORS.edge, depthTest: false }));
      line.renderOrder = 998;
      this.measureGroup.add(line);
    }
  }

  private addSegment(a: THREE.Vector3, b: THREE.Vector3) {
    if (!this.measureGroup) return;
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffb74d }));
    this.measureGroup.add(line);
  }

  private teardown() {
    if (this.controls) { this.controls.dispose(); this.controls = undefined; }
    if (this.renderer) {
      const el = this.renderer.domElement;
      el.removeEventListener('pointerdown', this.onDown);
      el.removeEventListener('pointerup', this.onUp);
      el.removeEventListener('pointermove', this.onMove);
      el.removeEventListener('pointerleave', this.onLeave);
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      el.parentNode?.removeChild(el);
      this.renderer = undefined;
    }
    if (this.scene) {
      this.scene.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else if (mat) mat.dispose();
      });
      this.scene = undefined;
    }
    if (this.faceMats) { this.faceMats.neutral.dispose(); this.faceMats.added.dispose(); this.faceMats.removed.dispose(); this.faceMats = undefined; }
    this.group = this.measureGroup = undefined;
    this.hoverMarker = this.hoverFace = this.hoverEdge = undefined;
    this.camera = undefined;
    this.picks = [];
    this.selItems = [];
    this.snapVertices = [];
    this.vertexItems = [];
    this.snapEdges = [];
    this.faceItemByMesh = new Map();
    this.ready.set(false);
  }

  private revokePoster() {
    const u = this.posterUrl();
    if (u) { URL.revokeObjectURL(u); this.posterUrl.set(null); }
  }
}
