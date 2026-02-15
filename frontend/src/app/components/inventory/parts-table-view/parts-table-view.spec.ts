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
  { id: 1, name: 'Connector', tagColorHex: '#FF0000', activeFlag: true, createdAt: '', updatedAt: '' },
  { id: 2, name: 'Wire', tagColorHex: '#00FF00', activeFlag: true, createdAt: '', updatedAt: '' },
  { id: 3, name: 'Cable', tagColorHex: '#0000FF', activeFlag: true, createdAt: '', updatedAt: '' },
];

const mockParts: Part[] = [
  {
    id: 1, name: '000001', description: 'Test Connector', internalPart: false,
    vendor: 'Digi-Key', sku: 'DK-001', link: null, minimumOrderQuantity: 1,
    partCategoryID: 1, activeFlag: true, serialNumberRequired: false,
    lotNumberRequired: false, defaultUnitOfMeasureID: 1, manufacturer: 'TE',
    manufacturerPN: 'TE-001', createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    PartCategory: { id: 1, name: 'Connector', tagColorHex: '#FF0000', activeFlag: true, createdAt: '', updatedAt: '' },
  },
  {
    id: 2, name: '000002', description: 'Test Wire', internalPart: true,
    vendor: '', sku: null, link: null, minimumOrderQuantity: 1,
    partCategoryID: 2, activeFlag: true, serialNumberRequired: false,
    lotNumberRequired: false, defaultUnitOfMeasureID: 1, manufacturer: null,
    manufacturerPN: null, createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    PartCategory: { id: 2, name: 'Wire', tagColorHex: '#00FF00', activeFlag: true, createdAt: '', updatedAt: '' },
  },
  {
    id: 3, name: '000003', description: 'Inactive Cable', internalPart: false,
    vendor: 'Mouser', sku: 'MO-001', link: null, minimumOrderQuantity: 5,
    partCategoryID: 3, activeFlag: false, serialNumberRequired: false,
    lotNumberRequired: false, defaultUnitOfMeasureID: 1, manufacturer: 'Belden',
    manufacturerPN: 'BL-001', createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
    PartCategory: { id: 3, name: 'Cable', tagColorHex: '#0000FF', activeFlag: true, createdAt: '', updatedAt: '' },
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
    vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));

    fixture = TestBed.createComponent(PartsTableView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('data loading', () => {
    it('should load categories on init', () => {
      expect(inventoryService.getPartCategories).toHaveBeenCalled();
      expect(component.categories().length).toBe(3);
    });

    it('should load parts on init', () => {
      expect(inventoryService.getAllParts).toHaveBeenCalled();
      expect(component.allParts().length).toBe(3);
    });

    it('should select all categories by default', () => {
      expect(component.selectedCategoryIds().size).toBe(3);
      expect(component.allCategoriesSelected()).toBe(true);
    });
  });

  describe('filtering', () => {
    it('should filter inactive parts by default', () => {
      // showInactive is false by default, so inactive parts are excluded
      const displayed = component.displayedParts();
      expect(displayed.every(p => p.activeFlag === true)).toBe(true);
    });

    it('should show inactive parts when toggle is on', () => {
      component.onToggleInactive(true);
      expect(component.showInactive()).toBe(true);
      const displayed = component.displayedParts();
      expect(displayed.length).toBe(3);
    });

    it('should filter by search text matching name', () => {
      component.onSearchChange('000001');
      const displayed = component.displayedParts();
      expect(displayed.length).toBe(1);
      expect(displayed[0].name).toBe('000001');
    });

    it('should filter by search text matching vendor', () => {
      component.onSearchChange('digi');
      const displayed = component.displayedParts();
      expect(displayed.length).toBe(1);
      expect(displayed[0].vendor).toBe('Digi-Key');
    });

    it('should filter by search text matching category name', () => {
      component.onSearchChange('wire');
      const displayed = component.displayedParts();
      expect(displayed.length).toBe(1);
      expect(displayed[0].PartCategory?.name).toBe('Wire');
    });

    it('should reset page index on search', () => {
      component.pageIndex.set(2);
      component.onSearchChange('test');
      expect(component.pageIndex()).toBe(0);
    });

    it('should filter by selected categories', () => {
      // Deselect all, then select only Connector
      component.selectedCategoryIds.set(new Set([1]));
      component.applyFiltersAndSort();
      const displayed = component.displayedParts();
      expect(displayed.length).toBe(1);
      expect(displayed[0].PartCategory?.name).toBe('Connector');
    });

    it('should show nothing when no categories selected', () => {
      component.selectedCategoryIds.set(new Set());
      component.applyFiltersAndSort();
      expect(component.displayedParts().length).toBe(0);
    });

    it('should filter by part type - internal only', () => {
      component.showVendor.set(false);
      component.applyFiltersAndSort();
      const displayed = component.displayedParts();
      expect(displayed.every(p => p.internalPart === true)).toBe(true);
    });

    it('should filter by part type - vendor only', () => {
      component.showInternal.set(false);
      component.applyFiltersAndSort();
      const displayed = component.displayedParts();
      expect(displayed.every(p => p.internalPart === false)).toBe(true);
    });

    it('should show nothing when both types are deselected', () => {
      component.showInternal.set(false);
      component.showVendor.set(false);
      component.applyFiltersAndSort();
      expect(component.displayedParts().length).toBe(0);
    });
  });

  describe('computed properties', () => {
    it('allCategoriesSelected should be true when all selected', () => {
      expect(component.allCategoriesSelected()).toBe(true);
    });

    it('allCategoriesSelected should be false when some deselected', () => {
      component.selectedCategoryIds.set(new Set([1]));
      expect(component.allCategoriesSelected()).toBe(false);
    });

    it('someCategoriesSelected should be true when some but not all selected', () => {
      component.selectedCategoryIds.set(new Set([1]));
      expect(component.someCategoriesSelected()).toBe(true);
    });

    it('someCategoriesSelected should be false when all selected', () => {
      expect(component.someCategoriesSelected()).toBe(false);
    });

    it('someCategoriesSelected should be false when none selected', () => {
      component.selectedCategoryIds.set(new Set());
      expect(component.someCategoriesSelected()).toBe(false);
    });

    it('selectedCategories should return selected category objects', () => {
      component.selectedCategoryIds.set(new Set([1, 3]));
      const selected = component.selectedCategories();
      expect(selected.length).toBe(2);
      expect(selected.map(c => c.name)).toContain('Connector');
      expect(selected.map(c => c.name)).toContain('Cable');
    });

    it('hiddenCategoryCount should return count of unselected', () => {
      component.selectedCategoryIds.set(new Set([1]));
      expect(component.hiddenCategoryCount()).toBe(2);
    });

    it('allTypesSelected should be true when both internal and vendor shown', () => {
      expect(component.allTypesSelected()).toBe(true);
    });

    it('someTypesSelected should be true when one type is hidden', () => {
      component.showInternal.set(false);
      expect(component.someTypesSelected()).toBe(true);
    });

    it('activeFilterCount should count hidden categories and types', () => {
      component.selectedCategoryIds.set(new Set([1])); // 2 hidden cats
      component.showInternal.set(false); // 1 hidden type
      expect(component.activeFilterCount()).toBe(3);
    });
  });

  describe('category toggle methods', () => {
    it('isCategorySelected should return correct value', () => {
      expect(component.isCategorySelected(1)).toBe(true);
      component.selectedCategoryIds.set(new Set([2]));
      expect(component.isCategorySelected(1)).toBe(false);
      expect(component.isCategorySelected(2)).toBe(true);
    });

    it('toggleCategory should add unselected category', () => {
      component.selectedCategoryIds.set(new Set([1, 2]));
      component.toggleCategory(3);
      expect(component.selectedCategoryIds().has(3)).toBe(true);
    });

    it('toggleCategory should remove selected category', () => {
      component.toggleCategory(1);
      expect(component.selectedCategoryIds().has(1)).toBe(false);
    });

    it('toggleAllCategories should deselect all when all selected', () => {
      component.toggleAllCategories();
      expect(component.selectedCategoryIds().size).toBe(0);
    });

    it('toggleAllCategories should select all when not all selected', () => {
      component.selectedCategoryIds.set(new Set([1]));
      component.toggleAllCategories();
      expect(component.selectedCategoryIds().size).toBe(3);
    });
  });

  describe('type toggle methods', () => {
    it('toggleInternal should flip the signal', () => {
      expect(component.showInternal()).toBe(true);
      component.toggleInternal();
      expect(component.showInternal()).toBe(false);
    });

    it('toggleVendor should flip the signal', () => {
      expect(component.showVendor()).toBe(true);
      component.toggleVendor();
      expect(component.showVendor()).toBe(false);
    });

    it('toggleAllTypes should deselect all when all selected', () => {
      component.toggleAllTypes();
      expect(component.showInternal()).toBe(false);
      expect(component.showVendor()).toBe(false);
    });

    it('toggleAllTypes should select all when not all selected', () => {
      component.showInternal.set(false);
      component.toggleAllTypes();
      expect(component.showInternal()).toBe(true);
      expect(component.showVendor()).toBe(true);
    });
  });

  describe('pagination', () => {
    it('onPageChange should update pageIndex and pageSize', () => {
      component.onPageChange({ pageIndex: 1, pageSize: 25, length: 100 });
      expect(component.pageIndex()).toBe(1);
      expect(component.pageSize()).toBe(25);
    });
  });

  describe('sorting', () => {
    it('onSortChange should update sortColumn and sortDirection', () => {
      component.onSortChange({ active: 'vendor', direction: 'desc' });
      expect(component.sortColumn()).toBe('vendor');
      expect(component.sortDirection()).toBe('desc');
    });
  });

  describe('getTotalCount', () => {
    it('should return count of active parts by default', () => {
      expect(component.getTotalCount()).toBe(2);
    });

    it('should return count of all parts when showInactive', () => {
      component.showInactive.set(true);
      expect(component.getTotalCount()).toBe(3);
    });

    it('should return filtered count when searching', () => {
      component.searchText.set('000001');
      expect(component.getTotalCount()).toBe(1);
    });
  });

  describe('navigation', () => {
    it('openNewPartDialog should navigate to /parts/new', () => {
      component.openNewPartDialog();
      expect(router.navigate).toHaveBeenCalledWith(['/parts/new']);
    });

    it('editPart should navigate to /parts/:id/edit', () => {
      component.editPart(mockParts[0]);
      expect(router.navigate).toHaveBeenCalledWith(['/parts', 1, 'edit']);
    });
  });

  describe('utility methods', () => {
    it('getCategoryBgColor should return rgba for valid hex', () => {
      expect(component.getCategoryBgColor('#FF0000')).toBe('rgba(255, 0, 0, 0.2)');
    });

    it('getCategoryBgColor should return fallback for null', () => {
      expect(component.getCategoryBgColor(null)).toBe('rgba(255, 255, 255, 0.2)');
    });

    it('getCategoryTextColor should return hex or fallback', () => {
      expect(component.getCategoryTextColor('#FF0000')).toBe('#FF0000');
      expect(component.getCategoryTextColor(null)).toBe('#808080');
    });

    it('onRowMouseDown should prevent default for middle click', () => {
      const event = new MouseEvent('mousedown', { button: 1 });
      vi.spyOn(event, 'preventDefault');
      component.onRowMouseDown(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('onRowAuxClick should open new tab for middle click', () => {
      const event = new MouseEvent('auxclick', { button: 1 });
      vi.spyOn(event, 'preventDefault');
      vi.spyOn(window, 'open');
      component.onRowAuxClick(event, mockParts[0]);
      expect(window.open).toHaveBeenCalledWith('/#/parts/1/edit', '_blank');
    });
  });
});
