import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CadNewPartDialogComponent } from '../cad-new-part-dialog/cad-new-part-dialog.component';
import { CadModelService } from '../../../services/cad-model.service';
import { AssemblyService } from '../../../services/assembly.service';
import { PartWithCadSummary } from '../../../models/cad-model.model';
import { EligiblePart } from '../../../cad/lib/assembly.types';
import { AuthService } from '../../../services/auth.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { DataTable, DataTableColumnDef, ColumnDef } from '../../common/data-table/data-table';

@Component({
  selector: 'app-cad-landing',
  standalone: true,
  imports: [
    CommonModule, RouterLink, FormsModule,
    MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatTooltipModule, MatDialogModule,
    DataTable, DataTableColumnDef,
  ],
  template: `
    <div class="cad-landing" data-testid="cad-landing">
      <header class="page-header">
        <mat-icon class="page-icon">view_in_ar</mat-icon>
        <h2>CAD Models</h2>
      </header>

      @if (showPicker()) {
        <section class="picker">
          <p class="hint">Pick an <strong>Assembly-category</strong> part to start an assembly for:</p>
          <mat-form-field appearance="outline" class="picker-search">
            <mat-label>Search parts</mat-label>
            <input matInput [ngModel]="partSearch()" (ngModelChange)="partSearch.set($event)" placeholder="name or revision" />
          </mat-form-field>
          <div class="part-list">
            @for (p of filteredParts(); track p.partID) {
              <button mat-button class="part-row" (click)="startAssembly(p.partID)">
                <mat-icon>account_tree</mat-icon> {{ p.part.name }} <span class="sku">{{ p.part.revision }}</span>
                @if (p.hasAssembly) { <span class="has">has assembly</span> }
              </button>
            }
            @if (filteredParts().length === 0) {
              <p class="empty-parts">No parts in the Assembly category. Set a part's category to “Assembly” to make it eligible.</p>
            }
          </div>
        </section>
      }

      <div *ngIf="loading()" class="loading">
        <mat-spinner diameter="32"></mat-spinner>
      </div>

      <app-data-table *ngIf="!loading()"
        [data]="rows()"
        [columns]="columns"
        [searchKeys]="searchKeys"
        [defaultSort]="{ key: 'updated', dir: 'desc' }"
        searchPlaceholder="Filter by part name, description, or revision"
        (rowClick)="openLatest($event)"
        data-testid="cad-landing-table">

        <div dataTableToolbar>
          <button mat-stroked-button (click)="newPart('assembly')"
                  matTooltip="Create a new assembly part and open it.">
            <mat-icon>account_tree</mat-icon>
            New assembly
          </button>
          <button mat-flat-button color="primary" (click)="newPart('part')"
                  matTooltip="Create a new CAD part and open it.">
            <mat-icon>add</mat-icon>
            New Part
          </button>
        </div>

        <ng-template appColumn="part" let-r>
          <a [routerLink]="['/parts', r.partID, 'cad']" class="part-link" (click)="$event.stopPropagation()">
            <strong>{{ r.part?.name || '(unnamed)' }}</strong>
            <span class="part-rev">·  Rev {{ r.part?.revision }}</span>
          </a>
          <div class="part-desc" *ngIf="r.part?.description">{{ r.part!.description }}</div>
        </ng-template>

        <ng-template appColumn="type" let-r>
          <span class="type-chip" [class.assembly]="r.isAssembly">
            <mat-icon>{{ r.isAssembly ? 'account_tree' : 'view_in_ar' }}</mat-icon>
            {{ r.isAssembly ? 'Assembly' : 'Part' }}
          </span>
        </ng-template>

        <ng-template appColumn="latest" let-r>
          <span class="rev-tag">Rev {{ r.latestRevision }}</span>
          <span class="state-badge"
                [class.draft]="r.latestReleaseState==='draft'"
                [class.review]="r.latestReleaseState==='review'"
                [class.released]="r.latestReleaseState==='released'">
            {{ r.latestReleaseState }}
          </span>
        </ng-template>

        <ng-template appColumn="released" let-r>
          <span *ngIf="r.hasReleased" class="released-pill">
            <mat-icon>verified</mat-icon> Rev {{ r.releasedRevision }}
          </span>
          <span *ngIf="!r.hasReleased" class="muted">—</span>
        </ng-template>

        <ng-template appColumn="count" let-r>{{ r.revisionCount }}</ng-template>

        <ng-template appColumn="updated" let-r>{{ r.latestUpdatedAt | date:'short' }}</ng-template>

        <ng-template appColumn="actions" let-r>
          <div class="row-actions" (click)="$event.stopPropagation()">
            <a mat-stroked-button
               [routerLink]="['/parts', r.partID, 'cad']"
               matTooltip="View the version history — graph, branches, diffs">
              <mat-icon>history</mat-icon> Show history
            </a>
            <a mat-stroked-button
               [routerLink]="r.isAssembly ? ['/parts', r.partID, 'assembly', 'editor'] : ['/parts', r.partID, 'cad', 'editor']"
               [queryParams]="r.isAssembly ? null : { revisionID: r.latestRevisionID }"
               [matTooltip]="r.isAssembly ? 'Open in the assembly editor' : 'Open the latest revision in the CAD editor'">
              <mat-icon>open_in_new</mat-icon> Open
            </a>
          </div>
        </ng-template>
      </app-data-table>
    </div>
  `,
  styles: [`
    /* The app shell's .content host is overflow:hidden — each page owns its
       own vertical scroll. Matches cad-revision-list. */
    :host { display: block; height: 100%; overflow-y: auto; }
    .cad-landing { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .page-header h2 { margin: 0; }
    .page-icon { font-size: 28px; width: 28px; height: 28px; opacity: 0.8; }
    .loading { display: flex; justify-content: center; padding: 32px; }
    .part-link { text-decoration: none; color: inherit; }
    .part-link strong { font-weight: 600; }
    .part-rev { opacity: 0.6; font-size: 12px; }
    .part-desc { font-size: 12px; opacity: 0.6; max-width: 380px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rev-tag { display: inline-block; padding: 2px 8px; background: #e8eaf0; color: #2a2a3a; border: 1px solid #c8ccd8; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 12px; font-weight: 600; margin-right: 8px; }
    .row-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .state-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: uppercase; font-weight: 600; }
    .state-badge.draft { background: #fff3e0; color: #e65100; }
    .state-badge.review { background: #e3f2fd; color: #1565c0; }
    .state-badge.released { background: #e8f5e9; color: #2e7d32; }
    .released-pill { display: inline-flex; align-items: center; gap: 4px; color: #2e7d32; font-weight: 500; }
    .released-pill mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .muted { opacity: 0.4; }
    .type-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; background: #e8eaf0; color: #2a2a3a; }
    .type-chip mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .type-chip.assembly { background: #e3f2fd; color: #1565c0; }
    .picker { border: 1px solid #ccc; border-radius: 8px; padding: 1rem; margin-bottom: 16px; }
    .picker .hint { margin: 0 0 .5rem; }
    .picker-search { width: 320px; max-width: 100%; }
    .part-list { display: flex; flex-direction: column; max-height: 280px; overflow: auto; }
    .part-row { justify-content: flex-start; }
    .sku { color: #888; margin-left: .5rem; font-size: .85em; }
    .has { margin-left: auto; font-size: .72em; color: #2e7d32; background: #e8f5e9; padding: 1px 6px; border-radius: 8px; }
    .empty-parts { color: #888; padding: .5rem; }
  `],
})
export class CadLandingComponent implements OnInit {
  private cadApi = inject(CadModelService);
  private assemblyApi = inject(AssemblyService);
  private auth = inject(AuthService);
  private errors = inject(ErrorNotificationService);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  /** Open the reduced new-part dialog (CAD part or assembly), then refresh on
   * close in case the user cancels navigation. */
  newPart(mode: 'part' | 'assembly') {
    this.dialog.open(CadNewPartDialogComponent, { data: { mode }, autoFocus: false });
  }

