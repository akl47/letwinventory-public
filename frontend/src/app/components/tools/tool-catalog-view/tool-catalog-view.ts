import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { ToolsService } from '../../../services/tools.service';
import { Tool, ToolCategory, ToolSubcategory } from '../../../models/tool.model';
import { CategoryBadge } from '../../common/category-badge/category-badge';

const INCH_PER_MM = 1 / 25.4;

@Component({
  selector: 'app-tool-catalog-view',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatButtonModule, MatSlideToggleModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatProgressSpinnerModule, MatSortModule, MatPaginatorModule,
    CategoryBadge,
  ],
  templateUrl: './tool-catalog-view.html',
  styleUrl: './tool-catalog-view.css',
})
export class ToolCatalogView implements OnInit {
  private router = inject(Router);
  private toolsService = inject(ToolsService);

  tools = signal<Tool[]>([]);
  categories = signal<ToolCategory[]>([]);
  subcategories = signal<ToolSubcategory[]>([]);
  isLoading = signal(true);
  searchText = signal('');
  categoryFilter = signal<number | null>(null);
  subcategoryFilter = signal<number | null>(null);

  // Sort state — defaults to ascending diameter
  sortField = signal<string>('diameter');
  sortDirection = signal<'asc' | 'desc' | ''>('asc');

  // Pagination state
  pageIndex = signal(0);
  pageSize = signal(25);
  pageSizeOptions = [10, 25, 50, 100];

  // mm/in toggle — DB always stores mm. Persisted per-user in localStorage.
  toolUnit = signal<'mm' | 'in'>(
    (typeof localStorage !== 'undefined' && localStorage.getItem('toolUnit') === 'in') ? 'in' : 'mm',
  );

  displayedColumns = ['partName', 'description', 'subcategory', 'categories', 'diameter', 'flutes', 'material'];

  // Subcategory dropdown is filtered by chosen category to keep options manageable
  filteredSubcategories = computed(() => {
    const catId = this.categoryFilter();
    if (!catId) return this.subcategories();
    return this.subcategories().filter(s => (s.categories || []).some(c => c.id === catId));
  });

  /** Filtered (search + category + subcategory) — primary signal used by tests. */
  displayedTools = computed(() => {
    let filtered = this.tools();
    const cat = this.categoryFilter();
    if (cat) {
      filtered = filtered.filter(t =>
        (t.toolSubcategory?.categories || []).some(c => c.id === cat),
      );
    }
    const sub = this.subcategoryFilter();
    if (sub) filtered = filtered.filter(t => t.toolSubcategoryID === sub);
    const search = this.searchText().trim().toLowerCase();
    if (search) {
      filtered = filtered.filter(t =>
        (t.part?.name || '').toLowerCase().includes(search) ||
        (t.part?.description || '').toLowerCase().includes(search),
      );
    }
    return filtered;
  });

  /** Filtered + sorted. Always sorts by canonical (mm) values regardless of display unit. */
  sortedTools = computed(() => {
    const data = [...this.displayedTools()];
    const field = this.sortField();
    const dir = this.sortDirection();
    if (!field || !dir) return data;
    const mul = dir === 'asc' ? 1 : -1;
    data.sort((a, b) => mul * this.compareTools(a, b, field));
    return data;
  });

  /** Sorted + paginated — bound to the table's [dataSource]. */
  paginatedTools = computed(() => {
    const data = this.sortedTools();
    const start = this.pageIndex() * this.pageSize();
    return data.slice(start, start + this.pageSize());
  });

  totalCount = computed(() => this.sortedTools().length);

  constructor() {
    // Whenever any filter changes the result count, snap pageIndex back into range.
    effect(() => {
      const total = this.totalCount();
      const pages = Math.max(1, Math.ceil(total / this.pageSize()));
      if (this.pageIndex() >= pages) this.pageIndex.set(0);
    });
  }

  ngOnInit() {
    this.toolsService.getToolCategories().subscribe({
      next: cats => this.categories.set(cats),
    });
    this.toolsService.getToolSubcategories().subscribe({
      next: subs => this.subcategories.set(subs),
    });
    this.toolsService.getTools().subscribe({
      next: tools => {
        this.tools.set(tools);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  onSearchChange(value: string) {
    this.searchText.set(value);
    this.pageIndex.set(0);
  }

  onCategoryFilterChange(id: number | null) {
    this.categoryFilter.set(id);
    this.pageIndex.set(0);
    // If the chosen subcategory no longer fits the new category filter, clear it
    const subId = this.subcategoryFilter();
    if (id && subId && !this.filteredSubcategories().some(s => s.id === subId)) {
      this.subcategoryFilter.set(null);
    }
  }

  onSubcategoryFilterChange(id: number | null) {
    this.subcategoryFilter.set(id);
    this.pageIndex.set(0);
  }

  onSortChange(sort: Sort) {
    this.sortField.set(sort.active);
    this.sortDirection.set(sort.direction);
    this.pageIndex.set(0);
  }

  onPageChange(event: PageEvent) {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }

  onUnitToggle(unit: 'mm' | 'in') {
    if (unit === this.toolUnit()) return;
    this.toolUnit.set(unit);
    if (typeof localStorage !== 'undefined') localStorage.setItem('toolUnit', unit);
  }

  openTool(tool: Tool) {
    if (tool.partID) {
      this.router.navigate(['/parts', tool.partID, 'edit']);
    }
  }

  /** Render a stored-mm value in the currently-selected display unit. */
  displayLength(mm: number | string | null | undefined): string {
    if (mm === null || mm === undefined || mm === '') return '';
    const n = typeof mm === 'string' ? parseFloat(mm) : mm;
    if (!Number.isFinite(n)) return '';
    const v = this.toolUnit() === 'in' ? n * INCH_PER_MM : n;
    return (Math.round(v * 1000) / 1000).toString();
  }

  formatCategories(tool: Tool): string {
    return (tool.toolSubcategory?.categories || []).map(c => c.name).join(' / ');
  }

  /** Comparator used by sortedTools; null/undefined values sort to the bottom. */
  private compareTools(a: Tool, b: Tool, field: string): number {
    const av = this.sortValue(a, field);
    const bv = this.sortValue(b, field);
    const aIsNull = av === null || av === undefined || av === '';
    const bIsNull = bv === null || bv === undefined || bv === '';
    if (aIsNull && bIsNull) return 0;
    if (aIsNull) return 1;
    if (bIsNull) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
  }

  private sortValue(t: Tool, field: string): number | string | null {
    switch (field) {
      case 'partName':    return t.part?.name ?? null;
      case 'description': return t.part?.description ?? null;
      case 'subcategory': return t.toolSubcategory?.name ?? null;
      case 'categories':  return this.formatCategories(t);
      case 'diameter':    return t.diameter !== null && t.diameter !== undefined
                                  ? Number(t.diameter) : null;
      case 'flutes':      return t.numberOfFlutes ?? null;
      case 'material':    return t.toolMaterial ?? null;
      default:            return null;
    }
  }
}
