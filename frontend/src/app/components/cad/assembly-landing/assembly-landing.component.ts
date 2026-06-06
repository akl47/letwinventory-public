import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AssemblyService } from '../../../services/assembly.service';
import { AssemblyListItem, EligiblePart } from '../../../cad/lib/assembly.types';
import { ErrorNotificationService } from '../../../services/error-notification.service';

@Component({
  selector: 'app-assembly-landing',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatTableModule,
    MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatTooltipModule,
  ],
  template: `
    <div class="assembly-landing" data-testid="assembly-landing">
      <header class="page-header">
        <mat-icon class="page-icon">account_tree</mat-icon>
        <h2>Assemblies</h2>
        <span class="spacer"></span>
        <button mat-stroked-button (click)="showPicker.set(!showPicker())">
          <mat-icon>add</mat-icon> New assembly
        </button>
      </header>

      @if (showPicker()) {
        <section class="picker">
          <p class="hint">Pick an <strong>Assembly-category</strong> part to start an assembly for:</p>
          <mat-form-field appearance="outline" class="search">
            <mat-label>Search parts</mat-label>
            <input matInput [ngModel]="partSearch()" (ngModelChange)="partSearch.set($event)" placeholder="name or revision" />
          </mat-form-field>
          <div class="part-list">
            @for (p of filteredParts(); track p.partID) {
              <button mat-button class="part-row" (click)="startAssembly(p.partID)">
                <mat-icon>account_tree</mat-icon> {{ p.part?.name }} <span class="sku">{{ p.part?.revision }}</span>
                @if (p.hasAssembly) { <span class="has">has assembly</span> }
              </button>
            }
            @if (filteredParts().length === 0) {
              <p class="empty">No parts in the Assembly category. Set a part's category to “Assembly” to make it eligible.</p>
            }
          </div>
        </section>
      }

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="36"></mat-spinner></div>
      } @else if (assemblies().length === 0) {
        <div class="empty-state">
          <mat-icon>account_tree</mat-icon>
          <p>No assemblies yet. Click “New assembly” to start one from a part.</p>
        </div>
      } @else {
        <table mat-table [dataSource]="assemblies()" class="asm-table">
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Name</th>
            <td mat-cell *matCellDef="let a">{{ a.name || a.part?.name || ('Assembly ' + a.id) }}</td>
          </ng-container>
          <ng-container matColumnDef="part">
            <th mat-header-cell *matHeaderCellDef>Part</th>
            <td mat-cell *matCellDef="let a">{{ a.part?.name }} <span class="sku">{{ a.part?.sku }}</span></td>
          </ng-container>
          <ng-container matColumnDef="count">
            <th mat-header-cell *matHeaderCellDef>Components</th>
            <td mat-cell *matCellDef="let a">{{ a.instanceCount }}</td>
          </ng-container>
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let a">
              <button mat-stroked-button (click)="open(a)">Open</button>
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="cols"></tr>
          <tr mat-row *matRowDef="let row; columns: cols"></tr>
        </table>
      }
    </div>
  `,
  styles: [`
    .assembly-landing { padding: 1rem 1.5rem; }
    .page-header { display: flex; align-items: center; gap: .5rem; }
    .page-header h2 { margin: 0; }
    .spacer { flex: 1; }
    .picker { border: 1px solid var(--mat-sys-outline, #ddd); border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    .picker .hint { margin: 0 0 .5rem; }
    .picker .search { width: 320px; max-width: 100%; }
    .part-list { display: flex; flex-direction: column; max-height: 280px; overflow: auto; }
    .part-row { justify-content: flex-start; }
    .sku { color: #888; margin-left: .5rem; font-size: .85em; }
    .has { margin-left: auto; font-size: .72em; color: #2e7d32; background: #e8f5e9; padding: 1px 6px; border-radius: 8px; }
    .loading, .empty-state { display: flex; flex-direction: column; align-items: center; gap: .5rem; padding: 3rem; color: #888; }
    .asm-table { width: 100%; }
  `],
})
export class AssemblyLandingComponent implements OnInit {
  private assemblyApi = inject(AssemblyService);
  private router = inject(Router);
  private errors = inject(ErrorNotificationService);

  loading = signal(true);
  assemblies = signal<AssemblyListItem[]>([]);
  showPicker = signal(false);
  eligibleParts = signal<EligiblePart[]>([]);
  partSearch = signal('');
  cols = ['name', 'part', 'count', 'actions'];

  filteredParts = computed(() => {
    const q = this.partSearch().trim().toLowerCase();
    if (!q) return this.eligibleParts();
    return this.eligibleParts().filter((p) =>
      `${p.part?.name || ''} ${p.part?.revision || ''}`.toLowerCase().includes(q));
  });

  ngOnInit() {
    this.assemblyApi.list().subscribe({
      next: (rows) => { this.assemblies.set(rows); this.loading.set(false); },
      error: (e) => { this.errors.showError(e?.error?.error || 'Failed to load assemblies'); this.loading.set(false); },
    });
    this.assemblyApi.eligibleParts().subscribe({
      next: (rows) => this.eligibleParts.set(rows),
      error: () => {},
    });
  }

  open(a: AssemblyListItem) { this.router.navigate(['/parts', a.partID, 'assembly', 'editor']); }
  startAssembly(partID: number) { this.router.navigate(['/parts', partID, 'assembly', 'editor']); }
}
