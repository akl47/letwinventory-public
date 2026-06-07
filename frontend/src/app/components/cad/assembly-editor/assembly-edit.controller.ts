import { Injectable, inject, signal, computed } from '@angular/core';
import { AssemblyService } from '../../../services/assembly.service';
import { CadModelService } from '../../../services/cad-model.service';
import { AuthService } from '../../../services/auth.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { PartWithCadSummary } from '../../../models/cad-model.model';
import { ModelGeometry, FaceMesh, ModelTopology } from '../../../cad/lib/types';
import {
  Assembly, AssemblyInstance, AssemblyRegenResponse, BomLine, Mate, MateType, ConstraintState, AssemblyPattern, PatternKind,
  DisplayState, MassProperties, InterferencePair, eulerToQuat, quatToEuler, validMateTypes, IDENTITY_PLACEMENT,
} from '../../../cad/lib/assembly.types';

const EMPTY_GEOMETRY: ModelGeometry = { datums: [], faces: [], topology: { vertices: [], edges: [] } };

/**
 * Holds all assembly-editing state + operations for the CAD editor's Assembly
 * mode. Provided per-editor instance (not root) so each editor has its own
 * state. The CAD editor's template renders the Assembly ribbon + component panel
 * bound to this controller, and feeds its `geometry()` to the shared viewer.
 */
@Injectable()
export class AssemblyEditController {
  private assemblyApi = inject(AssemblyService);
  private cadApi = inject(CadModelService);
  private auth = inject(AuthService);
  private errors = inject(ErrorNotificationService);

  isLockedByMe = computed(() => {
    const a = this.assembly();
    return !!a && a.lockedByUserID != null && a.lockedByUserID === this.auth.currentUser()?.id;
  });

  partID = signal<number>(0);
  loading = signal(true);
  assembly = signal<Assembly | null>(null);
  regen = signal<AssemblyRegenResponse | null>(null);
  regenError = signal<string | null>(null);
  selectedId = signal<string | null>(null);
  bom = signal<BomLine[]>([]);
  massProps = signal<MassProperties | null>(null);
  interferencePairs = signal<InterferencePair[] | null>(null);
  analysisBusy = signal(false);
  showPicker = signal(false);
  partsWithCad = signal<PartWithCadSummary[]>([]);
  partSearch = signal('');

  // Placement inspector fields for the selected instance.
  tx = signal(0); ty = signal(0); tz = signal(0);
  rx = signal(0); ry = signal(0); rz = signal(0);

  instances = computed<AssemblyInstance[]>(() => this.assembly()?.assemblyDoc?.instances || []);
  selectedInstance = computed(() => this.instances().find((i) => i.instanceId === this.selectedId()) || null);
  mates = computed<Mate[]>(() => this.assembly()?.assemblyDoc?.mates || []);
  patterns = computed<AssemblyPattern[]>(() => this.assembly()?.assemblyDoc?.patterns || []);
  constraintState = computed<ConstraintState | null>(() => this.regen()?.constraintState ?? null);

  replaceTargetId = signal<string | null>(null);

  explodeFactor = signal(0);
  displayStates = computed<DisplayState[]>(() => this.assembly()?.assemblyDoc?.displayStates || []);
  sectionEnabled = signal(false);
  sectionAxis = signal<'X' | 'Y' | 'Z'>('X');
  sectionPos = signal(0);
  sectionPlane = computed<{ normal: [number, number, number]; point: [number, number, number] } | null>(() => {
    if (!this.sectionEnabled()) return null;
    const ax = this.sectionAxis();
    const normal: [number, number, number] = ax === 'X' ? [1, 0, 0] : ax === 'Y' ? [0, 1, 0] : [0, 0, 1];
    const p = this.sectionPos();
    return { normal, point: [normal[0] * p, normal[1] * p, normal[2] * p] };
  });

  patternSeedId = signal<string | null>(null);
  patternKind = signal<PatternKind>('linear');
  pCount = signal(3);
  pSpacing = signal<[number, number, number]>([10, 0, 0]);
  pAngle = signal(90);
  pPlane = signal<'YZ' | 'XZ' | 'XY'>('YZ');

