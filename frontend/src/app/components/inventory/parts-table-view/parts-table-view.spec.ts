import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { PartsTableView } from './parts-table-view';
import { InventoryService } from '../../../services/inventory.service';
import { ProjectService } from '../../../services/project.service';
import { Part, PartCategory } from '../../../models';

const mockCategories: PartCategory[] = [
  { id: 1, name: 'Connector', tagColorHex: 'FF0000', activeFlag: true, createdAt: '', updatedAt: '' },
  { id: 2, name: 'Wire', tagColorHex: '00FF00', activeFlag: true, createdAt: '', updatedAt: '' },
];

const mockParts: Part[] = [
  {
    id: 1, name: '000001', description: 'Test Connector', internalPart: false,
    vendor: 'Digi-Key', sku: 'DK-001', link: null, minimumOrderQuantity: 1, minimumStockQuantity: null,
    partCategoryID: 1, activeFlag: true, serialNumberRequired: false,
    lotNumberRequired: false, defaultUnitOfMeasureID: 1, manufacturer: 'TE',
    manufacturerPN: 'TE-001', revision: '00', revisionLocked: false, createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    PartCategory: { id: 1, name: 'Connector', tagColorHex: 'FF0000', activeFlag: true, createdAt: '', updatedAt: '' },
  },
];

describe('PartsTableView', () => {
  let component: PartsTableView;
  let fixture: ComponentFixture<PartsTableView>;
  let inventoryService: InventoryService;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PartsTableView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    router = TestBed.inject(Router);

    vi.spyOn(inventoryService, 'getPartCategories').mockReturnValue(of(mockCategories));
    vi.spyOn(inventoryService, 'getAllParts').mockReturnValue(of(mockParts));
    vi.spyOn(inventoryService, 'getStockLevels').mockReturnValue(of({ 1: 5 }));
    vi.spyOn(TestBed.inject(ProjectService), 'getProjects').mockReturnValue(of([
      { id: 1, name: 'Alpha', shortName: 'ALP', tagColorHex: 'FF0000', activeFlag: true },
      { id: 3, name: 'Gamma', shortName: 'GAM', tagColorHex: '0000FF', activeFlag: true },
      { id: 4, name: 'Retired', shortName: 'RET', tagColorHex: '999999', activeFlag: false },
    ] as any));
    vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));

    fixture = TestBed.createComponent(PartsTableView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads categories and parts on init', () => {
    expect(inventoryService.getPartCategories).toHaveBeenCalled();
    expect(inventoryService.getAllParts).toHaveBeenCalled();
    expect(component.categories().length).toBe(2);
    expect(component.allParts().length).toBe(1);
  });

  it('renders via <app-data-table> and not a raw <table mat-table>', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-data-table')).toBeTruthy();
    expect(el.querySelector(':scope > .parts-table-container > table[mat-table]')).toBeNull();
  });

  it('exposes filter sections including categories, partType, inactive, lowStock', () => {
    const keys = component.filterSections().map(s => s.key);
    expect(keys).toContain('categories');
    expect(keys).toContain('partType');
    expect(keys).toContain('inactive');
    expect(keys).toContain('lowStock');
    expect(keys).toContain('projects');
  });

  // REQ 1069 — filter the catalog by project
  it('offers every active project as a filter option, and matches a common part to all of them', () => {
    const alpha = { id: 1, name: 'Alpha', shortName: 'ALP', tagColorHex: 'FF0000' };
    const beta = { id: 2, name: 'Beta', shortName: 'BET', tagColorHex: '00FF00' };
    const inBeta = { ...mockParts[0], id: 10, projects: [beta] };
    const inBoth = { ...mockParts[0], id: 11, projects: [beta, alpha] };
    const common = { ...mockParts[0], id: 12, commonPart: true, projects: [] };
    component.allParts.set([inBeta, inBoth, common, mockParts[0]]);
    const section = component.filterSections().find(s => s.key === 'projects') as any;
    // Gamma has no parts but is still offered; Beta is not in the project list
    // (e.g. not visible to this user) but a part carries it.
    expect(section.options.map((o: { label: string }) => o.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(section.accessor(inBeta)).toEqual([2]);
    expect(section.accessor(inBoth)).toEqual([2, 1]);
    expect(section.accessor(common)).toEqual([1, 2, 3]);
    expect(section.accessor(mockParts[0])).toEqual([]);
  });

  // REQ 1072 — design quick link
  describe('design quick link', () => {
    const click = () => ({ stopPropagation: vi.fn(), preventDefault: vi.fn() }) as unknown as Event;

    it('opens the CAD model, assembly or harness editor for the part', () => {
      component.openDesign({ ...mockParts[0], id: 5, design: { kind: 'cad', id: 40 } }, click());
      expect(router.navigate).toHaveBeenLastCalledWith(['/parts', 5, 'cad', 'editor'], { queryParams: { revisionID: 40 } });
      component.openDesign({ ...mockParts[0], id: 6, design: { kind: 'assembly', id: 41 } }, click());
      expect(router.navigate).toHaveBeenLastCalledWith(['/parts', 6, 'assembly', 'editor']);
      component.openDesign({ ...mockParts[0], id: 7, design: { kind: 'harness', id: 42 } }, click());
      expect(router.navigate).toHaveBeenLastCalledWith(['/parts', 7, 'harness', 'editor'], { queryParams: { revisionID: 42 } });
    });

    it('keeps the click from also opening the part', () => {
      const event = click();
      component.openDesign({ ...mockParts[0], design: { kind: 'cad', id: 40 } }, event);
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('is the last column', () => {
      expect(component.columns[component.columns.length - 1].key).toBe('design');
    });

    it('shows the button only for parts that have a design', () => {
      component.allParts.set([
        { ...mockParts[0], id: 5, design: { kind: 'harness', id: 42 } },
        { ...mockParts[0], id: 6, design: null },
      ]);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="design-link-5"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="design-link-6"]')).toBeNull();
    });
  });

  // REQ 1069 — project tags in the catalog
  it('shows a tag per project and a Common tag, sorting common parts first', () => {
    const col = component.columns.find(c => c.key === 'projects')!;
    expect(col.header).toBe('Projects');
    const linked = { ...mockParts[0], commonPart: false, projects: [{ id: 2, name: 'Beta', shortName: 'BET', tagColorHex: '00FF00' }] };
    const common = { ...mockParts[0], id: 99, commonPart: true, projects: [] };
    expect(col.sortValue!(common)! < col.sortValue!(linked)!).toBe(true);
    expect(col.sortValue!(linked)! < col.sortValue!(mockParts[0])!).toBe(true);

    component.allParts.set([linked, common]);
    fixture.detectChanges();
    const tags = Array.from(fixture.nativeElement.querySelectorAll('.project-tags app-category-badge')).map((e: any) => e.textContent.trim());
    expect(tags).toEqual(expect.arrayContaining(['BET', 'Common']));
  });

  it('isLowStock returns false when minimumStockQuantity is null', () => {
    expect(component.isLowStock(mockParts[0])).toBe(false);
  });

  it('editPart navigates to the edit route', () => {
    component.editPart(mockParts[0]);
    expect(router.navigate).toHaveBeenCalledWith(['/parts', 1, 'edit']);
  });

  it('openNewPartDialog navigates to /parts/new', () => {
    component.openNewPartDialog();
    expect(router.navigate).toHaveBeenCalledWith(['/parts/new']);
  });

  it('rowHref returns the edit URL for a part', () => {
    expect(component.rowHref(mockParts[0])).toBe('/parts/1/edit');
  });
});
