import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InventoryService } from '../../../services/inventory.service';
import { CadModelService } from '../../../services/cad-model.service';
import { AssemblyService } from '../../../services/assembly.service';
import { PartCategory } from '../../../models/part-category.model';
import {
  Quat, IDENTITY_QUAT, rotateAboutAssemblyAxis, alignZToNormal, axisMappingLabel, originMateFrame,
} from '../../../cad/lib/insertOrientation';
import { ASSEMBLY_REF_ID } from '../../../cad/lib/assembly.types';
import type { ClipboardBundle } from '../../../cad/lib/clipboard';

export interface CadNewPartDialogData {
  mode: 'part' | 'assembly';
  /** REQ 1013 — paste a copied part: prefill its description and save
   * its sketches/features/equations as the new model's first content. */
  seed?: ClipboardBundle;
  /** REQ 920 — create the part AS A CHILD of this assembly: after the CAD
   * model is minted, insert an instance placed at `origin` (assembly world
   * frame) and open the part IN CONTEXT instead of standalone. */
  insertInto?: {
    assemblyId: number;
    assemblyPartId: number;
    origin: [number, number, number];
    /** Component the origin point was picked on — the new instance is mated
     * to it. Null (assembly datum / skeleton pick) → mated to the assembly. */
    anchorInstanceId?: string | null;
    /** REQ 1003 — the pick was an ORIGIN point: mate origin-to-origin with an
     * axis frame instead of a lock. */
    originDatum?: boolean;
    /** Orientation of the anchor component (identity for the assembly). */
    anchorQuat?: Quat | null;
    /** REQ 1006 — the anchor's origin ref when it isn't the owner's own
     * origin (a reference point coordinate system, `csys:<pt>:origin`). The
     * new part starts aligned with that coordinate system. */
    anchorFaceId?: string;
    /** Assembly-frame normal of the face the origin was picked on, when any.
     * Enables the "Align to face" orientation shortcut (REQ 933). */
    orientNormal?: [number, number, number] | null;
  };
}

/**
 * Reduced new-part dialog launched from the CAD landing's New Part / New
 * assembly buttons. Defaults the part number to the next available, defaults to
 * an internal part, and pre-selects the Part or Assembly category for the mode.
 * On create it mints the part, attaches the matching design (CAD model or
 * assembly), and routes straight into the editor.
 */