  matePickStage = signal<null | 'a' | 'b'>(null);
  faceA = signal<string | null>(null);
  faceB = signal<string | null>(null);
  showMateChooser = signal(false);
  mateValue = signal(0);
  facePickActive = computed(() => this.matePickStage() !== null);
  pickedFaceIds = computed(() => new Set([this.faceA(), this.faceB()].filter((x): x is string => !!x)));

  private surfaceKindOf(scopedFaceId: string | null): string | undefined {
    if (!scopedFaceId) return undefined;
    const f = this.regen()?.faces.find((x) => (x.persistentName || x.faceId) === scopedFaceId);
    return f?.surface?.kind;
  }
  chooserTypes = computed<MateType[]>(() => validMateTypes(this.surfaceKindOf(this.faceA()), this.surfaceKindOf(this.faceB())));
  valueMates: MateType[] = ['distance', 'angle'];

  filteredParts = computed(() => {
    const q = this.partSearch().trim().toLowerCase();
    const list = this.partsWithCad();
    if (!q) return list;
    return list.filter((p) => `${p.part?.name || ''} ${p.part?.revision || ''}`.toLowerCase().includes(q));
  });

  // Compose the viewer geometry from the regenerate result, omitting hidden
  // instances and applying the explode offset × factor.
  geometry = computed<ModelGeometry>(() => {
    const r = this.regen();
    if (!r) return EMPTY_GEOMETRY;
    const hidden = new Set(this.instances().filter((i) => i.visible === false).map((i) => i.instanceId));
    const explode = this.assembly()?.assemblyDoc?.explode;
    const factor = this.explodeFactor();
    const offsetFor = (instanceId: string): [number, number, number] => {
      const o = explode?.offsets?.[instanceId];
      return o ? [o[0] * factor, o[1] * factor, o[2] * factor] : [0, 0, 0];
    };
    const shiftBuf = (arr: number[], off: [number, number, number]): Float32Array => {
      const out = new Float32Array(arr.length);
      for (let i = 0; i < arr.length; i += 3) { out[i] = arr[i] + off[0]; out[i + 1] = arr[i + 1] + off[1]; out[i + 2] = arr[i + 2] + off[2]; }
      return out;
    };
    const faces: FaceMesh[] = [];
    const vertices: ModelTopology['vertices'] = [];
    const edges: ModelTopology['edges'] = [];
    let vi = 0, ei = 0;
    for (const body of r.bodies) {
      if (hidden.has(body.instanceId)) continue;
      const off = offsetFor(body.instanceId);
      const exploding = off[0] !== 0 || off[1] !== 0 || off[2] !== 0;
      for (const f of body.faces) {
        faces.push({
          faceId: f.faceId || f.persistentName,
          positions: exploding ? shiftBuf(f.positions, off) : new Float32Array(f.positions),
          normals: new Float32Array(f.normals),
          indices: new Uint32Array(f.indices),
          featureId: body.instanceId,
          isFlat: f.surface?.kind === 'plane',
        });
      }
      for (const v of body.vertices) vertices.push({ id: `v${vi++}`, position: [v[0] + off[0], v[1] + off[1], v[2] + off[2]] });
      for (const e of body.edges) {
        const poly = e.polyline as Array<[number, number, number]>;
        if (!poly || poly.length < 2) continue;
        const pp = exploding ? poly.map((p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2]] as [number, number, number]) : poly;
        edges.push({ id: `e${ei++}`, isStraight: pp.length === 2, endpoints: [pp[0], pp[pp.length - 1]], polyline: pp.length > 2 ? pp : undefined });
      }
    }
    return { datums: [], faces, topology: { vertices, edges } };
  });

  /** Load the assembly for a part (called by the CAD editor in assembly mode). */
  load(id: number) {
    this.partID.set(id);
    this.loading.set(true);
    this.cadApi.listPartsWithCad().subscribe({ next: (r) => this.partsWithCad.set(r), error: () => {} });
    this.assemblyApi.getActiveByPart(id).subscribe({
      next: (a) => { this.assembly.set(a); this.loading.set(false); this.regenerate(); },
      error: (e) => {
        this.loading.set(false);
        if (e?.status !== 404) this.errors.showError(e?.error?.error || 'Failed to load assembly');
      },
    });
  }

  partName(partID: number): string {
    const p = this.partsWithCad().find((x) => x.partID === partID);
    return p?.part?.name || `Part ${partID}`;
  }

  createAssembly() {
    this.assemblyApi.createForPart(this.partID()).subscribe({
      next: (a) => { this.assembly.set(a); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to create assembly'),
    });
  }

  regenerate() {
    const a = this.assembly();
    if (!a) return;
    this.regenError.set(null);
    this.assemblyApi.regenerate(a.id).subscribe({
      next: (r) => {
        this.regen.set(r);
        if (r.errors?.length) this.regenError.set(r.errors.join('; '));
      },
      error: (e) => {
        this.regen.set(null);
        this.regenError.set(e?.status === 503
          ? 'CAD kernel is offline — components cannot be rendered.'
          : (e?.error?.error || 'Failed to regenerate assembly'));
      },
    });
  }

  togglePicker() { this.replaceTargetId.set(null); this.showPicker.set(!this.showPicker()); }
  startReplace(inst: AssemblyInstance) { this.replaceTargetId.set(inst.instanceId); this.showPicker.set(true); }

  insert(partID: number) {
    const a = this.assembly();
    if (!a) return;
    const replacing = this.replaceTargetId();
    const obs = replacing
      ? this.assemblyApi.replaceInstance(a.id, replacing, partID)
      : this.assemblyApi.insertInstance(a.id, { partID });
    obs.subscribe({
      next: (res: { assembly: Assembly }) => { this.assembly.set(res.assembly); this.showPicker.set(false); this.replaceTargetId.set(null); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || (replacing ? 'Failed to replace component' : 'Failed to insert component')),
    });
  }

  openPatternForm(inst: AssemblyInstance) { this.patternSeedId.set(inst.instanceId); this.patternKind.set('linear'); }
  cancelPattern() { this.patternSeedId.set(null); }
  createPattern() {
    const a = this.assembly();
    const seed = this.patternSeedId();
    if (!a || !seed) return;
    const kind = this.patternKind();
    const body: { kind: PatternKind; seedInstanceId: string } & Partial<AssemblyPattern> = { kind, seedInstanceId: seed };
    if (kind === 'linear') { body.count = this.pCount(); body.spacing = this.pSpacing(); }
    else if (kind === 'circular') { body.count = this.pCount(); body.axisOrigin = [0, 0, 0]; body.axisDir = [0, 0, 1]; body.angleStep = (this.pAngle() * Math.PI) / 180; }
    else { body.planeOrigin = [0, 0, 0]; body.planeNormal = this.pPlane() === 'YZ' ? [1, 0, 0] : this.pPlane() === 'XZ' ? [0, 1, 0] : [0, 0, 1]; }
    this.assemblyApi.addPattern(a.id, body).subscribe({
      next: (res) => { this.assembly.set(res.assembly); this.cancelPattern(); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to create pattern'),
    });
  }
  removePattern(p: AssemblyPattern) {
    const a = this.assembly();
    if (!a) return;
    this.assemblyApi.removePattern(a.id, p.patternId).subscribe({
      next: (asm) => { this.assembly.set(asm); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to remove pattern'),
    });
  }

  remove(inst: AssemblyInstance) {
    const a = this.assembly();
    if (!a) return;
    this.assemblyApi.removeInstance(a.id, inst.instanceId).subscribe({
      next: (asm) => { this.assembly.set(asm); if (this.selectedId() === inst.instanceId) this.selectedId.set(null); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to remove component'),
    });
  }

  toggleVisible(inst: AssemblyInstance) {
    const a = this.assembly();
    if (!a) return;
    const visible = inst.visible === false;
    this.assemblyApi.updateInstance(a.id, inst.instanceId, { visible }).subscribe({
      next: (res) => this.assembly.set(res.assembly),
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to toggle visibility'),
    });
  }

  toggleGrounded(inst: AssemblyInstance) {
    const a = this.assembly();
    if (!a) return;
    this.assemblyApi.updateInstance(a.id, inst.instanceId, { grounded: !inst.grounded }).subscribe({
      next: (res) => this.assembly.set(res.assembly),
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to update component'),
    });
  }

  select(instanceId: string) {
    this.selectedId.set(instanceId);
    const inst = this.selectedInstance();
    const p = inst?.placement || IDENTITY_PLACEMENT;
    this.tx.set(p.translate[0]); this.ty.set(p.translate[1]); this.tz.set(p.translate[2]);
    const [ex, ey, ez] = quatToEuler(p.quaternion);
    this.rx.set(round(ex)); this.ry.set(round(ey)); this.rz.set(round(ez));
  }

  applyPlacement() {
    const a = this.assembly();
    const inst = this.selectedInstance();
    if (!a || !inst) return;
    const placement = {
      translate: [this.tx(), this.ty(), this.tz()] as [number, number, number],
      quaternion: eulerToQuat(this.rx(), this.ry(), this.rz()),
    };
    this.assemblyApi.updateInstance(a.id, inst.instanceId, { placement }).subscribe({
      next: (res) => { this.assembly.set(res.assembly); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to update placement'),
    });
  }

  loadBom() {
    const a = this.assembly();
    if (!a) return;
    this.assemblyApi.bom(a.id).subscribe({
      next: (lines) => this.bom.set(lines),
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to load BOM'),
    });
  }

  // ── mate creation flow ──────────────────────────────────────────────────────
  startMate() { this.faceA.set(null); this.faceB.set(null); this.showMateChooser.set(false); this.matePickStage.set('a'); }
  cancelMate() { this.matePickStage.set(null); this.faceA.set(null); this.faceB.set(null); this.showMateChooser.set(false); }
  /** @returns true if the pick was consumed by the mate flow. */
  onFacePicked(faceId: string): boolean {
    if (this.matePickStage() === 'a') {
      this.faceA.set(faceId); this.matePickStage.set('b'); return true;
    }
    if (this.matePickStage() === 'b') {
      if (splitScoped(faceId).instanceId === splitScoped(this.faceA()!).instanceId) {
        this.errors.showError('Pick a face on a different component.'); return true;
      }
      this.faceB.set(faceId); this.matePickStage.set(null); this.mateValue.set(0); this.showMateChooser.set(true); return true;
    }
    return false;
  }
  createMate(type: MateType) {
    const a = this.assembly();
    const fa = this.faceA(); const fb = this.faceB();
    if (!a || !fa || !fb) return;
    const refA = splitScoped(fa); const refB = splitScoped(fb);
    const body: { type: MateType; a: typeof refA; b: typeof refB; value?: number } = { type, a: refA, b: refB };
    if (this.valueMates.includes(type)) body.value = type === 'angle' ? (this.mateValue() * Math.PI) / 180 : this.mateValue();
    this.assemblyApi.addMate(a.id, body).subscribe({
      next: (res) => { this.assembly.set(res.assembly); this.cancelMate(); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to create mate'),
    });
  }
  removeMate(mate: Mate) {
    const a = this.assembly();
    if (!a) return;
    this.assemblyApi.removeMate(a.id, mate.mateId).subscribe({
      next: (asm) => { this.assembly.set(asm); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to remove mate'),
    });
  }
  mateLabel(m: Mate): string {
    return `${m.type}: ${this.partName(this.instanceOf(m.a.instanceId)?.partID ?? 0)} ↔ ${this.partName(this.instanceOf(m.b.instanceId)?.partID ?? 0)}`;
  }
  private instanceOf(instanceId: string) { return this.instances().find((i) => i.instanceId === instanceId); }
  patternSeedName(p: AssemblyPattern): string { return this.partName(this.instanceOf(p.seedInstanceId)?.partID ?? 0); }

  // ── visualization ───────────────────────────────────────────────────────────
  autoExplode() {
    const a = this.assembly();
    if (!a) return;
    this.assemblyApi.autoExplode(a.id).subscribe({
      next: (res) => { this.assembly.set(res.assembly); this.explodeFactor.set(1); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to explode'),
    });
  }
  onExplodeChange(v: number) {
    this.explodeFactor.set(v);
    const a = this.assembly();
    if (a) this.assemblyApi.setExplode(a.id, v).subscribe({ next: () => {}, error: () => {} });
  }
  saveDisplayState() {
    const a = this.assembly();
    if (!a) return;
    const name = window.prompt('Display state name:', '');
    if (!name) return;
    this.assemblyApi.saveDisplayState(a.id, name).subscribe({
      next: (res) => this.assembly.set(res.assembly),
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to save display state'),
    });
  }
  applyDisplayState(s: DisplayState) {
    const a = this.assembly();
    if (!a) return;
    this.assemblyApi.applyDisplayState(a.id, s.id).subscribe({
      next: (asm) => this.assembly.set(asm),
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to apply display state'),
    });
  }
  deleteDisplayState(s: DisplayState) {
    const a = this.assembly();
    if (!a) return;
    this.assemblyApi.deleteDisplayState(a.id, s.id).subscribe({
      next: (asm) => this.assembly.set(asm),
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to delete display state'),
    });
  }

  // ── analysis + documentation ────────────────────────────────────────────────
  computeMass() {
    const a = this.assembly();
    if (!a) return;
    this.analysisBusy.set(true);
    this.assemblyApi.massProperties(a.id).subscribe({
      next: (mp) => { this.massProps.set(mp); this.analysisBusy.set(false); },
      error: (e) => { this.analysisBusy.set(false); this.errors.showError(e?.status === 503 ? 'CAD kernel is offline.' : (e?.error?.error || 'Failed to compute mass properties')); },
    });
  }
  checkInterference() {
    const a = this.assembly();
    if (!a) return;
    this.analysisBusy.set(true);
    this.assemblyApi.interference(a.id).subscribe({
      next: (res) => { this.interferencePairs.set(res.pairs); this.analysisBusy.set(false); },
      error: (e) => { this.analysisBusy.set(false); this.errors.showError(e?.status === 503 ? 'CAD kernel is offline.' : (e?.error?.error || 'Interference check failed')); },
    });
  }
  syncBom() {
    const a = this.assembly();
    if (!a) return;
    this.assemblyApi.syncBom(a.id).subscribe({
      next: (res) => this.errors.showError(`Synced ${res.count} component${res.count === 1 ? '' : 's'} to the inventory BOM.`),
      error: (e) => this.errors.showError(e?.error?.error || 'BOM sync failed'),
    });
  }
  interferenceCount(): number { return (this.interferencePairs() || []).filter((p) => p.interfering !== false).length; }
  instName(id: string): string { return this.partName(this.instanceOf(id)?.partID ?? 0); }

  // ── version control ─────────────────────────────────────────────────────────
  checkout() {
    const a = this.assembly();
    if (!a) return;
    this.assemblyApi.checkout(a.id).subscribe({
      next: (asm) => this.assembly.set(asm),
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to check out'),
    });
  }
  checkin() {
    const a = this.assembly();
    if (!a) return;
    const message = window.prompt('Check-in message:', '') ?? '';
    this.assemblyApi.checkin(a.id, message).subscribe({
      next: (res) => this.assembly.set(res.model),
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to check in'),
    });
  }
  undoCheckout() {
    const a = this.assembly();
    if (!a) return;
    if (!window.confirm('Discard all changes since check-out?')) return;
    this.assemblyApi.undoCheckout(a.id).subscribe({
      next: (asm) => { this.assembly.set(asm); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to undo checkout'),
    });
  }

  exportStep() {
    const a = this.assembly();
    if (!a) return;
    this.assemblyApi.exportStep(a.id).subscribe({
      next: (step) => download(new Blob([step], { type: 'application/step' }), `${a.part?.name || 'assembly'}.step`),
      error: (e) => this.errors.showError(e?.status === 503 ? 'CAD kernel is offline.' : (e?.error?.error || 'Export failed')),
    });
  }
  exportStl() {
    const a = this.assembly();
    if (!a) return;
    this.assemblyApi.exportStl(a.id).subscribe({
      next: (blob) => download(blob, `${a.part?.name || 'assembly'}.stl`),
      error: (e) => this.errors.showError(e?.status === 503 ? 'CAD kernel is offline.' : (e?.error?.error || 'Export failed')),
    });
  }
}

function round(v: number): number { return Math.round(v * 100) / 100; }

function splitScoped(id: string): { instanceId: string; faceId: string } {
  const idx = id.indexOf('::');
  if (idx < 0) return { instanceId: '', faceId: id };
  return { instanceId: id.slice(0, idx), faceId: id.slice(idx + 2) };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
