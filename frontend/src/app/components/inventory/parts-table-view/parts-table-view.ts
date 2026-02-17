import { Component, OnInit, inject, signal, computed } from '@angular/core';
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
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../../services/inventory.service';
import { AuthService } from '../../../services/auth.service';
import { Part, PartCategory } from '../../../models';

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
    MatMenuModule,
    MatCheckboxModule,
    MatDividerModule,
    FormsModule
  ],
  templateUrl: './parts-table-view.html',
  styleUrl: './parts-table-view.css',
})
export class PartsTableView implements OnInit {
  private inventoryService = inject(InventoryService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  canWrite = computed(() => this.authService.hasPermission('parts', 'write'));

  allParts = signal<Part[]>([]);
  displayedParts = signal<Part[]>([]);
  searchText = signal<string>('');
  showInactive = signal<boolean>(false);
  imageTooltipStyle: Record<string, string> = {};

  // Category filter
  categories = signal<PartCategory[]>([]);
  selectedCategoryIds = signal<Set<number>>(new Set());

  // Part type filter
  showInternal = signal<boolean>(true);
  showVendor = signal<boolean>(true);

  displayedColumns: string[] = ['image', 'name', 'description', 'category', 'vendor', 'sku', 'minimumOrderQuantity', 'internalPart', 'createdAt'];

  // Pagination
  pageSize = signal<number>(10);
  pageIndex = signal<number>(0);
  pageSizeOptions = [5, 10, 25, 50, 100];

  // Sorting
  sortColumn = signal<string>('name');
  sortDirection = signal<'asc' | 'desc'>('asc');

  // Computed: check if all categories are selected
  allCategoriesSelected = computed(() => {
    const cats = this.categories();
    const selected = this.selectedCategoryIds();
    return cats.length > 0 && cats.every(c => selected.has(c.id));
  });

  // Computed: check if some but not all categories are selected
  someCategoriesSelected = computed(() => {
    const cats = this.categories();
    const selected = this.selectedCategoryIds();
    const selectedCount = cats.filter(c => selected.has(c.id)).length;
    return selectedCount > 0 && selectedCount < cats.length;
  });

  // Computed: get selected categories for chip display
  selectedCategories = computed(() => {
    const cats = this.categories();
    const selected = this.selectedCategoryIds();
    return cats.filter(c => selected.has(c.id));
  });

  // Computed: count of hidden categories (for filter indicator)
  hiddenCategoryCount = computed(() => {
    const cats = this.categories();
    const selected = this.selectedCategoryIds();
    return cats.filter(c => !selected.has(c.id)).length;
  });

  // Computed: check if all types are selected
  allTypesSelected = computed(() => {
    return this.showInternal() && this.showVendor();
  });

  // Computed: check if some but not all types are selected
  someTypesSelected = computed(() => {
    const internal = this.showInternal();
    const vendor = this.showVendor();
    return (internal || vendor) && !(internal && vendor);
  });

  // Computed: count of active filters (categories + types)
  activeFilterCount = computed(() => {
    let count = this.hiddenCategoryCount();
    if (!this.showInternal()) count++;
    if (!this.showVendor()) count++;
    return count;
  });

  private initializedFromQuery = false;

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    // Load categories first, then parts
    this.inventoryService.getPartCategories().subscribe({
      next: (categories) => {
        this.categories.set(categories);
        // Select all categories by default
        this.selectedCategoryIds.set(new Set(categories.map(c => c.id)));
        // Apply query params after categories are loaded
        this.applyQueryParams();
        // Now load parts after categories are ready
        this.loadParts();
      },
      error: (err) => {
        console.error('Error loading categories:', err);
        this.applyQueryParams();
        // Still try to load parts even if categories fail
        this.loadParts();
      }
    });
  }

  private applyQueryParams() {
    const params = this.route.snapshot.queryParams;
    if (params['search']) this.searchText.set(params['search']);
    if (params['inactive'] === 'true') this.showInactive.set(true);
    if (params['internal'] !== undefined) this.showInternal.set(params['internal'] !== 'false');
    if (params['vendor'] !== undefined) this.showVendor.set(params['vendor'] !== 'false');
    if (params['sort']) this.sortColumn.set(params['sort']);
    if (params['dir'] === 'asc' || params['dir'] === 'desc') this.sortDirection.set(params['dir']);
    if (params['page']) this.pageIndex.set(parseInt(params['page'], 10) || 0);
    if (params['pageSize']) this.pageSize.set(parseInt(params['pageSize'], 10) || 10);
    if (params['categories']) {
      const ids = params['categories'].split(',').map((s: string) => parseInt(s, 10)).filter((n: number) => !isNaN(n));
      this.selectedCategoryIds.set(new Set(ids));
    }
    this.initializedFromQuery = true;
  }

