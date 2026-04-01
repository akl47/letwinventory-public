import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { BuildListView } from './build-list-view';
import { InventoryService } from '../../../services/inventory.service';

const mockBuilds = [
  { id: 1, barcodeID: 10, barcode: 'AKL-000010', partID: 1, partName: 'Motor Kit', categoryName: 'Kit', categoryColor: '#4CAF50', status: 'partial', bomTotal: 3, bomFulfilled: 1, createdAt: '2026-03-30T10:00:00Z' },
  { id: 2, barcodeID: 20, barcode: 'AKL-000020', partID: 2, partName: 'Sensor Assembly', categoryName: 'Assembly', categoryColor: '#2196F3', status: 'partial', bomTotal: 5, bomFulfilled: 3, createdAt: '2026-03-30T11:00:00Z' },
];

describe('BuildListView', () => {
  let component: BuildListView;
  let fixture: ComponentFixture<BuildListView>;
  let inventoryService: InventoryService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BuildListView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    vi.spyOn(inventoryService, 'getInProgressBuilds').mockReturnValue(of(mockBuilds));

    fixture = TestBed.createComponent(BuildListView);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load builds on init', () => {
    expect(inventoryService.getInProgressBuilds).toHaveBeenCalled();
    expect(component.builds().length).toBe(2);
    expect(component.isLoading()).toBe(false);
  });

  it('should display all builds when no search', () => {
    expect(component.displayedBuilds().length).toBe(2);
  });

  it('should filter builds by part name', () => {
    component.onSearchChange('motor');
    expect(component.displayedBuilds().length).toBe(1);
    expect(component.displayedBuilds()[0].partName).toBe('Motor Kit');
  });

  it('should filter builds by category', () => {
    component.onSearchChange('assembly');
    expect(component.displayedBuilds().length).toBe(1);
    expect(component.displayedBuilds()[0].categoryName).toBe('Assembly');
  });

  it('should filter builds by barcode', () => {
    component.onSearchChange('AKL-000010');
    expect(component.displayedBuilds().length).toBe(1);
  });

  it('should show empty results for no matches', () => {
    component.onSearchChange('nonexistent');
    expect(component.displayedBuilds().length).toBe(0);
  });

  it('should default showCompleted to false', () => {
    expect(component.showCompleted()).toBe(false);
  });

  it('should reload builds with includeCompleted when toggled', () => {
    component.toggleShowCompleted();
    expect(component.showCompleted()).toBe(true);
    expect(inventoryService.getInProgressBuilds).toHaveBeenCalledWith(true);
  });
});
