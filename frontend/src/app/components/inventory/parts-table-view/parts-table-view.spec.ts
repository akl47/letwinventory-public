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
