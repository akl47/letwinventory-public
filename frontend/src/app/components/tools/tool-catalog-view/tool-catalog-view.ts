import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ToolsService } from '../../../services/tools.service';
import { Tool, ToolCategory, ToolSubcategory } from '../../../models/tool.model';

@Component({
  selector: 'app-tool-catalog-view',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatProgressSpinnerModule,
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
  displayedColumns = ['partName', 'description', 'subcategory', 'categories', 'diameter', 'flutes', 'material'];

  // Subcategory dropdown is filtered by chosen category to keep options manageable
  filteredSubcategories = computed(() => {
    const catId = this.categoryFilter();
    if (!catId) return this.subcategories();
    return this.subcategories().filter(s => (s.categories || []).some(c => c.id === catId));
  });

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
        (t.part?.description || '').toLowerCase().includes(search)
      );
    }
    return filtered;
  });

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
  }

  onCategoryFilterChange(id: number | null) {
    this.categoryFilter.set(id);
    // If the chosen subcategory no longer fits the new category filter, clear it
    const subId = this.subcategoryFilter();
    if (id && subId && !this.filteredSubcategories().some(s => s.id === subId)) {
      this.subcategoryFilter.set(null);
    }
  }

  openTool(tool: Tool) {
    if (tool.partID) {
      this.router.navigate(['/parts', tool.partID, 'edit']);
    }
  }

  formatDecimal(value: number | string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '';
    const n = typeof value === 'string' ? parseFloat(value) : value;
    return Number.isFinite(n) ? n.toString() : '';
  }

  formatCategories(tool: Tool): string {
    return (tool.toolSubcategory?.categories || []).map(c => c.name).join(' / ');
  }
}
