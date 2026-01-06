import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';

import { PartsTableView } from './parts-table-view';
import { InventoryService, Part } from '../../../services/inventory.service';

describe('PartsTableView', () => {
  let component: PartsTableView;
  let fixture: ComponentFixture<PartsTableView>;
  let inventoryServiceSpy: jasmine.SpyObj<InventoryService>;

  const mockParts: Part[] = [
    {
      id: 1,
      name: 'Part A',
      description: 'Description A',
      internalPart: true,
      vendor: 'Vendor A',
      sku: 'SKU-001',
      link: 'http://example.com/a',
      activeFlag: true,
      minimumOrderQuantity: 5,
      partCategoryID: 1,
      Traces: []
    },
    {
      id: 2,
      name: 'Part B',
      description: 'Description B',
      internalPart: false,
      vendor: 'Vendor B',
      sku: 'SKU-002',
      link: 'http://example.com/b',
      activeFlag: true,
      minimumOrderQuantity: 10,
      partCategoryID: 2,
      Traces: []
    }
  ];

  beforeEach(async () => {
    inventoryServiceSpy = jasmine.createSpyObj('InventoryService', [
      'getAllParts',
      'createPart',
      'updatePart',
      'deletePart'
    ]);
    inventoryServiceSpy.getAllParts.and.returnValue(of(mockParts));

    await TestBed.configureTestingModule({
      imports: [PartsTableView, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: InventoryService, useValue: inventoryServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(PartsTableView);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should load parts on init', () => {
      expect(inventoryServiceSpy.getAllParts).toHaveBeenCalled();
    });

    it('should populate data source with parts', () => {
      expect(component.dataSource.data.length).toBe(2);
    });
  });

  describe('filtering', () => {
    it('should filter parts by name', () => {
      component.applyFilter({ target: { value: 'Part A' } } as any);
      expect(component.dataSource.filter).toBe('part a');
    });

    it('should handle empty filter', () => {
      component.applyFilter({ target: { value: '' } } as any);
      expect(component.dataSource.filter).toBe('');
    });

    it('should trim and lowercase filter value', () => {
      component.applyFilter({ target: { value: '  PART B  ' } } as any);
      expect(component.dataSource.filter).toBe('part b');
    });
  });

  describe('CRUD operations', () => {
    it('should refresh data after creating a part', () => {
      inventoryServiceSpy.createPart.and.returnValue(of({} as Part));

      component.loadParts();

      expect(inventoryServiceSpy.getAllParts).toHaveBeenCalled();
    });

    it('should handle error when loading parts fails', () => {
      inventoryServiceSpy.getAllParts.and.returnValue(throwError(() => new Error('Load failed')));
      const consoleSpy = spyOn(console, 'error');

      component.loadParts();

      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('table functionality', () => {
    it('should have correct displayed columns', () => {
      expect(component.displayedColumns).toContain('name');
      expect(component.displayedColumns).toContain('vendor');
    });

    it('should compute total quantity from traces', () => {
      const partWithTraces = {
        ...mockParts[0],
        Traces: [
          { quantity: 5 },
          { quantity: 10 }
        ]
      };

      const quantity = component.getQuantity(partWithTraces as any);
      expect(quantity).toBe(15);
    });

    it('should return 0 for parts without traces', () => {
      const quantity = component.getQuantity(mockParts[0] as any);
      expect(quantity).toBe(0);
    });
  });
});
