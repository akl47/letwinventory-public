import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ToolsService } from '../../../services/tools.service';
import { Tool, ToolCategory, ToolSubcategory } from '../../../models/tool.model';
import { CategoryBadge } from '../../common/category-badge/category-badge';
import { DataTable, DataTableColumnDef, ColumnDef, FilterSection } from '../../common/data-table/data-table';

const INCH_PER_MM = 1 / 25.4;

@Component({
  selector: 'app-tool-catalog-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatIconModule,
    MatProgressSpinnerModule,
    CategoryBadge,
    DataTable,
    DataTableColumnDef,
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
  toolsLoaded = signal(false);
  categoriesLoaded = signal(false);
  subcategoriesLoaded = signal(false);
  ready = computed(() => this.toolsLoaded() && this.categoriesLoaded() && this.subcategoriesLoaded());

  toolUnit = signal<'mm' | 'in'>(
    (typeof localStorage !== 'undefined' && localStorage.getItem('toolUnit') === 'in') ? 'in' : 'mm',
  );

  columns: ColumnDef<Tool>[] = [
    { key: 'partName', header: 'Part #', sortable: true, sortValue: t => t.part?.name?.toLowerCase() ?? null },
    { key: 'description', header: 'Description', sortable: true, sortValue: t => t.part?.description?.toLowerCase() ?? null },
    { key: 'subcategory', header: 'Subcategory', sortable: true, sortValue: t => t.toolSubcategory?.name?.toLowerCase() ?? null },
    { key: 'categories', header: 'Categories', sortable: true, sortValue: t => this.formatCategories(t).toLowerCase() },
    { key: 'diameter', header: 'Diameter', sortable: true, sortValue: t => t.diameter !== null && t.diameter !== undefined ? Number(t.diameter) : null },
    { key: 'flutes', header: '# Flutes', sortable: true, sortValue: t => t.numberOfFlutes ?? null },
    { key: 'material', header: 'Material', sortable: true, sortValue: t => t.toolMaterial?.toLowerCase() ?? null },
  ];

  filterSections = computed<FilterSection<Tool>[]>(() => [
    {
      type: 'multiSelect',
      key: 'categories',
      label: 'Categories',
      options: this.categories().map(c => ({ id: c.id, label: c.name })),
      accessor: (t: Tool) => (t.toolSubcategory?.categories || []).map(c => c.id),
    },
    {
      type: 'multiSelect',
      key: 'subcategories',
      label: 'Subcategories',
      options: this.subcategories().map(s => ({ id: s.id, label: s.name })),
      accessor: (t: Tool) => t.toolSubcategoryID ?? null,
    },
  ]);

  searchKeys = ['part.name', 'part.description'];

  rowHref = (t: Tool) => t.partID ? `/parts/${t.partID}/edit` : '';

  ngOnInit() {
    this.toolsService.getToolCategories().subscribe({
      next: cats => {
        this.categories.set(cats);
        this.categoriesLoaded.set(true);
      },
      error: () => this.categoriesLoaded.set(true),
    });
    this.toolsService.getToolSubcategories().subscribe({
      next: subs => {
        this.subcategories.set(subs);
        this.subcategoriesLoaded.set(true);
      },
      error: () => this.subcategoriesLoaded.set(true),
    });
    this.toolsService.getTools().subscribe({
      next: tools => {
        this.tools.set(tools);
        this.toolsLoaded.set(true);
      },
      error: () => this.toolsLoaded.set(true),
    });
  }

  onUnitToggle(unit: 'mm' | 'in') {
    if (unit === this.toolUnit()) return;
    this.toolUnit.set(unit);
    if (typeof localStorage !== 'undefined') localStorage.setItem('toolUnit', unit);
  }

  openTool(tool: Tool) {
    if (tool.partID) this.router.navigate(['/parts', tool.partID, 'edit']);
  }

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
}
