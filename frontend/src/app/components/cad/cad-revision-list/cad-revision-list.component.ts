import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CadModelService } from '../../../services/cad-model.service';
import { CadModel } from '../../../models/cad-model.model';
import { AuthService } from '../../../services/auth.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';

@Component({
  selector: 'app-cad-revision-list',
  standalone: true,
  imports: [CommonModule, RouterLink, MatButtonModule, MatIconModule, MatTableModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="cad-revision-list" data-testid="cad-tab">
      <header class="page-header">
        <h2>CAD Models</h2>
        <button
          mat-raised-button color="primary"
          data-testid="cad-create-button"
          [disabled]="!canWrite() || creating()"
          (click)="onCreate()"
          *ngIf="models().length === 0">
          <mat-icon>add</mat-icon> Create CAD
        </button>
        <button
          mat-stroked-button
          data-testid="cad-new-revision-button"
          [disabled]="!canWrite() || creating() || !releasedModel()"
          *ngIf="models().length > 0 && releasedModel()"
          (click)="onNewRevision(releasedModel()!.id)">
          <mat-icon>add</mat-icon> New Revision from {{ releasedModel()!.revision }}
        </button>
      </header>

      <div *ngIf="loading()" class="loading">
        <mat-spinner diameter="32"></mat-spinner>
      </div>

      <div *ngIf="!loading() && models().length === 0" class="empty">
        <p>No CAD model. Click <strong>Create CAD</strong> to begin.</p>
      </div>

      <table
        *ngIf="!loading() && models().length > 0"
        mat-table [dataSource]="models()"
        data-testid="cad-revision-list"
        class="revision-table">
        <ng-container matColumnDef="revision">
          <th mat-header-cell *matHeaderCellDef>Rev</th>
          <td mat-cell *matCellDef="let m">{{ m.revision }}</td>
        </ng-container>
        <ng-container matColumnDef="state">
          <th mat-header-cell *matHeaderCellDef>State</th>
          <td mat-cell *matCellDef="let m">
            <span class="state-badge" [class.draft]="m.releaseState==='draft'" [class.review]="m.releaseState==='review'" [class.released]="m.releaseState==='released'">
              {{ m.releaseState }}
            </span>
          </td>
        </ng-container>
        <ng-container matColumnDef="created">
          <th mat-header-cell *matHeaderCellDef>Created</th>
          <td mat-cell *matCellDef="let m">{{ m.createdAt | date:'short' }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let m">
            <a mat-stroked-button [routerLink]="['./editor']" [queryParams]="{ revisionID: m.id }">
              <mat-icon>edit</mat-icon> Open
            </a>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
      </table>
    </div>
  `,
  styles: [`
    .cad-revision-list { padding: 24px; max-width: 900px; }
    .page-header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
    .page-header h2 { flex: 1; margin: 0; }
    .loading { display: flex; justify-content: center; padding: 32px; }
    .empty { padding: 32px; text-align: center; color: #666; border: 1px dashed #ccc; border-radius: 8px; }
    .revision-table { width: 100%; }
    .state-badge { padding: 2px 8px; border-radius: 4px; font-size: 12px; text-transform: uppercase; font-weight: 600; }
    .state-badge.draft { background: #fff3e0; color: #e65100; }
    .state-badge.review { background: #e3f2fd; color: #1565c0; }
    .state-badge.released { background: #e8f5e9; color: #2e7d32; }
  `],
})
export class CadRevisionListComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cadApi = inject(CadModelService);
  private auth = inject(AuthService);
  private errors = inject(ErrorNotificationService);

  partID = signal<number>(0);
  models = signal<CadModel[]>([]);
  loading = signal<boolean>(true);
  creating = signal<boolean>(false);

  displayedColumns = ['revision', 'state', 'created', 'actions'];

  canWrite() { return this.auth.hasPermission('cad', 'write'); }

  releasedModel() {
    return this.models().find(m => m.releaseState === 'released') ?? null;
  }

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(pm => {
      const id = Number(pm.get('id'));
      if (id) {
        this.partID.set(id);
        this.refresh();
      }
    });
    // Fallback for direct routing without parent.
    this.route.paramMap.subscribe(pm => {
      const id = Number(pm.get('id'));
      if (id && id !== this.partID()) {
        this.partID.set(id);
        this.refresh();
      }
    });
  }

  refresh() {
    if (!this.partID()) return;
    this.loading.set(true);
    this.cadApi.listByPart(this.partID()).subscribe({
      next: rows => { this.models.set(rows); this.loading.set(false); },
      error: err => { this.errors.showError(err?.error?.error || 'Failed to load CAD models'); this.loading.set(false); },
    });
  }

  onCreate() {
    this.creating.set(true);
    this.cadApi.createForPart(this.partID()).subscribe({
      next: created => {
        this.creating.set(false);
        this.router.navigate(['editor'], { relativeTo: this.route, queryParams: { revisionID: created.id } });
      },
      error: err => {
        this.creating.set(false);
        this.errors.showError(err?.error?.error || 'Failed to create CAD model');
      },
    });
  }

  onNewRevision(sourceID: number) {
    this.creating.set(true);
    this.cadApi.newRevision(sourceID).subscribe({
      next: created => {
        this.creating.set(false);
        this.router.navigate(['editor'], { relativeTo: this.route, queryParams: { revisionID: created.id } });
      },
      error: err => {
        this.creating.set(false);
        this.errors.showError(err?.error?.error || 'Failed to create new revision');
      },
    });
  }
}
