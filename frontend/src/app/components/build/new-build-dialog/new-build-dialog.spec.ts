import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { NewBuildDialog } from './new-build-dialog';
import { InventoryService } from '../../../services/inventory.service';
import { Part } from '../../../models';

const mockParts: Part[] = [
  { id: 1, name: 'Motor Kit', description: 'Kit', internalPart: true, vendor: '', sku: null, link: null, minimumOrderQuantity: 1, minimumStockQuantity: null, partCategoryID: 3, activeFlag: true, serialNumberRequired: false, lotNumberRequired: false, defaultUnitOfMeasureID: 1, manufacturer: null, manufacturerPN: null, revision: '00', revisionLocked: false, createdAt: '', updatedAt: '', PartCategory: { id: 3, name: 'Kit', tagColorHex: '#4CAF50', activeFlag: true, createdAt: '', updatedAt: '' } },
  { id: 2, name: 'Regular Part', description: 'Not a kit', internalPart: false, vendor: 'V', sku: null, link: null, minimumOrderQuantity: 1, minimumStockQuantity: null, partCategoryID: 1, activeFlag: true, serialNumberRequired: false, lotNumberRequired: false, defaultUnitOfMeasureID: 1, manufacturer: 'M', manufacturerPN: 'MP', revision: '00', revisionLocked: false, createdAt: '', updatedAt: '', PartCategory: { id: 1, name: 'General', tagColorHex: '#808080', activeFlag: true, createdAt: '', updatedAt: '' } },
  { id: 3, name: 'Sensor Asm', description: 'Assembly', internalPart: true, vendor: '', sku: null, link: null, minimumOrderQuantity: 1, minimumStockQuantity: null, partCategoryID: 4, activeFlag: true, serialNumberRequired: false, lotNumberRequired: false, defaultUnitOfMeasureID: 1, manufacturer: null, manufacturerPN: null, revision: '00', revisionLocked: false, createdAt: '', updatedAt: '', PartCategory: { id: 4, name: 'Assembly', tagColorHex: '#2196F3', activeFlag: true, createdAt: '', updatedAt: '' } },
];

describe('NewBuildDialog', () => {
  let component: NewBuildDialog;
  let fixture: ComponentFixture<NewBuildDialog>;
  let inventoryService: InventoryService;
  let dialogRef: any;

  beforeEach(async () => {
    dialogRef = { close: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [NewBuildDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    vi.spyOn(inventoryService, 'getAllParts').mockReturnValue(of(mockParts));
    vi.spyOn(inventoryService, 'getLocationBarcodes').mockReturnValue(of([
      { id: 10, barcode: 'LOC-00000A', type: 'Location', name: 'Shelf A', description: null },
      { id: 11, barcode: 'BOX-00000B', type: 'Box', name: 'Bin 1', description: null },
    ] as any));

    fixture = TestBed.createComponent(NewBuildDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load parts on init', () => {
    expect(component.allParts().length).toBe(3);
  });

  it('should filter to only Kit and Assembly parts', () => {
    expect(component.filteredParts().length).toBe(2);
    expect(component.filteredParts().every(p =>
      p.PartCategory?.name === 'Kit' || p.PartCategory?.name === 'Assembly'
    )).toBe(true);
  });

  it('should filter by search text', () => {
    component.searchText.set('motor');
    expect(component.filteredParts().length).toBe(1);
    expect(component.filteredParts()[0].name).toBe('Motor Kit');
  });

  it('should set selected part', () => {
    component.onPartSelected(mockParts[0]);
    expect(component.selectedPart()?.name).toBe('Motor Kit');
  });

  it('should close dialog with null on cancel', () => {
    component.onCancel();
    expect(dialogRef.close).toHaveBeenCalledWith(null);
  });

  it('should not submit without selected part', () => {
    vi.spyOn(inventoryService, 'createTrace');
    component.onLocationSelected(component.locations()[0]);
    component.onSubmit();
    expect(inventoryService.createTrace).not.toHaveBeenCalled();
  });

  it('should not submit without selected location', () => {
    vi.spyOn(inventoryService, 'createTrace');
    component.onPartSelected(mockParts[0]);
    component.onSubmit();
    expect(inventoryService.createTrace).not.toHaveBeenCalled();
  });

  it('should load locations on init', () => {
    expect(component.locations().length).toBe(2);
    expect(component.loadingLocations()).toBe(false);
  });

  it('should filter locations by search text', () => {
    component.onLocationInput('shelf');
    expect(component.filteredLocations().length).toBe(1);
    expect(component.filteredLocations()[0].name).toBe('Shelf A');
  });

  it('should set selected location', () => {
    const loc = component.locations()[0];
    component.onLocationSelected(loc);
    expect(component.selectedLocationId()).toBe(10);
    expect(component.locationSearch()).toContain('Shelf A');
  });

  it('should clear location selection on input change', () => {
    const loc = component.locations()[0];
    component.onLocationSelected(loc);
    component.onLocationInput('something else');
    expect(component.selectedLocationId()).toBeNull();
  });

  it('should create trace with selected location and close dialog on submit', () => {
    component.onPartSelected(mockParts[0]);
    component.onLocationSelected(component.locations()[0]);
    vi.spyOn(inventoryService, 'createTrace').mockReturnValue(of({ barcodeID: 42, Barcode: { id: 42 } }));
    component.onSubmit();
    expect(inventoryService.createTrace).toHaveBeenCalledWith({
      partID: 1,
      quantity: 1,
      parentBarcodeID: 10,
      unitOfMeasureID: 1,
    });
    expect(dialogRef.close).toHaveBeenCalledWith({ barcodeId: 42 });
  });
});
