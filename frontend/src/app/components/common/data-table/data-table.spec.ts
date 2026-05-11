import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { DataTable, ColumnDef, FilterSection, DataTableColumnDef } from './data-table';

interface Row {
  id: number;
  name: string;
  description: string;
  category: { id: number; name: string };
  active: boolean;
  internal: boolean;
  stock: number;
}

const rows: Row[] = [
  { id: 1, name: 'Alpha', description: 'first',  category: { id: 1, name: 'Cat-A' }, active: true,  internal: true,  stock: 5  },
  { id: 2, name: 'Bravo', description: 'second', category: { id: 2, name: 'Cat-B' }, active: true,  internal: false, stock: 0  },
  { id: 3, name: 'Charlie', description: 'third', category: { id: 1, name: 'Cat-A' }, active: false, internal: true,  stock: 10 },
  { id: 4, name: 'Delta', description: 'fourth', category: { id: 3, name: 'Cat-C' }, active: true,  internal: false, stock: 2  },
];

const columns: ColumnDef<Row>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'description', header: 'Desc', sortable: true },
  { key: 'category', header: 'Category', sortable: true, sortValue: r => r.category.name.toLowerCase() },
  { key: 'stock', header: 'Stock', sortable: true },
];

const filterSections: FilterSection<Row>[] = [
  {
    type: 'toggle',
    key: 'inactive',
    label: 'Show Inactive',
    default: false,
    predicate: (row, on) => on || row.active,
  },
  {
    type: 'multiSelect',
    key: 'categories',
    label: 'Categories',
    options: [
      { id: 1, label: 'Cat-A', colorHex: '#ff0000' },
      { id: 2, label: 'Cat-B', colorHex: '#00ff00' },
      { id: 3, label: 'Cat-C', colorHex: '#0000ff' },
    ],
    accessor: r => r.category.id,
  },
];

@Component({
  standalone: true,
  imports: [DataTable, DataTableColumnDef],
  template: `
    <app-data-table
      [data]="data()"
      [columns]="columns"
      [searchKeys]="['name','description','category.name']"
      [filterSections]="filters"
      [defaultSort]="{ key: 'name', dir: 'asc' }"
      [rowHref]="rowHref"
      (rowClick)="onRowClick($event)"
    >
      <ng-template appColumn="name" let-row>
        <span class="cell-name"><strong>{{ row.name }}</strong></span>
      </ng-template>
      <ng-template appColumn="category" let-row>
        <span class="cell-cat">{{ row.category.name }}</span>
      </ng-template>
      <ng-template appColumn="stock" let-row>
        <span class="cell-stock" [class.low]="row.stock < 3">{{ row.stock }}</span>
      </ng-template>
    </app-data-table>
  `,
})
class HostComponent {
  data = signal(rows);
  columns = columns;
  filters = filterSections;
  rowHref = (r: Row) => `/items/${r.id}/edit`;
  clicked: Row | null = null;
  onRowClick(r: Row) { this.clicked = r; }
}

function setup(queryParams: Record<string, string> = {}) {
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [
      provideAnimationsAsync(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParams: of(queryParams), snapshot: { queryParams } } },
    ],
  });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const dataTable = fixture.debugElement.children[0].componentInstance as DataTable<Row>;
  return { fixture, host: fixture.componentInstance, dataTable };
}