@Component({
  selector: 'cad-new-part-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatCheckboxModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.seed ? 'Paste part' : data.mode === 'assembly' ? 'New assembly' : 'New CAD part' }}</h2>
    <mat-dialog-content class="npd">
      <mat-form-field appearance="outline" class="full">
        <mat-label>Part number</mat-label>
        <input matInput [ngModel]="name()" (ngModelChange)="name.set($event)" maxlength="32" data-testid="npd-name" />
      </mat-form-field>

      <mat-form-field appearance="outline" class="full">
        <mat-label>Description (optional)</mat-label>
        <input matInput [ngModel]="description()" (ngModelChange)="description.set($event)" maxlength="62" />
      </mat-form-field>

      <mat-form-field appearance="outline" class="full">
        <mat-label>Category</mat-label>
        <mat-select [ngModel]="categoryId()" (ngModelChange)="categoryId.set($event)" data-testid="npd-category">
          @for (c of pickableCategories(); track c.id) { <mat-option [value]="c.id">{{ c.name }}</mat-option> }
        </mat-select>
      </mat-form-field>

      <mat-checkbox [ngModel]="internalPart()" (ngModelChange)="internalPart.set($event)" data-testid="npd-internal">Internal part</mat-checkbox>

      @if (data.insertInto) {
        <div class="npd-orient" data-testid="npd-orient">
          <div class="npd-orient-head">Orientation (relative to assembly axes)</div>
          <div class="npd-orient-btns">
            <button mat-stroked-button type="button" (click)="rot('x')" data-testid="npd-rot-x">Rotate X 90°</button>
            <button mat-stroked-button type="button" (click)="rot('y')" data-testid="npd-rot-y">Rotate Y 90°</button>
            <button mat-stroked-button type="button" (click)="rot('z')" data-testid="npd-rot-z">Rotate Z 90°</button>
            @if (data.insertInto.orientNormal) {
              <button mat-stroked-button type="button" (click)="alignFace()" data-testid="npd-align-face">Align Z to face</button>
            }
            <button mat-button type="button" (click)="resetOrient()" data-testid="npd-orient-reset">Reset</button>
          </div>
          <div class="npd-orient-map" data-testid="npd-orient-map">{{ orientLabel() }}</div>
        </div>
      }

      @if (error()) { <p class="npd-err">{{ error() }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()" [disabled]="busy()">Cancel</button>
      <button mat-flat-button color="primary" (click)="create()" [disabled]="busy() || !name().trim() || !categoryId()" data-testid="npd-create">
        @if (busy()) { <mat-spinner diameter="16"></mat-spinner> } @else { Create &amp; open }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .npd { display: flex; flex-direction: column; gap: 4px; min-width: 340px; padding-top: 8px; }
    .npd .full { width: 100%; }
    .npd-err { color: #e57373; font-size: 12px; margin: 4px 0 0; }
    mat-dialog-actions button mat-spinner { display: inline-block; }
    .npd-orient { border: 1px solid rgba(0,0,0,0.12); border-radius: 6px; padding: 8px; margin-top: 4px; }
    .npd-orient-head { font-size: 12px; font-weight: 600; opacity: 0.75; margin-bottom: 6px; }
    .npd-orient-btns { display: flex; flex-wrap: wrap; gap: 6px; }
    .npd-orient-btns button { min-width: 0; line-height: 28px; }
    .npd-orient-map { font-size: 12px; font-family: monospace; opacity: 0.8; margin-top: 8px; }
  `],
})
export class CadNewPartDialogComponent {
  private inv = inject(InventoryService);
  private cadApi = inject(CadModelService);
  private asmApi = inject(AssemblyService);
  private router = inject(Router);
  private ref = inject(MatDialogRef<CadNewPartDialogComponent>);
  data = inject<CadNewPartDialogData>(MAT_DIALOG_DATA);

  name = signal('');
  description = signal('');
  internalPart = signal(true);
  categories = signal<PartCategory[]>([]);
  categoryId = signal<number | null>(null);
  busy = signal(false);
  error = signal('');

  // REQ 933 — orientation of the new instance relative to the assembly axes.
  orientQuat = signal<Quat>(this.data.insertInto?.anchorFaceId ? (this.data.insertInto.anchorQuat ?? IDENTITY_QUAT) : IDENTITY_QUAT);
  orientLabel = computed(() => axisMappingLabel(this.orientQuat()));
  rot(axis: 'x' | 'y' | 'z') { this.orientQuat.set(rotateAboutAssemblyAxis(this.orientQuat(), axis, 90)); }
  alignFace() { const n = this.data.insertInto?.orientNormal; if (n) this.orientQuat.set(alignZToNormal(n)); }
  resetOrient() { this.orientQuat.set(IDENTITY_QUAT); }

  /** Only the two relevant categories are offered; child-of-assembly mode
   * (REQ 920) creates plain parts only. */
  pickableCategories = computed(() =>
    this.categories().filter((c) => this.data.insertInto || this.data.seed
      ? c.name === 'Part'
      : (c.name === 'Part' || c.name === 'Assembly')));
  private isAssembly = computed(() =>
    this.categories().find((c) => c.id === this.categoryId())?.name === 'Assembly');

  constructor() {
    // A pasted part gets this environment's next part number (below), not the
    // source's — only the description carries over.
    const seed = this.data.seed?.source;
    if (seed) this.description.set(seed.description ?? '');
    this.inv.getPartCategories().subscribe((cs) => {
      this.categories.set(cs);
      const want = this.data.mode === 'assembly' ? 'Assembly' : 'Part';
      const cat = cs.find((c) => c.name === want) ?? cs.find((c) => c.name === 'Part') ?? cs[0];
      if (cat) this.categoryId.set(cat.id);
    });
    // Next part number = max existing part id + 1, zero-padded (matches the
    // suggestion the full part form uses).
    this.inv.getAllParts().subscribe((parts) => {
      const maxId = parts.length ? Math.max(...parts.map((p) => p.id)) : 0;
      if (!this.name()) this.name.set(String(maxId + 1).padStart(6, '0'));
    });
  }

  create() {
    const cid = this.categoryId();
    const nm = this.name().trim();
    if (!nm || !cid) return;
    this.busy.set(true);
    this.error.set('');
    const payload = {
      name: nm,
      description: this.description().trim() || null,
      internalPart: this.internalPart(),
      vendor: '',
      minimumOrderQuantity: 1,
      partCategoryID: cid,
      serialNumberRequired: false,
      lotNumberRequired: false,
      activeFlag: true,
    };
    const assembly = this.isAssembly();
    this.inv.createPart(payload).subscribe({
      next: (part: any) => {
        const after = assembly ? this.asmApi.createForPart(part.id) : this.cadApi.createForPart(part.id);
        after.subscribe({
          next: (m: any) => {
            // Auto-check-out so the freshly created design opens editable.
            // Checkout is the unified cad-model endpoint (works for assemblies);
            // a failure shouldn't block opening — navigate regardless.
            this.cadApi.checkout(m.id).subscribe({
              next: (co) => this.seed(m.id, co.lastContentSavedAt ?? null, () => this.finish(assembly, part.id, m.id)),
              error: (e) => {
                // A pasted design can only be written to a checked-out model.
                if (!this.data.seed) { this.finish(assembly, part.id, m.id); return; }
                this.busy.set(false);
                this.error.set(`Part ${nm} was created, but checking it out failed, so the copied design was not added: ${this.msg(e, 'checkout error')}`);
              },
            });
          },
          error: (e) => { this.busy.set(false); this.error.set(this.msg(e, 'Failed to attach a design to the new part')); },
        });
      },
      error: (e) => { this.busy.set(false); this.error.set(this.msg(e, 'Failed to create part')); },
    });
  }

  /** REQ 1013 — write the pasted model into the fresh (checked-out) model;
   * the editor regenerates it on open. */
  private seed(modelId: number, token: string | null, done: () => void) {
    const m = this.data.seed?.model;
    if (!m) { done(); return; }
    this.cadApi.update(modelId, {
      featureTree: m.featureTree, sketchDoc: m.sketchDoc,
      ...(m.equations ? { equations: m.equations } : {}),
      clientSavedAt: token,
    }).subscribe({
      next: done,
      error: (e) => {
        this.busy.set(false);
        this.error.set(`Part ${this.name().trim()} was created, but copying the design into it failed: ${this.msg(e, 'save error')}`);
      },
    });
  }

  private finish(assembly: boolean, partId: number, modelId: number) {
    // REQ 920 — child-of-assembly mode: insert an instance placed at the
    // picked origin, then open the new part IN CONTEXT of that assembly.
    const into = this.data.insertInto;
    if (into && !assembly) {
      this.asmApi.insertInstance(into.assemblyId, {
        partID: partId,
        placement: { translate: into.origin, quaternion: this.orientQuat() },
        // Held by a mate below, never grounded (REQ 1003).
        grounded: false,
      }).subscribe({
        next: (r) => {
          const go = () => {
            this.ref.close(true);
            this.router.navigate(['/parts', partId, 'cad', 'editor'], {
              queryParams: {
                revisionID: modelId,
                inContext: into.assemblyId,
                hostInstance: r.instance.instanceId,
                asmPart: into.assemblyPartId,
              },
            });
          };
          // REQ 920/1003 — the picked origin is a MATE to the component it
          // was picked on (or the assembly): origin points mate origin-to-
          // origin with the chosen axes; anything else (or a non-axis-aligned
          // orientation) locks the current relative transform. A mate failure
          // shouldn't orphan the flow — open in context regardless.
          const anchor = into.anchorInstanceId || ASSEMBLY_REF_ID;
          const child = r.instance.instanceId;
          const frame = into.originDatum ? originMateFrame(into.anchorQuat ?? IDENTITY_QUAT, this.orientQuat()) : null;
          this.asmApi.addMate(into.assemblyId, frame
            ? { type: 'coincident', a: { instanceId: anchor, faceId: into.anchorFaceId ?? 'origin' }, b: { instanceId: child, faceId: 'origin' }, frame }
            : { type: 'lock', a: { instanceId: child, faceId: '' }, b: { instanceId: anchor, faceId: '' } },
          ).subscribe({ next: go, error: go });
        },
        error: (e) => { this.busy.set(false); this.error.set(this.msg(e, 'Part created, but inserting it into the assembly failed')); },
      });
      return;
    }
    this.openEditor(assembly, partId, modelId);
  }

  private openEditor(assembly: boolean, partId: number, modelId: number) {
    this.ref.close(true);
    if (assembly) this.router.navigate(['/parts', partId, 'assembly', 'editor']);
    else this.router.navigate(['/parts', partId, 'cad', 'editor'], { queryParams: { revisionID: modelId } });
  }

  cancel() { this.ref.close(false); }

  /** The global error handler answers `{ errorMessage }`; CAD controllers `{ error }`. */
  private msg(e: any, fallback: string): string {
    return e?.error?.errorMessage || e?.error?.error || fallback;
  }
}