  rows = signal<PartWithCadSummary[]>([]);
  loading = signal<boolean>(true);

  columns: ColumnDef<PartWithCadSummary>[] = [
    { key: 'part', header: 'Part', sortable: true, sortValue: r => r.part?.name ?? '' },
    { key: 'type', header: 'Type', sortable: true, sortValue: r => r.isAssembly ? 'Assembly' : 'Part' },
    { key: 'latest', header: 'Latest CAD Revision', sortable: true, sortValue: r => r.latestRevision ?? '' },
    { key: 'released', header: 'Released', sortable: true, sortValue: r => r.releasedRevision ?? '' },
    { key: 'count', header: 'Revisions', sortable: true, sortValue: r => r.revisionCount ?? 0 },
    { key: 'updated', header: 'Updated', sortable: true, sortValue: r => r.latestUpdatedAt ?? '' },
    { key: 'actions', header: '', sortable: false },
  ];
  searchKeys = ['part.name', 'part.description', 'part.revision'];

  // "New assembly" picker — Assembly-category parts eligible to start one.
  showPicker = signal(false);
  eligibleParts = signal<EligiblePart[]>([]);
  partSearch = signal('');
  filteredParts = computed(() => {
    const q = this.partSearch().trim().toLowerCase();
    if (!q) return this.eligibleParts();
    return this.eligibleParts().filter((p) =>
      `${p.part?.name || ''} ${p.part?.revision || ''}`.toLowerCase().includes(q));
  });

  ngOnInit() {
    this.cadApi.listPartsWithCad().subscribe({
      next: rs => { this.rows.set(rs); this.loading.set(false); },
      error: err => { this.errors.showError(err?.error?.error || 'Failed to load CAD landing'); this.loading.set(false); },
    });
    this.assemblyApi.eligibleParts().subscribe({
      next: rows => this.eligibleParts.set(rows),
      error: () => {},
    });
  }

  openLatest(row: PartWithCadSummary) {
    if (row.isAssembly) {
      this.router.navigate(['/parts', row.partID, 'assembly', 'editor']);
      return;
    }
    if (!row.latestRevisionID) return;
    this.router.navigate(['/parts', row.partID, 'cad', 'editor'], { queryParams: { revisionID: row.latestRevisionID } });
  }

  startAssembly(partID: number) {
    const existing = this.eligibleParts().find(p => p.partID === partID);
    if (existing?.hasAssembly) {
      this.router.navigate(['/parts', partID, 'assembly', 'editor']);
      return;
    }
    this.assemblyApi.createForPart(partID).subscribe({
      next: () => this.router.navigate(['/parts', partID, 'assembly', 'editor']),
      error: e => this.errors.showError(e?.error?.error || 'Failed to create assembly'),
    });
  }
}