describe('DataTable', () => {
  describe('rendering & column projection (REQ 507)', () => {
    it('renders one row per displayed item (default filter hides Charlie)', () => {
      const { fixture } = setup();
      const bodyRows = fixture.nativeElement.querySelectorAll('tbody tr.data-row');
      expect(bodyRows.length).toBe(3);
    });

    it('projects the appColumn template for the matching column key', () => {
      const { fixture } = setup();
      const nameCells = fixture.nativeElement.querySelectorAll('.cell-name');
      expect(nameCells.length).toBe(3);
      expect(nameCells[0].textContent).toContain('Alpha');
    });

    it('projects multiple distinct templates by key', () => {
      const { fixture } = setup();
      expect(fixture.nativeElement.querySelectorAll('.cell-cat').length).toBe(3);
      expect(fixture.nativeElement.querySelectorAll('.cell-stock').length).toBe(3);
    });

    it('falls back to the raw column value when no template is projected for that key', () => {
      // description column has no <ng-template appColumn="description">
      const { fixture } = setup();
      const descCells = fixture.nativeElement.querySelectorAll('td[data-col="description"]');
      expect(descCells.length).toBe(3);
      expect(Array.from(descCells).map((c: any) => c.textContent.trim())).toContain('first');
    });

    it('renders sortable header attributes for sortable columns', () => {
      const { fixture } = setup();
      const headers = fixture.nativeElement.querySelectorAll('th[mat-sort-header]');
      expect(headers.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('search', () => {
    it('filters rows by search across searchKeys', () => {
      const { dataTable } = setup();
      dataTable.onSearchChange('alpha');
      expect(dataTable.displayedRows().length).toBe(1);
      expect(dataTable.displayedRows()[0].name).toBe('Alpha');
    });

    it('searches dotted paths (category.name)', () => {
      const { dataTable } = setup();
      dataTable.onSearchChange('cat-b');
      expect(dataTable.displayedRows().length).toBe(1);
      expect(dataTable.displayedRows()[0].category.name).toBe('Cat-B');
    });

    it('search is case-insensitive and matches substring', () => {
      const { dataTable } = setup();
      dataTable.onSearchChange('ECON'); // matches "second" description
      expect(dataTable.displayedRows().some(r => r.description === 'second')).toBe(true);
    });

    it('resets pageIndex to 0 on search change', () => {
      const { dataTable } = setup();
      dataTable.pageIndex.set(2);
      dataTable.onSearchChange('a');
      expect(dataTable.pageIndex()).toBe(0);
    });
  });

  describe('sorting', () => {
    it('applies defaultSort on init', () => {
      const { dataTable } = setup();
      expect(dataTable.sortColumn()).toBe('name');
      expect(dataTable.sortDirection()).toBe('asc');
      expect(dataTable.displayedRows()[0].name).toBe('Alpha');
    });

    it('onSortChange updates state and re-sorts', () => {
      const { dataTable } = setup();
      dataTable.onSortChange({ active: 'stock', direction: 'desc' });
      expect(dataTable.sortColumn()).toBe('stock');
      expect(dataTable.sortDirection()).toBe('desc');
      // Bravo (0) is inactive=false so visible; sorted desc by stock: 10 (Charlie filtered out by default), 5, 2, 0
      // With default inactive=false predicate, Charlie hidden. So order: Alpha(5), Delta(2), Bravo(0)
      const names = dataTable.displayedRows().map(r => r.name);
      expect(names[0]).toBe('Alpha');
      expect(names[names.length - 1]).toBe('Bravo');
    });

    it('uses sortValue accessor when provided', () => {
      const { dataTable } = setup();
      dataTable.onSortChange({ active: 'category', direction: 'asc' });
      const cats = dataTable.displayedRows().map(r => r.category.name);
      expect(cats[0]).toBe('Cat-A');
    });

    it('clearing direction reverts to default sort', () => {
      const { dataTable } = setup();
      dataTable.onSortChange({ active: 'stock', direction: 'desc' });
      dataTable.onSortChange({ active: 'stock', direction: '' });
      expect(dataTable.sortColumn()).toBe('name');
      expect(dataTable.sortDirection()).toBe('asc');
    });
  });

  describe('pagination', () => {
    it('exposes pageIndex, pageSize, and totalCount', () => {
      const { dataTable } = setup();
      expect(dataTable.pageIndex()).toBe(0);
      expect(dataTable.pageSize()).toBeGreaterThanOrEqual(10);
      expect(dataTable.totalCount()).toBe(3); // Charlie hidden by default
    });

    it('onPageChange updates pageIndex and pageSize', () => {
      const { dataTable } = setup();
      dataTable.onPageChange({ pageIndex: 1, pageSize: 25, length: 100 });
      expect(dataTable.pageIndex()).toBe(1);
      expect(dataTable.pageSize()).toBe(25);
    });

    it('slices displayedRows to the page window', () => {
      const lots: Row[] = Array.from({ length: 12 }, (_, i) => ({
        id: 100 + i, name: `Row${i.toString().padStart(2,'0')}`, description: '',
        category: { id: 1, name: 'Cat-A' }, active: true, internal: true, stock: i,
      }));
      const { dataTable, host, fixture } = setup();
      host.data.set(lots);
      fixture.detectChanges();
      dataTable.onPageChange({ pageIndex: 0, pageSize: 5, length: 12 });
      expect(dataTable.displayedRows().length).toBe(5);
      dataTable.onPageChange({ pageIndex: 2, pageSize: 5, length: 12 });
      expect(dataTable.displayedRows().length).toBe(2);
    });

    it('totalCount reflects search-filtered total, not page size', () => {
      const { dataTable } = setup();
      dataTable.onSearchChange('alpha');
      expect(dataTable.totalCount()).toBe(1);
    });
  });

  describe('filter dropdown (REQ 508)', () => {
    it('initialises toggle filters to their default value', () => {
      const { dataTable } = setup();
      expect(dataTable.filterValues()['inactive']).toBe(false);
    });

    it('initialises multiSelect filters with all options selected', () => {
      const { dataTable } = setup();
      const selected = dataTable.filterValues()['categories'] as Set<number>;
      expect(selected instanceof Set).toBe(true);
      expect(selected.size).toBe(3);
    });

    it('applies toggle predicate to filter rows', () => {
      const { dataTable } = setup();
      // default: Charlie (inactive) hidden
      expect(dataTable.displayedRows().some(r => r.name === 'Charlie')).toBe(false);
      dataTable.setFilterValue('inactive', true);
      expect(dataTable.displayedRows().some(r => r.name === 'Charlie')).toBe(true);
    });

    it('multiSelect filters by accessor when not all options selected', () => {
      const { dataTable } = setup();
      dataTable.setFilterValue('categories', new Set([2]));
      expect(dataTable.displayedRows().length).toBe(1);
      expect(dataTable.displayedRows()[0].category.id).toBe(2);
    });

    it('multiSelect with empty selection produces zero rows', () => {
      const { dataTable } = setup();
      dataTable.setFilterValue('categories', new Set());
      expect(dataTable.displayedRows().length).toBe(0);
    });

    it('multiSelect helpers: allSelected / someSelected / hiddenCount', () => {
      const { dataTable } = setup();
      expect(dataTable.isAllSelected('categories')).toBe(true);
      expect(dataTable.isSomeSelected('categories')).toBe(false);
      dataTable.setFilterValue('categories', new Set([1]));
      expect(dataTable.isAllSelected('categories')).toBe(false);
      expect(dataTable.isSomeSelected('categories')).toBe(true);
      expect(dataTable.hiddenOptionCount('categories')).toBe(2);
    });

    it('activeFilterCount counts non-default filter values', () => {
      const { dataTable } = setup();
      expect(dataTable.activeFilterCount()).toBe(0);
      dataTable.setFilterValue('inactive', true);
      expect(dataTable.activeFilterCount()).toBe(1);
      dataTable.setFilterValue('categories', new Set([1]));
      // 2 hidden categories + 1 toggle flipped = 3
      expect(dataTable.activeFilterCount()).toBe(3);
    });

    it('filter changes reset pageIndex to 0', () => {
      const { dataTable } = setup();
      dataTable.pageIndex.set(2);
      dataTable.setFilterValue('inactive', true);
      expect(dataTable.pageIndex()).toBe(0);
    });

    it('renders a filter badge with the active filter count', () => {
      const { dataTable, fixture } = setup();
      dataTable.setFilterValue('categories', new Set([1]));
      fixture.detectChanges();
      const badge = fixture.nativeElement.querySelector('.filter-badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent.trim()).toBe('2');
    });
  });

  describe('URL query-parameter contract (REQ 509)', () => {
    it('hydrates state from initial query params', () => {
      const { dataTable } = setup({
        search: 'bravo',
        sort: 'stock',
        dir: 'desc',
        page: '1',
        pageSize: '25',
        inactive: 'true',
        categories: '1,2',
      });
      expect(dataTable.searchText()).toBe('bravo');
      expect(dataTable.sortColumn()).toBe('stock');
      expect(dataTable.sortDirection()).toBe('desc');
      expect(dataTable.pageIndex()).toBe(1);
      expect(dataTable.pageSize()).toBe(25);
      expect(dataTable.filterValues()['inactive']).toBe(true);
      expect(Array.from(dataTable.filterValues()['categories'] as Set<number>).sort()).toEqual([1, 2]);
    });

    function lastUrlParams(navSpy: ReturnType<typeof vi.spyOn>): Record<string, string> {
      const lastCall = navSpy.mock.calls.at(-1);
      if (!lastCall) throw new Error('expected router.navigate to be called');
      const extras = lastCall[1] as { queryParams?: Record<string, string> } | undefined;
      return (extras?.queryParams ?? {}) as Record<string, string>;
    }

    it('writes search/sort/page/pageSize to URL on change', async () => {
      const { dataTable, fixture } = setup();
      const router = TestBed.inject(Router);
      const navSpy = vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));
      dataTable.onSearchChange('alpha');
      await fixture.whenStable();
      expect(navSpy).toHaveBeenCalled();
      expect(lastUrlParams(navSpy)['search']).toBe('alpha');
    });

    it('omits default values from the URL', async () => {
      const { dataTable, fixture } = setup();
      const router = TestBed.inject(Router);
      const navSpy = vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));
      dataTable.onSearchChange('alpha');
      dataTable.onSearchChange('');
      await fixture.whenStable();
      const params = lastUrlParams(navSpy);
      expect(params['search']).toBeUndefined();
      expect(params['page']).toBeUndefined();    // pageIndex=0 is default
      expect(params['pageSize']).toBeUndefined(); // default size
      expect(params['sort']).toBeUndefined();     // matches defaultSort
      expect(params['dir']).toBeUndefined();
    });

    it('serialises multiSelect as comma-separated ids when not all selected', async () => {
      const { dataTable, fixture } = setup();
      const router = TestBed.inject(Router);
      const navSpy = vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));
      dataTable.setFilterValue('categories', new Set([1, 3]));
      await fixture.whenStable();
      const params = lastUrlParams(navSpy);
      const ids = (params['categories'] || '').split(',').map(Number).sort();
      expect(ids).toEqual([1, 3]);
    });

    it('omits multiSelect from URL when all options selected (default)', async () => {
      const { dataTable, fixture } = setup();
      const router = TestBed.inject(Router);
      const navSpy = vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));
      dataTable.setFilterValue('categories', new Set([1]));
      dataTable.setFilterValue('categories', new Set([1, 2, 3]));
      await fixture.whenStable();
      const params = lastUrlParams(navSpy);
      expect(params['categories']).toBeUndefined();
    });

    it('round-trips: hydrate -> mutate -> URL reflects new state', async () => {
      const { dataTable, fixture } = setup({ search: 'alpha' });
      const router = TestBed.inject(Router);
      const navSpy = vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));
      expect(dataTable.searchText()).toBe('alpha');
      dataTable.onSortChange({ active: 'stock', direction: 'desc' });
      await fixture.whenStable();
      const params = lastUrlParams(navSpy);
      expect(params['search']).toBe('alpha');
      expect(params['sort']).toBe('stock');
      expect(params['dir']).toBe('desc');
    });
  });

  describe('row click & middle-click', () => {
    it('emits rowClick for left-click', () => {
      const { dataTable, host } = setup();
      dataTable.onRowClick(rows[0]);
      expect(host.clicked).toBe(rows[0]);
    });

    it('mousedown with button=1 prevents default (suppresses middle-click scroll)', () => {
      const { dataTable } = setup();
      const event = new MouseEvent('mousedown', { button: 1 });
      vi.spyOn(event, 'preventDefault');
      dataTable.onRowMouseDown(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('mousedown with button=0 does not prevent default', () => {
      const { dataTable } = setup();
      const event = new MouseEvent('mousedown', { button: 0 });
      vi.spyOn(event, 'preventDefault');
      dataTable.onRowMouseDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('renders a row-overlay anchor in the first cell pointing at rowHref', () => {
      const { fixture } = setup();
      const overlay = fixture.nativeElement.querySelector('a.row-overlay') as HTMLAnchorElement | null;
      expect(overlay).toBeTruthy();
      // Anchor uses hash routing so the browser opens the right route in a new tab.
      expect(overlay!.getAttribute('href')).toBe('/#/items/1/edit');
    });

    it('row-overlay anchor preventsDefault on left-click so the row click handler runs', () => {
      const { fixture, host } = setup();
      const overlay = fixture.nativeElement.querySelector('a.row-overlay') as HTMLAnchorElement;
      overlay.click();
      // Click bubbles to the row, which emits rowClick; default nav suppressed.
      expect(host.clicked).toBe(rows[0]);
    });
  });
});
