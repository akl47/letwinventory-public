import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { InventoryService } from '../../../services/inventory.service';
import { AuthService } from '../../../services/auth.service';
import { Part, PartCategory } from '../../../models';
import { AuthImgDirective } from '../../../directives/auth-img.directive';
import { CategoryBadge } from '../../common/category-badge/category-badge';
import { DataTable, DataTableColumnDef, ColumnDef, FilterSection } from '../../common/data-table/data-table';

@Component({
  selector: 'app-parts-table-view',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    AuthImgDirective,
    CategoryBadge,
    DataTable,
    DataTableColumnDef,
  ],
  templateUrl: './parts-table-view.html',
  styleUrl: './parts-table-view.css',
})
export class PartsTableView implements OnInit {
  private inventoryService = inject(InventoryService);
  private authService = inject(AuthService);
  private router = inject(Router);

  canWrite = computed(() => this.authService.hasPermission('parts', 'write'));

  allParts = signal<Part[]>([]);
  stockLevels = signal<Record<number, number>>({});
  categories = signal<PartCategory[]>([]);
  // REQ 937 — drives the spinner. Starts true so the table (and its "No data"
  // empty state) never renders before the first response lands.
  isLoading = signal<boolean>(true);
  imageTooltipStyle: Record<string, string> = {};

  columns: ColumnDef<Part>[] = [
    { key: 'image', header: '' },
    { key: 'name', header: 'Part Number', sortable: true },
    { key: 'revision', header: 'Rev', sortable: true },
    { key: 'description', header: 'Description', sortable: true },
    { key: 'category', header: 'Category', sortable: true, sortValue: p => p.PartCategory?.name?.toLowerCase() ?? null },
    { key: 'vendor', header: 'Vendor', sortable: true },
    { key: 'sku', header: 'SKU', sortable: true },
    { key: 'minimumOrderQuantity', header: 'Min Order Qty', sortable: true },
    { key: 'inStock', header: 'In Stock', sortable: true, sortValue: p => this.getStockQuantity(p) },
    { key: 'minimumStockQuantity', header: 'Min Stock Qty', sortable: true, sortValue: p => p.minimumStockQuantity ?? null },
    { key: 'internalPart', header: 'Type', sortable: true },
    { key: 'createdAt', header: 'Created', sortable: true, sortValue: p => p.createdAt ? new Date(p.createdAt).getTime() : null },
  ];

  filterSections = computed<FilterSection<Part>[]>(() => [
    {
      type: 'multiSelect',
      key: 'categories',
      label: 'Categories',
      options: this.categories().map(c => ({
        id: c.id,
        label: c.name,
        colorHex: c.tagColorHex ? `#${c.tagColorHex}` : '#808080',
      })),
      accessor: (p: Part) => p.PartCategory?.id ?? null,
    },
    {
      type: 'multiSelect',
      key: 'partType',
      label: 'Part Type',
      options: [
        { id: 'internal', label: 'Internal' },
        { id: 'vendor', label: 'Vendor' },
      ],
      accessor: (p: Part) => (p.internalPart ? 'internal' : 'vendor'),
    },
    {
      type: 'toggle',
      key: 'inactive',
      label: 'Show Inactive',
      default: false,
      predicate: (p, on) => on || p.activeFlag === true,
    },
    {
      type: 'toggle',
      key: 'lowStock',
      label: 'Low Stock Only',
      default: false,
      predicate: (p, on) => !on || this.isLowStock(p),
    },
  ]);

  searchKeys = ['name', 'description', 'vendor', 'sku', 'PartCategory.name'];

  rowHref = (p: Part) => `/parts/${p.id}/edit`;

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    // The three calls are independent — categories used to gate the parts
    // fetch, which serialized two round-trips and roughly doubled the time to
    // first row. forkJoin runs them concurrently and gives one place to clear
    // the spinner. Each stream swallows its own error so one failure doesn't
    // blank the whole page.
    forkJoin({
      categories: this.inventoryService.getPartCategories().pipe(
        catchError((err) => { console.error('Error loading categories:', err); return of([] as PartCategory[]); }),
      ),
      parts: this.inventoryService.getAllParts().pipe(
        catchError((err) => { console.error('Error loading parts:', err); return of([] as Part[]); }),
      ),
      stockLevels: this.inventoryService.getStockLevels().pipe(
        catchError((err) => { console.error('Error loading stock levels:', err); return of({} as Record<number, number>); }),
      ),
    }).subscribe((res) => {
      this.categories.set(res.categories);
      this.allParts.set(res.parts);
      this.stockLevels.set(res.stockLevels);
      this.isLoading.set(false);
    });
  }

  getStockQuantity(part: Part): number {
    return this.stockLevels()[part.id] ?? 0;
  }

  isLowStock(part: Part): boolean {
    if (part.minimumStockQuantity == null) return false;
    return this.getStockQuantity(part) < part.minimumStockQuantity;
  }

  openNewPartDialog() {
    this.router.navigate(['/parts/new']);
  }

  editPart(part: Part) {
    this.router.navigate(['/parts', part.id, 'edit']);
  }
}
