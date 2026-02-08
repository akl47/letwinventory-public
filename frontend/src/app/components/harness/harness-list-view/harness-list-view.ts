import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialog } from '@angular/material/dialog';
import { HarnessService } from '../../../services/harness.service';
import { WireHarnessSummary, createEmptyHarnessData } from '../../../models/harness.model';
import { PartEditDialog } from '../../inventory/part-edit-dialog/part-edit-dialog';
import { Part } from '../../../models';

@Component({
  selector: 'app-harness-list-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSlideToggleModule
  ],
  templateUrl: './harness-list-view.html',
  styleUrl: './harness-list-view.css'
})
export class HarnessListView implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private dialog = inject(MatDialog);
  private harnessService = inject(HarnessService);

  allHarnesses = signal<WireHarnessSummary[]>([]);
  displayedHarnesses = signal<WireHarnessSummary[]>([]);
  isLoading = signal(true);
  searchText = signal<string>('');
  showInactive = signal<boolean>(false);

  displayedColumns: string[] = ['name', 'partNumber', 'revision', 'releaseState', 'description', 'updatedAt', 'actions'];

  // Pagination
  pageSize = signal<number>(10);
  pageIndex = signal<number>(0);
  pageSizeOptions = [5, 10, 25, 50];

  // Sorting
  sortColumn = signal<string>('updatedAt');
  sortDirection = signal<'asc' | 'desc'>('desc');

  private initializedFromQuery = false;

  ngOnInit() {
    this.applyQueryParams();
    this.loadHarnesses();
  }

  private applyQueryParams() {
    const params = this.route.snapshot.queryParams;
    if (params['search']) this.searchText.set(params['search']);
    if (params['inactive'] === 'true') this.showInactive.set(true);
    if (params['sort']) this.sortColumn.set(params['sort']);
    if (params['dir'] === 'asc' || params['dir'] === 'desc') this.sortDirection.set(params['dir']);
    if (params['page']) this.pageIndex.set(parseInt(params['page'], 10) || 0);
    if (params['pageSize']) this.pageSize.set(parseInt(params['pageSize'], 10) || 10);
    this.initializedFromQuery = true;
  }

  private updateQueryParams() {
    if (!this.initializedFromQuery) return;
    const params: Record<string, string> = {};
    const search = this.searchText();
    if (search) params['search'] = search;
    if (this.showInactive()) params['inactive'] = 'true';
    const sortCol = this.sortColumn();
    const sortDir = this.sortDirection();
    if (sortCol !== 'updatedAt' || sortDir !== 'desc') {
      params['sort'] = sortCol;
      params['dir'] = sortDir;
    }
    if (this.pageIndex() > 0) params['page'] = String(this.pageIndex());
    if (this.pageSize() !== 10) params['pageSize'] = String(this.pageSize());
    this.router.navigate([], { relativeTo: this.route, queryParams: params, replaceUrl: true });
  }

  loadHarnesses() {
    this.isLoading.set(true);
    this.harnessService.getAllHarnesses().subscribe({
      next: (response) => {
        this.allHarnesses.set(response.harnesses);
        this.applyFiltersAndSort();
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  applyFiltersAndSort() {
    let filtered = [...this.allHarnesses()];

    // Filter by active flag
    if (!this.showInactive()) {
      filtered = filtered.filter(h => h.activeFlag === true);
    }

    // Apply search filter
    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(h =>
        h.name.toLowerCase().includes(search) ||
        h.partNumber?.toLowerCase().includes(search) ||
        h.description?.toLowerCase().includes(search)
      );
    }

    // Apply sorting
    const sortCol = this.sortColumn();
    const sortDir = this.sortDirection();
    filtered.sort((a, b) => {
      let aVal = (a as any)[sortCol];
      let bVal = (b as any)[sortCol];

      // Handle dates
      if (sortCol === 'updatedAt' || sortCol === 'createdAt') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      }

      // Handle nulls
      if (aVal === null || aVal === undefined) aVal = '';
      if (bVal === null || bVal === undefined) bVal = '';

      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'asc' ? comparison : -comparison;
    });

    // Apply pagination
    const startIndex = this.pageIndex() * this.pageSize();
    const endIndex = startIndex + this.pageSize();
    this.displayedHarnesses.set(filtered.slice(startIndex, endIndex));
  }

  onSearchChange(value: string) {
    this.searchText.set(value);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  onPageChange(event: PageEvent) {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  onSortChange(sort: Sort) {
    this.sortColumn.set(sort.active);
    this.sortDirection.set(sort.direction as 'asc' | 'desc' || 'desc');
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  onToggleInactive(checked: boolean) {
    this.showInactive.set(checked);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  getTotalCount(): number {
    let filtered = [...this.allHarnesses()];

    if (!this.showInactive()) {
      filtered = filtered.filter(h => h.activeFlag === true);
    }

    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(h =>
        h.name.toLowerCase().includes(search) ||
        h.partNumber?.toLowerCase().includes(search) ||
        h.description?.toLowerCase().includes(search)
      );
    }

    return filtered.length;
  }

  createNew() {
    const dialogRef = this.dialog.open(PartEditDialog, {
      width: '500px',
      data: { lockedCategory: 'Harness' }
    });

    dialogRef.afterClosed().subscribe((result: boolean | Part | undefined) => {
      if (result && typeof result === 'object') {
        const part = result as Part;
        const harnessData = createEmptyHarnessData(part.name);
        harnessData.description = part.description || '';

        this.harnessService.createHarness({
          name: part.name,
          description: part.description || undefined,
          harnessData: harnessData,
          partID: part.id
        }).subscribe({
          next: (harness) => {
            this.router.navigate(['/harness/editor', harness.id]);
          }
        });
      }
    });
  }

  openHarness(harness: WireHarnessSummary) {
    this.router.navigate(['/harness/editor', harness.id]);
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }
}
