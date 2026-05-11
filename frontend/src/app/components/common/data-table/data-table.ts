import {
  Component,
  ContentChildren,
  Directive,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  QueryList,
  SimpleChanges,
  TemplateRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { filterBySearch } from '../../../utils/search';

export interface ColumnDef<T> {
  key: string;
  header: string;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null | undefined;
}

export interface FilterOption {
  id: number | string;
  label: string;
  colorHex?: string;
}

export type FilterSection<T> =
  | {
      type: 'toggle';
      key: string;
      label: string;
      default?: boolean;
      predicate?: (row: T, value: boolean) => boolean;
    }
  | {
      type: 'multiSelect';
      key: string;
      label: string;
      options: FilterOption[];
      /**
       * Returns the row's value(s) compared against the selected option ids.
       * Returning an array (e.g. for M:N relationships) matches if any element
       * is in the selected set.
       */
      accessor: (row: T) => number | string | Array<number | string> | null | undefined;
    };

@Directive({
  selector: 'ng-template[appColumn]',
  standalone: true,
})
export class DataTableColumnDef {
  @Input('appColumn') key!: string;
  constructor(public template: TemplateRef<unknown>) {}
}

@Component({
  selector: 'app-data-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatCheckboxModule,
    MatDividerModule,
  ],
  templateUrl: './data-table.html',
  styleUrl: './data-table.css',
})
export class DataTable<T = unknown> implements OnInit, OnChanges {
  @Input({ required: true }) columns!: ColumnDef<T>[];
  @Input({ required: true }) data: T[] = [];
  @Input() filterSections?: FilterSection<T>[];
  @Input() searchKeys?: string[];
  @Input() searchPlaceholder = 'Search';
  @Input() defaultSort?: { key: string; dir: 'asc' | 'desc' };
  @Input() defaultPageSize = 10;
  @Input() pageSizeOptions: number[] = [5, 10, 25, 50, 100];
  @Input() rowHref?: (row: T) => string;
  @Input() extraFilter?: (row: T) => boolean;

  @Output() rowClick = new EventEmitter<T>();
  @Output() filterChange = new EventEmitter<Record<string, unknown>>();

  @ContentChildren(DataTableColumnDef) columnTemplates!: QueryList<DataTableColumnDef>;

  private router = inject(Router);
  private route = inject(ActivatedRoute);

  searchText = signal<string>('');
  sortColumn = signal<string>('');
  sortDirection = signal<'asc' | 'desc'>('asc');
  pageIndex = signal<number>(0);
  pageSize = signal<number>(10);
  filterValues = signal<Record<string, unknown>>({});

  private dataSig = signal<T[]>([]);
  private initialized = false;

  filteredAndSorted = computed<T[]>(() => {
    let rows = [...this.dataSig()];
    rows = this.applyFilterSections(rows);
    if (this.extraFilter) rows = rows.filter(r => this.extraFilter!(r));
    if (this.searchKeys && this.searchText()) {
      rows = filterBySearch(rows, this.searchText(), this.searchKeys);
    }
    rows = this.applySort(rows);
    return rows;
  });

  displayedRows = computed<T[]>(() => {
    const all = this.filteredAndSorted();
    const start = this.pageIndex() * this.pageSize();
    return all.slice(start, start + this.pageSize());
  });

  totalCount = computed<number>(() => this.filteredAndSorted().length);

  activeFilterCount = computed<number>(() => {
    if (!this.filterSections) return 0;
    let count = 0;
    const values = this.filterValues();
    for (const section of this.filterSections) {
      if (section.type === 'toggle') {
        const def = section.default ?? false;
        if (values[section.key] !== def) count++;
      } else {
        const sel = (values[section.key] as Set<number | string> | undefined) ?? new Set();
        count += section.options.length - sel.size;
      }
    }
    return count;
  });

