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

export interface CadNewPartDialogData {
  mode: 'part' | 'assembly';
  /** REQ 920 — create the part AS A CHILD of this assembly: after the CAD
   * model is minted, insert an instance placed at `origin` (assembly world
   * frame) and open the part IN CONTEXT instead of standalone. */
  insertInto?: {
    assemblyId: number;
    assemblyPartId: number;
    origin: [number, number, number];
    /** Component the origin point was picked on — the new instance gets a
     * LOCK mate to it so it stays anchored. Null (datum/origin pick) →
     * the instance is grounded in the assembly frame instead. */
    anchorInstanceId?: string | null;
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
    <h2 mat-dialog-title>{{ data.mode === 'assembly' ? 'New assembly' : 'New CAD part' }}</h2>
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

  /** Only the two relevant categories are offered; child-of-assembly mode
   * (REQ 920) creates plain parts only. */
  pickableCategories = computed(() =>
    this.categories().filter((c) => this.data.insertInto
      ? c.name === 'Part'
      : (c.name === 'Part' || c.name === 'Assembly')));
  private isAssembly = computed(() =>
    this.categories().find((c) => c.id === this.categoryId())?.name === 'Assembly');

  constructor() {
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
              next: () => this.finish(assembly, part.id, m.id),
              error: () => this.finish(assembly, part.id, m.id),
            });
          },
          error: (e) => { this.busy.set(false); this.error.set(e?.error?.error || 'Failed to attach a design to the new part'); },
        });
      },
      error: (e) => { this.busy.set(false); this.error.set(e?.error?.error || 'Failed to create part'); },
    });
  }

  private finish(assembly: boolean, partId: number, modelId: number) {
    // REQ 920 — child-of-assembly mode: insert an instance placed at the
    // picked origin, then open the new part IN CONTEXT of that assembly.
    const into = this.data.insertInto;
    if (into && !assembly) {
      this.asmApi.insertInstance(into.assemblyId, {
        partID: partId,
        placement: { translate: into.origin, quaternion: [0, 0, 0, 1] },
        // Datum-picked origins anchor to the assembly frame directly.
        ...(into.anchorInstanceId ? {} : { grounded: true }),
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
          // REQ 920 — the picked origin is a MATE: lock the new instance to
          // the component it was picked on (freezes the current relative
          // transform, so the new part follows that component). A mate
          // failure shouldn't orphan the flow — open in context regardless.
          if (into.anchorInstanceId) {
            this.asmApi.addMate(into.assemblyId, {
              type: 'lock',
              a: { instanceId: r.instance.instanceId, faceId: '' },
              b: { instanceId: into.anchorInstanceId, faceId: '' },
            }).subscribe({ next: go, error: go });
          } else {
            go();
          }
        },
        error: (e) => { this.busy.set(false); this.error.set(e?.error?.error || 'Part created, but inserting it into the assembly failed'); },
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
}

