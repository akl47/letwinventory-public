import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
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
import { filterBySearch } from '../../../utils/search';

@Component({
  selector: 'app-cad-landing',
  standalone: true,
  imports: [
    CommonModule, RouterLink, FormsModule,
    MatButtonModule, MatIconModule, MatTableModule,
    MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatTooltipModule, MatDialogModule,
  ],
  template: `
    <div class="cad-landing" data-testid="cad-landing">
      <header class="page-header">
        <mat-icon class="page-icon">view_in_ar</mat-icon>
        <h2>CAD Models</h2>
        <span class="spacer"></span>
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

      <mat-form-field appearance="outline" class="search">
        <mat-icon matPrefix>search</mat-icon>
        <mat-label>Filter by part name or number</mat-label>
        <input matInput [(ngModel)]="searchTerm" (ngModelChange)="searchTerm.set($event)">
      </mat-form-field>

      <div *ngIf="loading()" class="loading">
        <mat-spinner diameter="32"></mat-spinner>
      </div>

      <div *ngIf="!loading() && filtered().length === 0" class="empty">
        <p *ngIf="rows().length === 0">No parts have CAD models yet.</p>
        <p *ngIf="rows().length > 0">No parts match "{{ searchTerm() }}".</p>
        <p class="hint">Create a part, then open its CAD tab to begin a model.</p>
      </div>

      <table
        *ngIf="!loading() && filtered().length > 0"
        mat-table
        [dataSource]="filtered()"
        class="cad-table"
        data-testid="cad-landing-table">
        <ng-container matColumnDef="part">
          <th mat-header-cell *matHeaderCellDef>Part</th>
          <td mat-cell *matCellDef="let r">
            <a [routerLink]="['/parts', r.partID, 'cad']" class="part-link">
              <strong>{{ r.part?.name || '(unnamed)' }}</strong>
              <span class="part-rev">·  Rev {{ r.part?.revision }}</span>
            </a>
            <div class="part-desc" *ngIf="r.part?.description">{{ r.part!.description }}</div>
          </td>
        </ng-container>

        <ng-container matColumnDef="type">
          <th mat-header-cell *matHeaderCellDef>Type</th>
          <td mat-cell *matCellDef="let r">
            <span class="type-chip" [class.assembly]="r.isAssembly">
              <mat-icon>{{ r.isAssembly ? 'account_tree' : 'view_in_ar' }}</mat-icon>
              {{ r.isAssembly ? 'Assembly' : 'Part' }}
            </span>
          </td>
        </ng-container>

        <ng-container matColumnDef="latest">
          <th mat-header-cell *matHeaderCellDef>Latest CAD Revision</th>
          <td mat-cell *matCellDef="let r">
            <span class="rev-tag">Rev {{ r.latestRevision }}</span>
            <span class="state-badge"
                  [class.draft]="r.latestReleaseState==='draft'"
                  [class.review]="r.latestReleaseState==='review'"
                  [class.released]="r.latestReleaseState==='released'">
              {{ r.latestReleaseState }}
            </span>
          </td>
        </ng-container>

        <ng-container matColumnDef="released">
          <th mat-header-cell *matHeaderCellDef>Released</th>
          <td mat-cell *matCellDef="let r">
            <span *ngIf="r.hasReleased" class="released-pill">
              <mat-icon>verified</mat-icon> Rev {{ r.releasedRevision }}
            </span>
            <span *ngIf="!r.hasReleased" class="muted">—</span>
          </td>
        </ng-container>

        <ng-container matColumnDef="count">
          <th mat-header-cell *matHeaderCellDef>Revisions</th>
          <td mat-cell *matCellDef="let r">{{ r.revisionCount }}</td>
        </ng-container>

        <ng-container matColumnDef="updated">
          <th mat-header-cell *matHeaderCellDef>Updated</th>
          <td mat-cell *matCellDef="let r">{{ r.latestUpdatedAt | date:'short' }}</td>
        </ng-container>

        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let r" (click)="$event.stopPropagation()">
            <div class="row-actions">
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
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: displayedColumns" class="row" (click)="openLatest(row)"></tr>
      </table>
    </div>
  `,
  styles: [`
    .cad-landing { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .page-header h2 { margin: 0; }
    .page-icon { font-size: 28px; width: 28px; height: 28px; opacity: 0.8; }
    .spacer { flex: 1; }
    .search { width: 100%; max-width: 480px; margin-bottom: 16px; }
    .loading { display: flex; justify-content: center; padding: 32px; }
    .empty { padding: 32px; text-align: center; color: #666; border: 1px dashed #ccc; border-radius: 8px; }
    .empty .hint { font-size: 13px; opacity: 0.7; }
    .cad-table { width: 100%; }
    .row { cursor: pointer; }
    .row:hover { background: rgba(0,0,0,0.04); }
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
  searchTerm = signal<string>('');

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

  displayedColumns = ['part', 'type', 'latest', 'released', 'count', 'updated', 'actions'];

  filtered = computed(() => {
    const q = this.searchTerm().trim();
    return filterBySearch(this.rows(), q, ['part.name', 'part.description', 'part.revision']);
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