  private updateQueryParams() {
    if (!this.initializedFromQuery) return;
    const params: Record<string, string> = {};
    const search = this.searchText();
    if (search) params['search'] = search;
    if (this.showInactive()) params['inactive'] = 'true';
    if (!this.showInternal()) params['internal'] = 'false';
    if (!this.showVendor()) params['vendor'] = 'false';
    const sortCol = this.sortColumn();
    const sortDir = this.sortDirection();
    if (sortCol !== 'name' || sortDir !== 'asc') {
      params['sort'] = sortCol;
      params['dir'] = sortDir;
    }
    if (this.pageIndex() > 0) params['page'] = String(this.pageIndex());
    if (this.pageSize() !== 10) params['pageSize'] = String(this.pageSize());
    // Only include categories param if not all selected
    const allCats = this.categories();
    const selected = this.selectedCategoryIds();
    if (allCats.length > 0 && selected.size < allCats.length) {
      params['categories'] = Array.from(selected).join(',');
    }
    this.router.navigate([], { relativeTo: this.route, queryParams: params, replaceUrl: true });
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

    // Filter by category
    const selectedCats = this.selectedCategoryIds();
    if (selectedCats.size === 0) {
      // No categories selected - show nothing
      filtered = [];
    } else if (selectedCats.size < this.categories().length) {
      // Some categories selected - filter by them
      filtered = filtered.filter(part => {
        const categoryId = part.PartCategory?.id;
        return categoryId && selectedCats.has(categoryId);
      });
    }
    // If all categories selected, no filtering needed

    // Filter by part type (internal/vendor)
    const showInternal = this.showInternal();
    const showVendor = this.showVendor();
    if (!showInternal && !showVendor) {
      filtered = [];
    } else if (!showInternal) {
      filtered = filtered.filter(part => part.internalPart === false);
    } else if (!showVendor) {
      filtered = filtered.filter(part => part.internalPart === true);
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
      const aVal = this.getSortValue(a, sortCol);
      const bVal = this.getSortValue(b, sortCol);

      // Handle nulls - sort nulls last
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return sortDir === 'asc' ? 1 : -1;
      if (bVal === null) return sortDir === 'asc' ? -1 : 1;

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

  // Category filter methods
  isCategorySelected(categoryId: number): boolean {
    return this.selectedCategoryIds().has(categoryId);
  }

  toggleCategory(categoryId: number): void {
    const current = this.selectedCategoryIds();
    const newSet = new Set(current);
    if (newSet.has(categoryId)) {
      newSet.delete(categoryId);
    } else {
      newSet.add(categoryId);
    }
    this.selectedCategoryIds.set(newSet);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  toggleAllCategories(): void {
    const cats = this.categories();
    if (this.allCategoriesSelected()) {
      this.selectedCategoryIds.set(new Set());
    } else {
      this.selectedCategoryIds.set(new Set(cats.map(c => c.id)));
    }
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  // Part type filter methods
  toggleInternal(): void {
    this.showInternal.update(v => !v);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  toggleVendor(): void {
    this.showVendor.update(v => !v);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  toggleAllTypes(): void {
    if (this.allTypesSelected()) {
      this.showInternal.set(false);
      this.showVendor.set(false);
    } else {
      this.showInternal.set(true);
      this.showVendor.set(true);
    }
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  getTotalCount(): number {
    let filtered = [...this.allParts()];

    // Filter by active flag
    if (!this.showInactive()) {
      filtered = filtered.filter(part => part.activeFlag === true);
    }

    // Filter by category
    const selectedCats = this.selectedCategoryIds();
    if (selectedCats.size === 0) {
      // No categories selected - show nothing
      filtered = [];
    } else if (selectedCats.size < this.categories().length) {
      // Some categories selected - filter by them
      filtered = filtered.filter(part => {
        const categoryId = part.PartCategory?.id;
        return categoryId && selectedCats.has(categoryId);
      });
    }
    // If all categories selected, no filtering needed

    // Filter by part type (internal/vendor)
    const showInternal = this.showInternal();
    const showVendor = this.showVendor();
    if (!showInternal && !showVendor) {
      filtered = [];
    } else if (!showInternal) {
      filtered = filtered.filter(part => part.internalPart === false);
    } else if (!showVendor) {
      filtered = filtered.filter(part => part.internalPart === true);
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
    this.router.navigate(['/parts/new']);
  }

  editPart(part: Part) {
    this.router.navigate(['/parts', part.id, 'edit']);
  }

  onRowMouseDown(event: MouseEvent) {
    if (event.button === 1) {
      event.preventDefault();
    }
  }

  onRowAuxClick(event: MouseEvent, part: Part) {
    if (event.button === 1) {
      event.preventDefault();
      window.open(`/#/parts/${part.id}/edit`, '_blank');
    }
  }

  deletePart(part: Part) {
    // This method is kept for potential future use, but delete is handled in the dialog
    console.log('Delete part:', part);
  }

  getCategoryBgColor(hexColor: string | null | undefined): string {
    if (!hexColor) return 'rgba(255, 255, 255, 0.2)';
    // Create a lighter background from the tag color
    return this.hexToRgba(hexColor, 0.2);
  }

  getCategoryTextColor(hexColor: string | null | undefined): string {
    return hexColor || '#808080';
  }

  private hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private getSortValue(part: Part, column: string): string | number | null {
    switch (column) {
      case 'category':
        return part.PartCategory?.name?.toLowerCase() ?? null;
      case 'createdAt':
        return part.createdAt ? new Date(part.createdAt).getTime() : null;
      default:
        const val = (part as any)[column];
        if (val === undefined || val === null) return null;
        if (typeof val === 'string') return val.toLowerCase();
        return val;
    }
  }
}
