import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { InventoryHigherarchyView } from './inventory-higherarchy-view';
import { InventoryService, InventoryTag } from '../../../services/inventory.service';

const mockTags: InventoryTag[] = [
  { id: 1, barcode: 'LOC-001', parentBarcodeID: 0, barcodeCategoryID: 1, activeFlag: true, name: 'Warehouse', type: 'Location', item_id: 1 },
  { id: 2, barcode: 'BOX-001', parentBarcodeID: 1, barcodeCategoryID: 2, activeFlag: true, name: 'Shelf A', type: 'Box', item_id: 1 },
  { id: 3, barcode: 'BOX-002', parentBarcodeID: 1, barcodeCategoryID: 2, activeFlag: true, name: 'Shelf B', type: 'Box', item_id: 2 },
  { id: 4, barcode: 'TRC-001', parentBarcodeID: 2, barcodeCategoryID: 3, activeFlag: true, name: 'Resistor 100R', type: 'Trace', item_id: 1 },
  { id: 5, barcode: 'EQP-001', parentBarcodeID: 1, barcodeCategoryID: 4, activeFlag: true, name: 'Oscilloscope', type: 'Equipment', item_id: 1 },
];

describe('InventoryHigherarchyView', () => {
  let component: InventoryHigherarchyView;
  let fixture: ComponentFixture<InventoryHigherarchyView>;
  let inventoryService: InventoryService;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryHigherarchyView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            queryParams: of({}),
            snapshot: { queryParams: {} },
          },
        },
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    router = TestBed.inject(Router);

    vi.spyOn(inventoryService, 'getAllTags').mockReturnValue(of(mockTags as any));
    vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));

    fixture = TestBed.createComponent(InventoryHigherarchyView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('data loading', () => {
    it('should load tags on init', () => {
      expect(inventoryService.getAllTags).toHaveBeenCalled();
    });

    it('should build tree from flat tags', () => {
      const tree = component.treeData();
      expect(tree.length).toBe(1); // One root: Warehouse (LOC-001)
      expect(tree[0].name).toBe('Warehouse');
    });

    it('should nest children under parent', () => {
      const tree = component.treeData();
      const warehouse = tree[0];
      // Warehouse has 3 children: Shelf A, Shelf B, Oscilloscope
      expect(warehouse.children?.length).toBe(3);
    });

    it('should nest deeply', () => {
      const tree = component.treeData();
      const shelfA = tree[0].children?.find(c => c.name === 'Shelf A');
      expect(shelfA?.children?.length).toBe(1); // TRC-001 under BOX-001
      expect(shelfA?.children?.[0].name).toBe('Resistor 100R');
    });
  });

  describe('search', () => {
    it('onSearchChange should filter tree', () => {
      component.onSearchChange('Resistor');
      const tree = component.treeData();
      // Should include the path from root to the match
      expect(tree.length).toBeGreaterThan(0);
    });

    it('onSearchChange should expand matching path', () => {
      component.onSearchChange('Resistor');
      expect(component.expandedPath().length).toBeGreaterThan(0);
    });

    it('empty search should show full tree', () => {
      component.onSearchChange('Resistor');
      component.onSearchChange('');
      const tree = component.treeData();
      expect(tree[0].name).toBe('Warehouse');
      expect(component.expandedPath().length).toBe(0);
    });

    it('search with no matches should return empty tree', () => {
      component.onSearchChange('ZZZZNOEXIST');
      expect(component.treeData().length).toBe(0);
    });

    it('search by barcode should work', () => {
      component.onSearchChange('BOX-002');
      const tree = component.treeData();
      expect(tree.length).toBeGreaterThan(0);
    });
  });

  describe('equipment filter', () => {
    it('should show equipment by default', () => {
      expect(component.showEquipment()).toBe(true);
      const tree = component.treeData();
      const warehouse = tree[0];
      const hasEquipment = warehouse.children?.some(c => c.type === 'Equipment');
      expect(hasEquipment).toBe(true);
    });

    it('onShowEquipmentChange should hide equipment', () => {
      component.onShowEquipmentChange(false);
      expect(component.showEquipment()).toBe(false);
      const tree = component.treeData();
      const warehouse = tree[0];
      const hasEquipment = warehouse.children?.some(c => c.type === 'Equipment');
      expect(hasEquipment).toBe(false);
    });

    it('onShowEquipmentChange should re-show equipment', () => {
      component.onShowEquipmentChange(false);
      component.onShowEquipmentChange(true);
      const tree = component.treeData();
      const warehouse = tree[0];
      const hasEquipment = warehouse.children?.some(c => c.type === 'Equipment');
      expect(hasEquipment).toBe(true);
    });
  });

  describe('onBarcodeSelected', () => {
    it('should set selectedBarcodeId', () => {
      component.onBarcodeSelected(3);
      expect(component.selectedBarcodeId()).toBe(3);
    });

    it('should navigate with barcode query param', () => {
      component.onBarcodeSelected(3);
      expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({
        queryParams: { barcode: 3 },
        queryParamsHandling: 'merge',
      }));
    });
  });

  describe('refreshData', () => {
    it('should reload tags', () => {
      component.refreshData();
      expect(inventoryService.getAllTags).toHaveBeenCalledTimes(2);
    });
  });

  describe('signal defaults', () => {
    it('should have empty search by default', () => {
      expect(component.searchText()).toBe('');
    });

    it('should have null selectedBarcodeId by default', () => {
      expect(component.selectedBarcodeId()).toBeNull();
    });

    it('should show equipment by default', () => {
      expect(component.showEquipment()).toBe(true);
    });
  });
});
