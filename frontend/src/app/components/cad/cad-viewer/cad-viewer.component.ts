import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy,
  effect, input, output, signal, NgZone, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
import type {
  ModelGeometry, DatumElement, SketchDocument, Sketch, SketchEntity,
  CircleEntity, ArcEntity,
} from '../../../cad/lib/types';
import { findPoint } from '../../../cad/lib/types';
import { tessellateCircle, tessellateArc, DEFAULT_CHORD_TOLERANCE } from '../../../cad/lib/tessellator';

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
  hovered = signal<string | null>(null);
  selectionChange = output<string | null>();
  loading = input<boolean>(false);
  loadProgress = input<string>('');
  // REQ 615: sketch overlays in the 3D scene.
  sketchDoc = input<SketchDocument | null>(null);
  activeSketchId = input<string | null>(null);

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
  // Keyed by sketchId; each entry is one container Group holding the projected
  // line segments and point markers for that sketch.
  private sketchOverlays = new Map<string, THREE.Group>();

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

  constructor() {
    effect(() => {
      const g = this.geometry();
      if (this.scene && g) this.syncGeometry(g);
    });
    effect(() => {
      const sel = this.selected();
      const hov = this.hovered();
      if (this.scene) this.recolor(sel, hov);
    });
    effect(() => {
      const doc = this.sketchDoc();
      const active = this.activeSketchId();
      if (this.scene) this.syncSketches(doc, active);
    });
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

    // Input handlers.
    const canvas = this.renderer.domElement;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('click', this.onClick);
    // Suppress the native context menu so right-drag can orbit in sketch mode.
    canvas.addEventListener('contextmenu', ev => ev.preventDefault());

    // Resize.
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(mount);

    // Initial geometry.
    const g = this.geometry();
    if (g) this.syncGeometry(g);
    this.syncSketches(this.sketchDoc(), this.activeSketchId());

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
    this.zone.run(() => this.selectionChange.emit(id));
  };

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
    // Clear and rebuild face meshes (face IDs reshuffle on every regen).
    for (const mesh of this.faceMeshes.values()) {
      this.faceGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.faceMeshes.clear();

    for (const f of g.faces) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(f.positions, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(f.normals, 3));
      geom.setIndex(new THREE.BufferAttribute(f.indices, 1));
      const mat = new THREE.MeshStandardMaterial({
        color: 0x8aa0c4, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData = { faceId: f.faceId };
      this.faceGroup.add(mesh);
      this.faceMeshes.set(f.faceId, mesh);
    }

    this.recolor(this.selected(), this.hovered());
  }

  // REQ 615: project each visible non-active sketch's entities into the 3D
  // scene as line geometry on the sketch's host plane.
  private syncSketches(doc: SketchDocument | null, activeSketchId: string | null) {
    // Tear down stale overlays.
    for (const [, group] of this.sketchOverlays) {
      this.sketchGroup.remove(group);
      group.traverse(child => {
        const m = (child as THREE.Mesh).material as THREE.Material | undefined;
        if (m) Array.isArray(m) ? m.forEach(x => x.dispose()) : m.dispose();
        const g = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (g) g.dispose();
      });
    }
    this.sketchOverlays.clear();
    if (!doc) return;
    for (const sketch of Object.values(doc.sketches)) {
      // REQ 616: active sketch ALSO renders (no filter on activeSketchId). The
      // visibility flag still applies. activeSketchId is consumed elsewhere for
      // pointer dispatch.
      void activeSketchId;
      if (sketch.visible === false) continue;
      const group = this.buildSketchOverlay(sketch);
      if (group.children.length === 0) continue;
      this.sketchGroup.add(group);
      this.sketchOverlays.set(sketch.id, group);
    }
  }

  private project2DTo3D(sketch: Sketch, p: { x: number; y: number }): THREE.Vector3 {
    const o = new THREE.Vector3(...sketch.plane.origin);
    const x = new THREE.Vector3(...sketch.plane.xAxis);
    const y = new THREE.Vector3(...sketch.plane.yAxis);
    return o.clone().addScaledVector(x, p.x).addScaledVector(y, p.y);
  }

  private buildSketchOverlay(sketch: Sketch): THREE.Group {
    const group = new THREE.Group();
    group.userData = { sketchId: sketch.id };
    const project = (p: { x: number; y: number }) => this.project2DTo3D(sketch, p);
    for (const e of sketch.state.entities) {
      const obj = this.buildSketchEntity(sketch, e, project);
      if (obj) group.add(obj);
    }
    return group;
  }

  private buildSketchEntity(
    sketch: Sketch, e: SketchEntity,
    project: (p: { x: number; y: number }) => THREE.Vector3,
  ): THREE.Object3D | null {
    const color = e.construction ? 0x666666 : 0x42a5f5;
    const dashed = !!e.construction;
    switch (e.kind) {
      case 'point': {
        const geom = new THREE.SphereGeometry(0.6, 8, 6);
        const mat = new THREE.MeshBasicMaterial({ color: e.construction ? 0x888888 : 0xffffff });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.copy(project(e));
        return mesh;
      }
      case 'line': {
        const a = findPoint(sketch.state, e.startId);
        const b = findPoint(sketch.state, e.endId);
        if (!a || !b) return null;
        return this.makeLineSegments([project(a), project(b)], color, dashed);
      }
      case 'circle': {
        const c = findPoint(sketch.state, e.centerId);
        if (!c) return null;
        const pts2D = tessellateCircle({ x: c.x, y: c.y }, (e as CircleEntity).radius, DEFAULT_CHORD_TOLERANCE);
        return this.makeLineSegments(pts2D.map(project), color, dashed);
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
        return this.makeLineSegments(pts2D.map(project), color, dashed);
      }
      default:
        // Phase B/C entity kinds (ellipse, ellipticalArc, spline, conic) — not yet rendered.
        return null;
    }
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

  private recolor(selected: string | null, hovered: string | null) {
    for (const [id, mesh] of this.faceMeshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (id === selected) mat.color.setHex(0xec407a);
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
