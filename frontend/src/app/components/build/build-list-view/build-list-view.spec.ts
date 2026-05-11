import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute } from '@angular/router';
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
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} }, queryParams: of({}) } },
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    vi.spyOn(inventoryService, 'getInProgressBuilds').mockReturnValue(of(mockBuilds));

    fixture = TestBed.createComponent(BuildListView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads builds on init (active-only by default)', () => {
    expect(inventoryService.getInProgressBuilds).toHaveBeenCalledWith(false);
    expect(component.builds().length).toBe(2);
    expect(component.isLoading()).toBe(false);
  });

  it('renders via <app-data-table>', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-data-table')).toBeTruthy();
  });

  it('exposes a filter section to show completed builds', () => {
    const keys = component.filterSections.map(s => s.key);
    expect(keys).toContain('completed');
  });

  it('defaults showCompleted to false', () => {
    expect(component.showCompleted()).toBe(false);
  });
});
