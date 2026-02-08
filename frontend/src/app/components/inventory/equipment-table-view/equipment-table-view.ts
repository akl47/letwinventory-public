import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { InventoryService } from '../../../services/inventory.service';
import { Equipment } from '../../../models/equipment.model';
import { EquipmentEditDialog } from '../equipment-edit-dialog/equipment-edit-dialog';
import { BarcodeTag } from '../barcode-tag/barcode-tag';

@Component({
  selector: 'app-equipment-table-view',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSlideToggleModule,
    FormsModule,
    BarcodeTag
  ],
  templateUrl: './equipment-table-view.html',
  styleUrl: './equipment-table-view.css',
})
export class EquipmentTableView implements OnInit {
  private inventoryService = inject(InventoryService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private dialog = inject(MatDialog);

  allEquipment = signal<Equipment[]>([]);
  displayedEquipment = signal<Equipment[]>([]);
  searchText = signal<string>('');
  showInactive = signal<boolean>(false);

  displayedColumns: string[] = ['name', 'serialNumber', 'barcode', 'commissionDate', 'actions'];

  // Pagination
  pageSize = signal<number>(10);
  pageIndex = signal<number>(0);
  pageSizeOptions = [5, 10, 25, 50, 100];

  // Sorting
  sortColumn = signal<string>('name');
  sortDirection = signal<'asc' | 'desc'>('asc');

  private initializedFromQuery = false;

  ngOnInit() {
    this.applyQueryParams();
    this.loadEquipment();
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
    if (sortCol !== 'name' || sortDir !== 'asc') {
      params['sort'] = sortCol;
      params['dir'] = sortDir;
    }
    if (this.pageIndex() > 0) params['page'] = String(this.pageIndex());
    if (this.pageSize() !== 10) params['pageSize'] = String(this.pageSize());
    this.router.navigate([], { relativeTo: this.route, queryParams: params, replaceUrl: true });
  }

  loadEquipment() {
    this.inventoryService.getAllEquipment().subscribe({
      next: (equipment) => {
        this.allEquipment.set(equipment);
        this.applyFiltersAndSort();
      },
      error: (err) => {
        console.error('Error loading equipment:', err);
      }
    });
  }

  applyFiltersAndSort() {
    let filtered = [...this.allEquipment()];

    // Filter by active flag
    if (!this.showInactive()) {
      filtered = filtered.filter(equipment => equipment.activeFlag === true);
    }

    // Apply search filter
    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(equipment =>
        equipment.name.toLowerCase().includes(search) ||
        equipment.description?.toLowerCase().includes(search) ||
        equipment.serialNumber?.toLowerCase().includes(search) ||
        equipment.Barcode?.barcode?.toLowerCase().includes(search)
      );
    }

    // Apply sorting
    const sortCol = this.sortColumn();
    const sortDir = this.sortDirection();
    filtered.sort((a, b) => {
      const aVal = (a as any)[sortCol];
      const bVal = (b as any)[sortCol];
      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'asc' ? comparison : -comparison;
    });

    // Apply pagination
    const startIndex = this.pageIndex() * this.pageSize();
    const endIndex = startIndex + this.pageSize();
    this.displayedEquipment.set(filtered.slice(startIndex, endIndex));
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
    this.sortDirection.set(sort.direction as 'asc' | 'desc' || 'asc');
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
    let filtered = [...this.allEquipment()];

    // Filter by active flag
    if (!this.showInactive()) {
      filtered = filtered.filter(equipment => equipment.activeFlag === true);
    }

    // Apply search filter
    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(equipment =>
        equipment.name.toLowerCase().includes(search) ||
        equipment.description?.toLowerCase().includes(search) ||
        equipment.serialNumber?.toLowerCase().includes(search) ||
        equipment.Barcode?.barcode?.toLowerCase().includes(search)
      );
    }

    return filtered.length;
  }

  formatDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  }

  openNewEquipmentDialog() {
    const dialogRef = this.dialog.open(EquipmentEditDialog, {
      width: '500px',
      data: {}
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadEquipment(); // Reload equipment after creating
      }
    });
  }

  editEquipment(equipment: Equipment) {
    const dialogRef = this.dialog.open(EquipmentEditDialog, {
      width: '500px',
      data: { equipment }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadEquipment(); // Reload equipment after edit/delete
      }
    });
  }
}
