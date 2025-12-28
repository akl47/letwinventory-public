import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { Part } from '../../../models';
import { PartEditDialog } from '../part-edit-dialog/part-edit-dialog';

@Component({
  selector: 'app-parts-table-view',
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
    FormsModule
  ],
  templateUrl: './parts-table-view.html',
  styleUrl: './parts-table-view.css',
})
export class PartsTableView implements OnInit {
  private inventoryService = inject(InventoryService);
  private dialog = inject(MatDialog);

  allParts = signal<Part[]>([]);
  displayedParts = signal<Part[]>([]);
  searchText = signal<string>('');
  showInactive = signal<boolean>(false);

  displayedColumns: string[] = ['name', 'description', 'category', 'vendor', 'sku', 'minimumOrderQuantity', 'internalPart', 'actions'];

  // Pagination
  pageSize = signal<number>(10);
  pageIndex = signal<number>(0);
  pageSizeOptions = [5, 10, 25, 50, 100];

  // Sorting
  sortColumn = signal<string>('name');
  sortDirection = signal<'asc' | 'desc'>('asc');

  ngOnInit() {
    this.loadParts();
  }

  loadParts() {
    this.inventoryService.getAllParts().subscribe({
      next: (parts) => {
        this.allParts.set(parts);
        this.applyFiltersAndSort();
      },
      error: (err) => {
        console.error('Error loading parts:', err);
      }
    });
  }

  applyFiltersAndSort() {
    let filtered = [...this.allParts()];

    // Filter by active flag
    if (!this.showInactive()) {
      filtered = filtered.filter(part => part.activeFlag === true);
    }

    // Apply search filter
    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(part =>
        part.name.toLowerCase().includes(search) ||
        part.description?.toLowerCase().includes(search) ||
        part.vendor?.toLowerCase().includes(search) ||
        part.sku?.toLowerCase().includes(search) ||
        part.PartCategory?.name?.toLowerCase().includes(search)
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
    this.displayedParts.set(filtered.slice(startIndex, endIndex));
  }

  onSearchChange(value: string) {
    this.searchText.set(value);
    this.pageIndex.set(0); // Reset to first page
    this.applyFiltersAndSort();
  }

  onPageChange(event: PageEvent) {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.applyFiltersAndSort();
  }

  onSortChange(sort: Sort) {
    this.sortColumn.set(sort.active);
    this.sortDirection.set(sort.direction as 'asc' | 'desc' || 'asc');
    this.applyFiltersAndSort();
  }

  onToggleInactive(checked: boolean) {
    this.showInactive.set(checked);
    this.pageIndex.set(0); // Reset to first page
    this.applyFiltersAndSort();
  }

  getTotalCount(): number {
    let filtered = [...this.allParts()];

    // Filter by active flag
    if (!this.showInactive()) {
      filtered = filtered.filter(part => part.activeFlag === true);
    }

    // Apply search filter
    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(part =>
        part.name.toLowerCase().includes(search) ||
        part.description?.toLowerCase().includes(search) ||
        part.vendor?.toLowerCase().includes(search) ||
        part.sku?.toLowerCase().includes(search) ||
        part.PartCategory?.name?.toLowerCase().includes(search)
      );
    }

    return filtered.length;
  }

  openLink(link: string) {
    if (link) {
      window.open(link, '_blank');
    }
  }

  openNewPartDialog() {
    const dialogRef = this.dialog.open(PartEditDialog, {
      width: '500px',
      data: {}
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadParts(); // Reload parts after creating
      }
    });
  }

  editPart(part: Part) {
    const dialogRef = this.dialog.open(PartEditDialog, {
      width: '500px',
      data: { part }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadParts(); // Reload parts after edit/delete
      }
    });
  }

  deletePart(part: Part) {
    // This method is kept for potential future use, but delete is handled in the dialog
    console.log('Delete part:', part);
  }
}
