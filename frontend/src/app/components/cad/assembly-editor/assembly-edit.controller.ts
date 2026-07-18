import { Injectable, inject, signal, computed } from '@angular/core';
import { AssemblyService } from '../../../services/assembly.service';
import { CadModelService } from '../../../services/cad-model.service';
import { AuthService } from '../../../services/auth.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { PartWithCadSummary } from '../../../models/cad-model.model';
import { ModelGeometry, FaceMesh, ModelTopology, DatumElement } from '../../../cad/lib/types';
import { assemblyOriginDatums, placedOriginDatums, ORIGIN_DATUM_DESCRIPTORS } from '../../../cad/lib/assemblyDatums';
import { defaultDatumVisibility } from '../../../cad/lib/featureTree';
import { formatPartNumber } from '../../../pipes/part-number.pipe';
import type { TreeNode } from '../cad-feature-tree-panel/cad-feature-tree-panel.component';
import {
  Assembly, AssemblyInstance, AssemblyRegenResponse, BomLine, Mate, MateType, ConstraintState, AssemblyPattern, PatternKind,
  DisplayState, MassProperties, InterferencePair, validMateTypes,
} from '../../../cad/lib/assembly.types';
import { canDragInstance, translatedPlacement } from '../../../cad/lib/assemblyDrag';

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
  /** Multi-selection set (component instance ids). `selectedId` is the anchor /
   * single-selection used by the property + pattern panels; `selectedIds` drives
   * the tree highlight and bulk delete. */
  selectedIds = signal<Set<string>>(new Set());
  bom = signal<BomLine[]>([]);
  massProps = signal<MassProperties | null>(null);
  interferencePairs = signal<InterferencePair[] | null>(null);
  analysisBusy = signal(false);
  showPicker = signal(false);
  partsWithCad = signal<PartWithCadSummary[]>([]);
  partSearch = signal('');

  instances = computed<AssemblyInstance[]>(() => this.assembly()?.assemblyDoc?.instances || []);
  selectedInstance = computed(() => this.instances().find((i) => i.instanceId === this.selectedId()) || null);
  mates = computed<Mate[]>(() => this.assembly()?.assemblyDoc?.mates || []);
  patterns = computed<AssemblyPattern[]>(() => this.assembly()?.assemblyDoc?.patterns || []);
  constraintState = computed<ConstraintState | null>(() => this.regen()?.constraintState ?? null);
  // CAD-782: which components the viewer may drag — un-grounded, un-suppressed,
  // and only while this user holds the edit lock (otherwise the assembly is
  // read-only). Also disabled when the assembly is fully constrained (0 DOF):
  // nothing can move, so a drag would just snap back. Empty in part mode.
  draggableInstanceIds = computed<Set<string>>(() => {
    if (!this.isLockedByMe()) return new Set<string>();
    if (this.constraintState()?.state === 'fully') return new Set<string>();
    return new Set(this.instances().filter(canDragInstance).map((i) => i.instanceId));
  });

  replaceTargetId = signal<string | null>(null);

  // CAD-784/785 datum visibility (session-local; not persisted). The assembly's
  // own origin shows by default, with per-datum visibility mirroring a part's
  // OriginFeature. Each inserted component is a collapsed node whose reference
  // datums (origin point + 3 planes + 3 axes) are hidden until toggled on.
  originExpanded = signal(false);
  originVisibility = signal<Record<string, boolean>>(defaultDatumVisibility());
  readonly originDatums = ORIGIN_DATUM_DESCRIPTORS;
  originDatumVisible = (datumId: string) => this.originVisibility()[datumId] !== false;
  /** True if any origin datum is currently shown (drives the Origin row's eye). */
  originAnyVisible = computed(() => this.originDatums.some((d) => this.originVisibility()[d.id] !== false));
  toggleOriginExpand() { this.originExpanded.update((v) => !v); }
  toggleOriginDatum(datumId: string) {
    const vis = { ...defaultDatumVisibility(), ...this.originVisibility() };
    vis[datumId] = !(vis[datumId] !== false);
    this.originVisibility.set(vis);
  }
  /** Top-level show/hide for the whole origin: shows all datums if any are
   * hidden, otherwise hides them all. */
  toggleOriginVisibility() {
    const show = !this.originAnyVisible();
    const vis: Record<string, boolean> = {};
    for (const d of this.originDatums) vis[d.id] = show;
    this.originVisibility.set(vis);
  }

  // Per-component expand (collapsed by default) + per-component-per-datum
  // visibility (hidden by default), keyed `<instanceId>:<datumId>`.
  expandedComponents = signal<Set<string>>(new Set<string>());
  componentDatumsVisible = signal<Set<string>>(new Set<string>());
  /** Hidden component BODIES (scoped ids `instanceId::bodyId`) — render-only,
   * like datum visibility. */
  hiddenComponentBodies = signal<Set<string>>(new Set<string>());
  toggleComponentBody(scopedBodyId: string) {
    const next = new Set(this.hiddenComponentBodies());
    if (next.has(scopedBodyId)) next.delete(scopedBodyId); else next.add(scopedBodyId);
    this.hiddenComponentBodies.set(next);
  }
  /** Per-component "Origin" group expansion (nested under the component row). */
  expandedComponentOrigins = signal<Set<string>>(new Set<string>());
  componentOriginExpanded = (instanceId: string) => this.expandedComponentOrigins().has(instanceId);
  toggleComponentOriginExpand(instanceId: string) {
    const next = new Set(this.expandedComponentOrigins());
    if (next.has(instanceId)) next.delete(instanceId); else next.add(instanceId);
    this.expandedComponentOrigins.set(next);
  }
  /** Origin-group eye: shows all of the component's datums if any are hidden,
   * else hides them all (mirrors the assembly origin row). */
  toggleComponentOriginVisibility(instanceId: string) {
    const next = new Set(this.componentDatumsVisible());
    const anyVisible = this.originDatums.some((d) => next.has(`${instanceId}:${d.id}`));
    for (const d of this.originDatums) {
      const key = `${instanceId}:${d.id}`;
      if (anyVisible) next.delete(key); else next.add(key);
    }
    this.componentDatumsVisible.set(next);
  }
  componentExpanded = (instanceId: string) => this.expandedComponents().has(instanceId);
  componentDatumVisible = (instanceId: string, datumId: string) =>
    this.componentDatumsVisible().has(`${instanceId}:${datumId}`);
  toggleComponentExpand(instanceId: string) {
    const next = new Set(this.expandedComponents());
    if (next.has(instanceId)) next.delete(instanceId); else next.add(instanceId);
    this.expandedComponents.set(next);
  }
  toggleComponentDatum(instanceId: string, datumId: string) {
    const key = `${instanceId}:${datumId}`;
    const next = new Set(this.componentDatumsVisible());
    if (next.has(key)) next.delete(key); else next.add(key);
    this.componentDatumsVisible.set(next);
  }

  /** REQ 912 — skeleton datum plane features computed from the assembly's
   * featureTree. The cad-editor owns that signal (shared with the sketch
   * flow) and pushes the computed PlacedDatums here via an effect. */
  skeletonDatums = signal<DatumElement[]>([]);

  // The assembly's own origin datums + skeleton datum plane features + every
  // component reference datum toggled on, transformed to its solved placement.
  assemblyDatums = computed<DatumElement[]>(() => {
    const out: DatumElement[] = assemblyOriginDatums(this.originVisibility());
    out.push(...this.skeletonDatums());
    const visible = this.componentDatumsVisible();
    if (visible.size) {
      for (const inst of this.regen()?.instances ?? []) {
        const prefix = `inst:${inst.instanceId}:`;
        for (const d of placedOriginDatums(inst.placement, prefix, this.partName(inst.partID))) {
          const sub = d.id.slice(prefix.length);
          if (visible.has(`${inst.instanceId}:${sub}`)) out.push(d);
        }
      }
    }
    return out;
  });

  displayStates = computed<DisplayState[]>(() => this.assembly()?.assemblyDoc?.displayStates || []);

  // REQ 764 — exploded view. Offsets are persisted per instance on the doc
  // (world vectors at factor 1); the factor slider scales them 0..1 locally.
  // Purely a render-layer displacement: geometry() shifts each instance's
  // meshes, the stored placements and the solver never see it.
  explodeEnabled = signal(false);
  explodeFactor = signal(1);
  explodeOffsets = computed<Record<string, [number, number, number]>>(
    () => this.assembly()?.assemblyDoc?.explode?.offsets || {});
  explodeBusy = signal(false);

  toggleExplode() {
    if (this.explodeEnabled()) { this.explodeEnabled.set(false); return; }
    if (Object.keys(this.explodeOffsets()).length > 0) { this.explodeEnabled.set(true); return; }
    // First use on this assembly — derive + persist radial offsets.
    const id = this.assembly()?.id;
    if (!id || this.explodeBusy()) return;
    this.explodeBusy.set(true);
    this.assemblyApi.autoExplode(id).subscribe({
      next: (r) => { this.assembly.set(r.assembly); this.explodeEnabled.set(true); this.explodeBusy.set(false); },
      error: (e) => { this.explodeBusy.set(false); this.errors.showError(e?.error?.error || 'Auto-explode failed'); },
    });
  }

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
  mateFlip = signal(false);
  /** When re-picking ONE existing slot (vs the initial a→b sequence), this
   * holds which slot, so onFacePicked replaces just that face and returns to
   * the chooser instead of advancing to the next slot. */
  mateRepick = signal<null | 'a' | 'b'>(null);
  facePickActive = computed(() => this.matePickStage() !== null);
  pickedFaceIds = computed(() => new Set([this.faceA(), this.faceB()].filter((x): x is string => !!x)));

  private surfaceKindOf(scopedFaceId: string | null): string | undefined {
    if (!scopedFaceId) return undefined;
    // Datum references (origin/axis/plane) report a mateable kind directly.
    const local = scopedFaceId.includes('::') ? scopedFaceId.split('::')[1] : scopedFaceId;
    if (local === 'xy_plane' || local === 'yz_plane' || local === 'xz_plane') return 'plane';
    if (local === 'x_axis' || local === 'y_axis' || local === 'z_axis') return 'cylinder';
    if (local === 'origin') return 'point';
    const f = this.regen()?.faces.find((x) => (x.persistentName || x.faceId) === scopedFaceId);
    return f?.surface?.kind;
  }
  chooserTypes = computed<MateType[]>(() => validMateTypes(this.surfaceKindOf(this.faceA()), this.surfaceKindOf(this.faceB())));
  valueMates: MateType[] = ['distance', 'angle'];
  // Mate types whose normal direction can be flipped (the solver consumes
  // mate.flip for these). Plane mates coincident/distance + the tangent mate.
  flipMates: MateType[] = ['coincident', 'distance', 'tangent'];

  // ── editing an existing mate ──────────────────────────────────────────────
  // Editing reopens the FULL mate sidebar (same UX as creation) with the two
  // surfaces pre-selected, so the user can re-pick a surface, change the type,
  // value, or flip — not just value/flip. `editingMate` being set makes
  // `createMate` UPDATE that mate instead of adding a new one.
  editingMate = signal<Mate | null>(null);
  mateHasValue = (m: Mate) => this.valueMates.includes(m.type);
  mateHasFlip = (m: Mate) => this.flipMates.includes(m.type);
  // Any mate can now be re-opened in the full editor.
  mateEditable = (_m: Mate) => true;
  /** Scoped face id (`instanceId::faceId`) for a mate ref — what the viewer
   * highlight + surfaceKindOf expect. */
  private scopedRef = (r: { instanceId: string; faceId: string }) =>
    r.instanceId ? `${r.instanceId}::${r.faceId}` : r.faceId;
  startEditMate(m: Mate) {
    this.editingMate.set(m);
    this.faceA.set(this.scopedRef(m.a));
    this.faceB.set(this.scopedRef(m.b));
    this.selectedMateType.set(m.type);
    const v = m.value ?? 0;
    this.mateValue.set(m.type === 'angle' ? (v * 180) / Math.PI : v);
    this.mateFlip.set(!!m.flip);
    this.matePickStage.set(null);
    this.mateRepick.set(null);
    this.showMateChooser.set(true);  // jump straight to the type/value/flip panel
  }
  // Mate property-panel state (select a type, then OK — matching the feature
  // sidebars). `mateActive` drives the secondary-sidebar visibility for the
  // whole mate operation (face-picking through type selection).
  selectedMateType = signal<MateType | null>(null);
  mateActive = computed(() => this.facePickActive() || this.showMateChooser());
  needsMateValue = computed(() => { const t = this.selectedMateType(); return !!t && this.valueMates.includes(t); });
  needsMateFlip = computed(() => { const t = this.selectedMateType(); return !!t && this.flipMates.includes(t); });
  canCreateMate = computed(() => this.showMateChooser() && this.selectedMateType() !== null);
  matePrompt = computed(() => {
    if (this.matePickStage() === 'a') return 'Select the first face.';
    if (this.matePickStage() === 'b') return 'Select a face on another component.';
    if (this.showMateChooser()) return 'Choose how the two faces relate, then click OK.';
    return '';
  });
  selectMateType(t: MateType) { this.selectedMateType.set(t); }
  confirmMate() { const t = this.selectedMateType(); if (t) this.createMate(t); }

  filteredParts = computed(() => {
    const q = this.partSearch().trim().toLowerCase();
    const list = this.partsWithCad();
    if (!q) return list;
    return list.filter((p) => `${p.part?.name || ''} ${p.part?.revision || ''}`.toLowerCase().includes(q));
  });

  // Compose the viewer geometry from the regenerate result, omitting hidden
  // instances and adding the assembly + per-component datums.
  geometry = computed<ModelGeometry>(() => {
    const r = this.regen();
    if (!r) return EMPTY_GEOMETRY;
    const hidden = new Set(this.instances().filter((i) => i.visible === false).map((i) => i.instanceId));
    // REQ 764 — explode displacement per instance (render-only). Pattern
    // copies (id `seed#patternN`) inherit their seed's offset.
    const exOffsets = this.explodeEnabled() ? this.explodeOffsets() : null;
    const exFactor = this.explodeFactor();
    const offsetFor = (instanceId: string): [number, number, number] | null => {
      if (!exOffsets || exFactor <= 0) return null;
      const o = exOffsets[instanceId] ?? exOffsets[String(instanceId).split('#')[0]];
      if (!o) return null;
      return [o[0] * exFactor, o[1] * exFactor, o[2] * exFactor];
    };
    const faces: FaceMesh[] = [];
    const vertices: ModelTopology['vertices'] = [];
    const edges: ModelTopology['edges'] = [];
    let vi = 0, ei = 0;
    const hiddenBodies = this.hiddenComponentBodies();
    for (const body of r.bodies) {
      if (hidden.has(body.instanceId)) continue;
      if (hiddenBodies.has(body.id)) continue;
      const off = offsetFor(body.instanceId);
      const pt = (p: [number, number, number]): [number, number, number] =>
        off ? [p[0] + off[0], p[1] + off[1], p[2] + off[2]] : p;
      for (const f of body.faces) {
        const positions = new Float32Array(f.positions);
        if (off) {
          for (let i = 0; i < positions.length; i += 3) {
            positions[i] += off[0]; positions[i + 1] += off[1]; positions[i + 2] += off[2];
          }
        }
        faces.push({
          faceId: f.faceId || f.persistentName,
          positions,
          normals: new Float32Array(f.normals),
          indices: new Uint32Array(f.indices),
          featureId: body.instanceId,
          isFlat: f.surface?.kind === 'plane',
        });
      }
      for (const v of body.vertices) vertices.push({ id: `v${vi++}`, position: pt([v[0], v[1], v[2]]) });
      for (const e of body.edges) {
        const poly = (e.polyline as Array<[number, number, number]>)?.map(pt);
        if (!poly || poly.length < 2) continue;
        edges.push({ id: `e${ei++}`, isStraight: poly.length === 2, endpoints: [poly[0], poly[poly.length - 1]], polyline: poly.length > 2 ? poly : undefined });
      }
    }
    return { datums: this.assemblyDatums(), faces, topology: { vertices, edges } };
  });

  /** Load the assembly for a part (called by the CAD editor in assembly mode). */
  load(id: number) {
    this.partID.set(id);
    this.loading.set(true);
    this.cadApi.listPartsWithCad().subscribe({ next: (r) => this.partsWithCad.set(r), error: () => {} });
    this.cadApi.getActiveByPart(id).subscribe({
      next: (m) => { this.assembly.set(m.isAssembly ? (m as Assembly) : null); this.loading.set(false); this.regenerate(); },
      error: (e) => {
        this.loading.set(false);
        if (e?.status !== 404) this.errors.showError(e?.error?.error || 'Failed to load assembly');
      },
    });
  }

  partName(partID: number): string {
    const p = this.partsWithCad().find((x) => x.partID === partID);
    if (!p?.part) return `Part ${partID}`;
    // Use the VCS display revision (matches the editor badge), falling back to
    // the raw Parts.revision. Canonical part number = name-revision.
    const rev = p.displayRevision ?? p.part.revision;
    return formatPartNumber(p.part.name, rev, (p.revisionCount ?? 0) > 1) || p.part.name;
  }

  createAssembly() {
    this.assemblyApi.createForPart(this.partID()).subscribe({
      next: (a) => { this.assembly.set(a); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to create assembly'),
    });
  }

  /** Fetch a composed regen for an arbitrary assembly id — used by the part
   * editor to build the in-context ghost overlay (CAD-790). */
  regenerateById(id: number) { return this.assemblyApi.regenerate(id); }

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

  // Whether a newly inserted component is mated to (grounded at) the assembly
  // origin. Defaults on for the first component, off thereafter.
  insertOriginMate = signal(true);
  // REQ 788 — branch tracking for the insert flow. Picking a part loads its
  // branches; the new instance tracks the chosen one (default main).
  pendingInsertPart = signal<PartWithCadSummary | null>(null);
  insertBranches = signal<string[]>([]);
  insertBranch = signal('main');
  togglePicker() {
    this.replaceTargetId.set(null);
    const opening = !this.showPicker();
    if (opening) {
      this.insertOriginMate.set(this.instances().length === 0);
      this.pendingInsertPart.set(null);
      this.insertBranches.set([]);
      this.insertBranch.set('main');
    }
    this.showPicker.set(opening);
  }
  startReplace(inst: AssemblyInstance) { this.replaceTargetId.set(inst.instanceId); this.showPicker.set(true); this.pendingInsertPart.set(null); }
  /** Select a part in the picker; replace mode commits immediately (branch
   * tracking is an insert concern), insert mode loads branches for the picker. */
  selectInsertPart(p: PartWithCadSummary) {
    if (this.replaceTargetId()) { this.insert(p.partID); return; }
    this.pendingInsertPart.set(p);
    this.insertBranch.set('main');
    this.insertBranches.set(['main']);
    if (p.latestRevisionID != null) {
      this.cadApi.listBranches(p.latestRevisionID).subscribe({
        next: (bs) => {
          const names = bs.map((b) => b.name);
          if (!names.includes('main')) names.unshift('main');
          this.insertBranches.set(names);
        },
        error: () => {},
      });
    }
  }
  confirmInsert() {
    const p = this.pendingInsertPart();
    if (p) this.insert(p.partID, this.insertBranch() || 'main');
  }

  insert(partID: number, branch?: string) {
    const a = this.assembly();
    if (!a) return;
    const replacing = this.replaceTargetId();
    const obs = replacing
      ? this.assemblyApi.replaceInstance(a.id, replacing, partID)
      : this.assemblyApi.insertInstance(a.id, { partID, originMate: this.insertOriginMate(), branch: branch || 'main' });
    obs.subscribe({
      next: (res: { assembly: Assembly }) => { this.assembly.set(res.assembly); this.showPicker.set(false); this.replaceTargetId.set(null); this.pendingInsertPart.set(null); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || (replacing ? 'Failed to replace component' : 'Failed to insert component')),
    });
  }

  // REQ 788 — change which branch an existing instance tracks.
  trackBranchInst = signal<AssemblyInstance | null>(null);
  trackBranches = signal<string[]>([]);
  openTrackBranch(inst: AssemblyInstance) {
    this.trackBranchInst.set(inst);
    this.trackBranches.set(['main']);
    const p = this.partsWithCad().find((x) => x.partID === inst.partID);
    if (p?.latestRevisionID != null) {
      this.cadApi.listBranches(p.latestRevisionID).subscribe({
        next: (bs) => {
          const names = bs.map((b) => b.name);
          if (!names.includes('main')) names.unshift('main');
          this.trackBranches.set(names);
        },
        error: () => {},
      });
    }
  }
  cancelTrackBranch() { this.trackBranchInst.set(null); }
  setTrackedBranch(branch: string) {
    const a = this.assembly();
    const inst = this.trackBranchInst();
    if (!a || !inst) return;
    this.assemblyApi.updateInstance(a.id, inst.instanceId, { branch }).subscribe({
      next: (res) => { this.assembly.set(res.assembly); this.trackBranchInst.set(null); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to change tracked branch'),
    });
  }

  // Configurations — pin which child-part configuration an instance resolves
  // at (REQ: configurations). Mirrors the Track-branch flow: context menu →
  // small sidebar listing the child's configurations → updateInstance.
  configInst = signal<AssemblyInstance | null>(null);
  configOptions = signal<Array<{ id: string; name: string }>>([]);
  openInstanceConfig(inst: AssemblyInstance) {
    this.configInst.set(inst);
    this.configOptions.set([]);
    this.cadApi.getActiveByPart(inst.partID).subscribe({
      next: (m) => this.configOptions.set(
        (m.featureTree?.configurations ?? []).map((c) => ({ id: c.id, name: c.name })),
      ),
      error: () => {},
    });
  }
  cancelInstanceConfig() { this.configInst.set(null); }
  /** Empty id = clear the pin (the child's own active configuration). */
  setInstanceConfiguration(configurationId: string) {
    const a = this.assembly();
    const inst = this.configInst();
    if (!a || !inst) return;
    this.assemblyApi.updateInstance(a.id, inst.instanceId, { configurationId: configurationId || null }).subscribe({
      next: (res) => { this.assembly.set(res.assembly); this.configInst.set(null); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to change configuration'),
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
      next: (asm) => {
        this.assembly.set(asm);
        if (this.selectedId() === inst.instanceId) this.selectedId.set(null);
        const next = new Set(this.selectedIds()); next.delete(inst.instanceId); this.selectedIds.set(next);
        this.regenerate();
      },
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

  /** Suppress/unsuppress a component: a suppressed instance is skipped by
   * regen entirely (no geometry, no mates) — stronger than hiding. */
  toggleSuppressed(inst: AssemblyInstance) {
    const a = this.assembly();
    if (!a) return;
    const suppressed = !inst.suppressed;
    this.assemblyApi.updateInstance(a.id, inst.instanceId, { suppressed }).subscribe({
      next: (res) => { this.assembly.set(res.assembly); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to toggle suppression'),
    });
  }

  /** Whether the component is fixed to the assembly origin via a real origin mate. */
  isOriginMated = (inst: AssemblyInstance) =>
    this.mates().some((m) => m.type === 'origin' && m.a?.instanceId === inst.instanceId);
  /** Create an origin mate fixing the component to the assembly origin. */
  fixToOrigin(inst: AssemblyInstance) {
    const a = this.assembly();
    if (!a || this.isOriginMated(inst)) return;
    this.assemblyApi.addMate(a.id, { type: 'origin', a: { instanceId: inst.instanceId, faceId: '' }, b: { instanceId: '', faceId: '' } }).subscribe({
      next: (res) => { this.assembly.set(res.assembly); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to mate to origin'),
    });
  }
  /** Remove the component's origin mate (frees it for dragging / mating). */
  freeFromOrigin(inst: AssemblyInstance) {
    const m = this.mates().find((x) => x.type === 'origin' && x.a?.instanceId === inst.instanceId);
    if (m) this.removeMate(m);
  }

  select(instanceId: string) {
    this.selectedId.set(instanceId);
    this.selectedIds.set(new Set([instanceId]));
  }

  /** Tree-click selection with modifiers: ctrl toggles, shift range-selects
   * every instance between the anchor and this one (in tree order), plain
   * selects just this one. Mirrors the part feature tree. */
  selectInstance(instanceId: string, shift: boolean, ctrl: boolean) {
    if (ctrl) {
      const next = new Set(this.selectedIds());
      next.has(instanceId) ? next.delete(instanceId) : next.add(instanceId);
      this.selectedIds.set(next);
      this.selectedId.set(instanceId);
    } else if (shift && this.selectedId()) {
      const order = this.instances().map((i) => i.instanceId);
      const i = order.indexOf(this.selectedId()!);
      const j = order.indexOf(instanceId);
      if (i >= 0 && j >= 0) {
        const [lo, hi] = i <= j ? [i, j] : [j, i];
        this.selectedIds.set(new Set(order.slice(lo, hi + 1)));
      } else {
        this.select(instanceId);
      }
    } else {
      this.select(instanceId);
    }
  }

  clearSelection() {
    this.selectedId.set(null);
    this.selectedIds.set(new Set());
  }

  /** Del-key deletion of every selected instance, after a confirm. */
  deleteSelected() {
    const a = this.assembly();
    const ids = [...this.selectedIds()];
    if (!a || ids.length === 0) return;
    const names = ids.map((id) => this.partName(this.instances().find((x) => x.instanceId === id)?.partID ?? -1));
    const msg = ids.length === 1
      ? `Delete component "${names[0]}"?`
      : `Delete ${ids.length} components?\n\n${names.join(', ')}`;
    if (!window.confirm(msg)) return;
    // Remove sequentially; the final regen + assembly state come from the last.
    const removeNext = (rest: string[]) => {
      if (rest.length === 0) { this.clearSelection(); this.regenerate(); return; }
      const [id, ...tail] = rest;
      this.assemblyApi.removeInstance(a.id, id).subscribe({
        next: (asm) => { this.assembly.set(asm); removeNext(tail); },
        error: (e) => { this.errors.showError(e?.error?.error || 'Failed to remove component'); this.clearSelection(); this.regenerate(); },
      });
    };
    removeNext(ids);
  }

  /** CAD-783: commit an interactive viewer drag. Applies the world-space
   * translation delta to the component's prior placement (orientation
   * unchanged), persists it, then regenerates so the mate solver reconciles
   * the moved component against its mates. */
  dragMoveInstance(instanceId: string, delta: [number, number, number]) {
    const a = this.assembly();
    const inst = this.instances().find((i) => i.instanceId === instanceId);
    if (!a || !inst || !canDragInstance(inst)) return;
    const placement = translatedPlacement(inst.placement, delta);
    this.assemblyApi.updateInstance(a.id, instanceId, { placement }).subscribe({
      next: (res) => {
        this.assembly.set(res.assembly);
        // Keep the inspector fields in sync if the dragged part is selected.
        if (this.selectedId() === instanceId) this.select(instanceId);
        this.regenerate();
      },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to move component'),
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
  startMate() { this.editingMate.set(null); this.faceA.set(null); this.faceB.set(null); this.showMateChooser.set(false); this.selectedMateType.set(null); this.mateValue.set(0); this.mateFlip.set(false); this.mateRepick.set(null); this.matePickStage.set('a'); }
  cancelMate() { this.matePickStage.set(null); this.faceA.set(null); this.faceB.set(null); this.showMateChooser.set(false); this.selectedMateType.set(null); this.mateFlip.set(false); this.mateRepick.set(null); this.editingMate.set(null); }
  /** Re-arm picking for a single slot (editing / correcting one surface). */
  repickFace(slot: 'a' | 'b') { this.mateRepick.set(slot); this.matePickStage.set(slot); }
  /** @returns true if the pick was consumed by the mate flow. */
  onFacePicked(faceId: string): boolean {
    const stage = this.matePickStage();
    if (stage === null) return false;
    // Re-picking ONE slot (edit / correction): replace that face, validate it's
    // on a different component than the OTHER slot, and return to the chooser.
    const repick = this.mateRepick();
    if (repick) {
      const other = repick === 'a' ? this.faceB() : this.faceA();
      if (other && splitScoped(faceId).instanceId === splitScoped(other).instanceId) {
        this.errors.showError('Pick a face on a different component.'); return true;
      }
      (repick === 'a' ? this.faceA : this.faceB).set(faceId);
      this.mateRepick.set(null); this.matePickStage.set(null); this.showMateChooser.set(true); return true;
    }
    if (stage === 'a') {
      this.faceA.set(faceId); this.matePickStage.set('b'); return true;
    }
    // stage === 'b'
    if (splitScoped(faceId).instanceId === splitScoped(this.faceA()!).instanceId) {
      this.errors.showError('Pick a face on a different component.'); return true;
    }
    this.faceB.set(faceId); this.matePickStage.set(null); this.mateValue.set(0); this.showMateChooser.set(true); return true;
  }
  createMate(type: MateType) {
    const a = this.assembly();
    const fa = this.faceA(); const fb = this.faceB();
    if (!a || !fa || !fb) return;
    const refA = splitScoped(fa); const refB = splitScoped(fb);
    const body: { type: MateType; a: typeof refA; b: typeof refB; value?: number; flip?: boolean } = { type, a: refA, b: refB };
    if (this.valueMates.includes(type)) body.value = type === 'angle' ? (this.mateValue() * Math.PI) / 180 : this.mateValue();
    if (this.flipMates.includes(type)) body.flip = this.mateFlip();
    const em = this.editingMate();
    const done = (asm: Assembly) => { this.assembly.set(asm); this.cancelMate(); this.regenerate(); };
    if (em) {
      // UPDATE the existing mate in place (type/surfaces/value/flip all editable).
      this.assemblyApi.updateMate(a.id, em.mateId, body).subscribe({
        next: done,
        error: (e) => this.errors.showError(e?.error?.error || 'Failed to update mate'),
      });
    } else {
      this.assemblyApi.addMate(a.id, body).subscribe({
        next: (res) => done(res.assembly),
        error: (e) => this.errors.showError(e?.error?.error || 'Failed to create mate'),
      });
    }
  }
  removeMate(mate: Mate) {
    const a = this.assembly();
    if (!a) return;
    this.assemblyApi.removeMate(a.id, mate.mateId).subscribe({
      next: (asm) => { this.assembly.set(asm); this.regenerate(); },
      error: (e) => this.errors.showError(e?.error?.error || 'Failed to remove mate'),
    });
  }
  private mkNode(o: Partial<TreeNode>): TreeNode {
    return {
      key: '', kind: 'feature', label: '', iconName: '', iconClass: '', depth: 0,
      expandable: false, expanded: false, selectable: false, ...o,
    };
  }

  /** Assembly section of the tree — origin + components + patterns + display
   * states — rendered through the shared feature-tree panel (external nodes).
   * Keys encode kind + id so the editor's event handler can dispatch. */
  treeNodes = computed<TreeNode[]>(() => {
    const node = this.mkNode.bind(this);
    const out: TreeNode[] = [];
    out.push(node({
      key: 'origin', kind: 'feature', label: 'Origin', iconName: 'trip_origin', iconClass: 'origin', depth: 0,
      expandable: true, expanded: this.originExpanded(), visibilityToggleable: true, visible: this.originAnyVisible(),
    }));
    if (this.originExpanded()) {
      for (const d of this.originDatums) {
        out.push(node({ key: `origin-datum:${d.id}`, kind: 'datum', label: d.label, iconName: d.icon, iconClass: d.iconClass, depth: 1, visibilityToggleable: true, visible: this.originDatumVisible(d.id) }));
      }
    }
    const sel = this.selectedIds();
    for (const inst of this.instances()) {
      const exp = this.componentExpanded(inst.instanceId);
      const branch = inst.ref?.branch;
      out.push(node({
        key: `component:${inst.instanceId}`, kind: 'feature',
        label: this.partName(inst.partID) + (branch && branch !== 'main' ? ` · ${branch}` : ''),
        iconName: 'memory', iconClass: 'part', depth: 0,
        expandable: true, expanded: exp, selectable: true, selected: sel.has(inst.instanceId),
        visibilityToggleable: true, visible: inst.visible !== false,
        suppressed: !!inst.suppressed,
      }));
      if (exp) {
        // "Origin" group nests the seven datums, mirroring a part's own tree.
        const originExp = this.componentOriginExpanded(inst.instanceId);
        const anyDatumVisible = this.originDatums.some((d) => this.componentDatumVisible(inst.instanceId, d.id));
        out.push(node({
          key: `component-origin:${inst.instanceId}`, kind: 'feature', label: 'Origin',
          iconName: 'trip_origin', iconClass: 'origin', depth: 1,
          expandable: true, expanded: originExp,
          visibilityToggleable: true, visible: anyDatumVisible,
        }));
        if (originExp) {
          for (const d of this.originDatums) {
            out.push(node({ key: `component-datum:${inst.instanceId}:${d.id}`, kind: 'datum', label: d.label, iconName: d.icon, iconClass: d.iconClass, depth: 2, visibilityToggleable: true, visible: this.componentDatumVisible(inst.instanceId, d.id) }));
          }
        }
        // The component's solid bodies — eye toggles render visibility
        // (scoped body ids from the composed regen).
        const bodies = (this.regen()?.bodies ?? []).filter((b) => b.instanceId === inst.instanceId);
        bodies.forEach((b, bi) => {
          out.push(node({
            key: `component-body:${inst.instanceId}:${b.id}`, kind: 'datum',
            label: b.name || `Body ${bi + 1}`, iconName: 'view_in_ar', iconClass: 'part', depth: 1,
            visibilityToggleable: true, visible: !this.hiddenComponentBodies().has(b.id),
          }));
        });
      }
    }
    for (const p of this.patterns()) {
      out.push(node({ key: `pattern:${p.patternId}`, kind: 'feature', label: `${p.kind} · ${this.patternSeedName(p)}`, iconName: 'grid_view', iconClass: 'mate', depth: 0 }));
    }
    for (const s of this.displayStates()) {
      out.push(node({ key: `displaystate:${s.id}`, kind: 'feature', label: s.name, iconName: 'bookmark', iconClass: 'mate', depth: 0, selectable: true }));
    }
    return out;
  });

  /** Mates section of the tree — a separate feature-tree panel. */
  mateNodes = computed<TreeNode[]>(() =>
    this.mates().map((m) => this.mkNode({ key: `mate:${m.mateId}`, kind: 'feature', label: this.mateLabel(m), iconName: 'link', iconClass: 'mate', depth: 0 })),
  );

  mateLabel(m: Mate): string {
    if (m.type === 'origin') {
      return `origin: ${this.partName(this.instanceOf(m.a.instanceId)?.partID ?? 0)} → Assembly origin`;
    }
    return `${m.type}: ${this.partName(this.instanceOf(m.a.instanceId)?.partID ?? 0)} ↔ ${this.partName(this.instanceOf(m.b.instanceId)?.partID ?? 0)}`;
  }
  private instanceOf(instanceId: string) { return this.instances().find((i) => i.instanceId === instanceId); }
  patternSeedName(p: AssemblyPattern): string { return this.partName(this.instanceOf(p.seedInstanceId)?.partID ?? 0); }

  // ── visualization ───────────────────────────────────────────────────────────
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