  ngOnInit(): void {
    this.pageSize.set(this.defaultPageSize);
    if (this.defaultSort) {
      this.sortColumn.set(this.defaultSort.key);
      this.sortDirection.set(this.defaultSort.dir);
    }
    this.initFilterDefaults();
    this.hydrateFromUrl();
    this.dataSig.set(this.data || []);
    this.initialized = true;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && this.initialized) {
      this.dataSig.set(this.data || []);
    }
  }

  onSearchChange(value: string): void {
    this.searchText.set(value);
    this.pageIndex.set(0);
    this.writeUrl();
  }

  onSortChange(sort: { active: string; direction: string }): void {
    if (sort.direction === '') {
      if (this.defaultSort) {
        this.sortColumn.set(this.defaultSort.key);
        this.sortDirection.set(this.defaultSort.dir);
      } else {
        this.sortColumn.set('');
      }
    } else {
      this.sortColumn.set(sort.active);
      this.sortDirection.set(sort.direction as 'asc' | 'desc');
    }
    this.writeUrl();
  }

  onPageChange(event: { pageIndex: number; pageSize: number; length: number }): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.writeUrl();
  }

  setFilterValue(key: string, value: unknown): void {
    this.filterValues.update(v => ({ ...v, [key]: value }));
    this.pageIndex.set(0);
    this.writeUrl();
    this.filterChange.emit(this.filterValues());
  }

  toggleFilterSelection(sectionKey: string, optionId: number | string): void {
    const sel = this.filterValues()[sectionKey] as Set<number | string> | undefined;
    const newSet = new Set(sel ?? []);
    if (newSet.has(optionId)) newSet.delete(optionId);
    else newSet.add(optionId);
    this.setFilterValue(sectionKey, newSet);
  }

  toggleAll(sectionKey: string): void {
    const section = this.findSection(sectionKey);
    if (!section || section.type !== 'multiSelect') return;
    if (this.isAllSelected(sectionKey)) {
      this.setFilterValue(sectionKey, new Set());
    } else {
      this.setFilterValue(sectionKey, new Set(section.options.map(o => o.id)));
    }
  }

  isAllSelected(sectionKey: string): boolean {
    const section = this.findSection(sectionKey);
    if (!section || section.type !== 'multiSelect') return false;
    const sel = this.filterValues()[sectionKey] as Set<number | string> | undefined;
    return !!sel && sel.size === section.options.length;
  }

  isSomeSelected(sectionKey: string): boolean {
    const section = this.findSection(sectionKey);
    if (!section || section.type !== 'multiSelect') return false;
    const sel = this.filterValues()[sectionKey] as Set<number | string> | undefined;
    return !!sel && sel.size > 0 && sel.size < section.options.length;
  }

  isSelected(sectionKey: string, optionId: number | string): boolean {
    const sel = this.filterValues()[sectionKey] as Set<number | string> | undefined;
    return !!sel && sel.has(optionId);
  }

  hiddenOptionCount(sectionKey: string): number {
    const section = this.findSection(sectionKey);
    if (!section || section.type !== 'multiSelect') return 0;
    const sel = this.filterValues()[sectionKey] as Set<number | string> | undefined;
    return section.options.length - (sel?.size ?? 0);
  }

  onRowClick(row: T): void {
    this.rowClick.emit(row);
  }

  onRowMouseDown(event: MouseEvent): void {
    if (event.button === 1) event.preventDefault();
  }

  getColumnTemplate(key: string): TemplateRef<unknown> | null {
    if (!this.columnTemplates) return null;
    const found = this.columnTemplates.find(t => t.key === key);
    return found?.template ?? null;
  }

  getCellValue(row: T, key: string): string | number | null {
    const segments = key.split('.');
    let cur: unknown = row;
    for (const s of segments) {
      if (cur == null || typeof cur !== 'object') return '';
      cur = (cur as Record<string, unknown>)[s];
    }
    if (cur == null) return '';
    if (typeof cur === 'string' || typeof cur === 'number') return cur;
    return String(cur);
  }

  get columnKeys(): string[] {
    return this.columns.map(c => c.key);
  }

  isToggleSection(s: FilterSection<T>): s is FilterSection<T> & { type: 'toggle' } {
    return s.type === 'toggle';
  }

  isMultiSelectSection(s: FilterSection<T>): s is FilterSection<T> & { type: 'multiSelect' } {
    return s.type === 'multiSelect';
  }

  private findSection(key: string): FilterSection<T> | undefined {
    return this.filterSections?.find(s => s.key === key);
  }

  private initFilterDefaults(): void {
    if (!this.filterSections) return;
    const values: Record<string, unknown> = { ...this.filterValues() };
    for (const section of this.filterSections) {
      if (section.type === 'toggle') {
        values[section.key] = section.default ?? false;
      } else {
        values[section.key] = new Set(section.options.map(o => o.id));
      }
    }
    this.filterValues.set(values);
  }

  private hydrateFromUrl(): void {
    const params = this.route.snapshot.queryParams;
    if (params['search']) this.searchText.set(params['search']);
    if (params['sort']) this.sortColumn.set(params['sort']);
    if (params['dir'] === 'asc' || params['dir'] === 'desc') {
      this.sortDirection.set(params['dir']);
    }
    if (params['page']) this.pageIndex.set(parseInt(params['page'], 10) || 0);
    if (params['pageSize']) {
      this.pageSize.set(parseInt(params['pageSize'], 10) || this.defaultPageSize);
    }
    if (this.filterSections) {
      const values: Record<string, unknown> = { ...this.filterValues() };
      for (const section of this.filterSections) {
        const raw = params[section.key];
        if (raw === undefined) continue;
        if (section.type === 'toggle') {
          values[section.key] = raw === 'true';
        } else {
          const ids = String(raw)
            .split(',')
            .map(s => {
              const trimmed = s.trim();
              if (trimmed === '') return null;
              const n = Number(trimmed);
              return Number.isFinite(n) ? n : trimmed;
            })
            .filter((v): v is number | string => v !== null);
          values[section.key] = new Set(ids);
        }
      }
      this.filterValues.set(values);
    }
  }

  private writeUrl(): void {
    if (!this.initialized) return;
    const params: Record<string, string> = {};
    const s = this.searchText();
    if (s) params['search'] = s;

    const col = this.sortColumn();
    const dir = this.sortDirection();
    const defCol = this.defaultSort?.key ?? '';
    const defDir = this.defaultSort?.dir ?? 'asc';
    if (col && (col !== defCol || dir !== defDir)) {
      params['sort'] = col;
      params['dir'] = dir;
    }

    if (this.pageIndex() > 0) params['page'] = String(this.pageIndex());
    if (this.pageSize() !== this.defaultPageSize) params['pageSize'] = String(this.pageSize());

    if (this.filterSections) {
      const values = this.filterValues();
      for (const section of this.filterSections) {
        if (section.type === 'toggle') {
          const def = section.default ?? false;
          if (values[section.key] !== def) params[section.key] = String(values[section.key]);
        } else {
          const sel = values[section.key] as Set<number | string> | undefined;
          if (sel && sel.size < section.options.length) {
            params[section.key] = Array.from(sel).join(',');
          }
        }
      }
    }

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      replaceUrl: true,
    });
  }

  private applyFilterSections(rows: T[]): T[] {
    if (!this.filterSections) return rows;
    const values = this.filterValues();
    let out = rows;
    for (const section of this.filterSections) {
      const value = values[section.key];
      if (section.type === 'toggle') {
        if (section.predicate) {
          const pred = section.predicate;
          out = out.filter(r => pred(r, value as boolean));
        }
      } else {
        const sel = value as Set<number | string> | undefined;
        if (!sel) continue;
        if (sel.size === section.options.length) continue;
        out = out.filter(r => {
          const v = section.accessor(r);
          if (v === null || v === undefined) return false;
          if (Array.isArray(v)) return v.some(id => sel.has(id));
          return sel.has(v);
        });
      }
    }
    return out;
  }

  private applySort(rows: T[]): T[] {
    const col = this.sortColumn();
    if (!col) return rows;
    const dir = this.sortDirection();
    const colDef = this.columns.find(c => c.key === col);
    return [...rows].sort((a, b) => {
      const av = this.getSortValue(a, colDef);
      const bv = this.getSortValue(b, colDef);
      if (av == null && bv == null) return 0;
      if (av == null) return dir === 'asc' ? 1 : -1;
      if (bv == null) return dir === 'asc' ? -1 : 1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === 'asc' ? cmp : -cmp;
    });
  }

  private getSortValue(row: T, colDef?: ColumnDef<T>): string | number | null | undefined {
    if (!colDef) return null;
    if (colDef.sortValue) return colDef.sortValue(row);
    const v = this.getCellValue(row, colDef.key);
    if (typeof v === 'string') return v.toLowerCase();
    return v;
  }
}
