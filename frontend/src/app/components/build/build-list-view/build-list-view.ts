import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { InventoryService } from '../../../services/inventory.service';
import { AuthService } from '../../../services/auth.service';
import { NewBuildDialog } from '../new-build-dialog/new-build-dialog';
import { BarcodeTag } from '../../inventory/barcode-tag/barcode-tag';
import { PartNumberPipe } from '../../../pipes/part-number.pipe';
import { CategoryBadge } from '../../common/category-badge/category-badge';
import { DataTable, DataTableColumnDef, ColumnDef, FilterSection } from '../../common/data-table/data-table';

interface BuildSummary {
  barcodeID: number;
  barcode: string;
  partName: string;
  partRevision: string;
  categoryName: string;
  categoryColor: string;
  status: string;
  bomFulfilled: number;
  bomTotal: number;
  createdAt: string;
}

@Component({
  selector: 'app-build-list-view',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    BarcodeTag,
    PartNumberPipe,
    CategoryBadge,
    DataTable,
    DataTableColumnDef,
  ],
  templateUrl: './build-list-view.html',
  styleUrl: './build-list-view.css',
})
export class BuildListView implements OnInit {
  private router = inject(Router);
  private inventoryService = inject(InventoryService);
  private authService = inject(AuthService);
  private dialog = inject(MatDialog);

  canWrite = computed(() => this.authService.hasPermission('inventory', 'write'));

  builds = signal<BuildSummary[]>([]);
  isLoading = signal(true);
  showCompleted = signal(false);

  columns: ColumnDef<BuildSummary>[] = [
    { key: 'barcode', header: 'Barcode', sortable: true },
    { key: 'partName', header: 'Part', sortable: true },
    { key: 'category', header: 'Type', sortable: true, sortValue: b => b.categoryName?.toLowerCase() ?? null },
    { key: 'status', header: 'Status', sortable: true },
    { key: 'progress', header: 'Progress' },
    { key: 'createdAt', header: 'Created', sortable: true, sortValue: b => b.createdAt ? new Date(b.createdAt).getTime() : null },
  ];

  filterSections: FilterSection<BuildSummary>[] = [
    {
      type: 'toggle',
      key: 'completed',
      label: 'Show Completed',
      default: false,
      predicate: (b, on) => on || b.status !== 'complete',
    },
  ];

  searchKeys = ['partName', 'barcode', 'categoryName'];

  ngOnInit() {
    this.loadBuilds();
  }

  loadBuilds() {
    this.isLoading.set(true);
    this.inventoryService.getInProgressBuilds(this.showCompleted()).subscribe({
      next: (builds) => {
        this.builds.set(builds as BuildSummary[]);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  openNewBuild() {
    const dialogRef = this.dialog.open(NewBuildDialog, { width: '500px' });
    dialogRef.afterClosed().subscribe((result: { barcodeId?: number } | undefined) => {
      if (result?.barcodeId) this.router.navigate(['/kits', result.barcodeId]);
    });
  }

  openBuild(build: BuildSummary) {
    this.router.navigate(['/kits', build.barcodeID]);
  }
}
