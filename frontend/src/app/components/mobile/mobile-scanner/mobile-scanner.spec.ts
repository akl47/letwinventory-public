import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { Location } from '@angular/common';
import { vi } from 'vitest';

import { MobileScanner } from './mobile-scanner';
import { InventoryService } from '../../../services/inventory.service';

describe('MobileScanner', () => {
  let component: MobileScanner;
  let fixture: ComponentFixture<MobileScanner>;
  let inventoryService: InventoryService;
  let location: Location;

  beforeEach(async () => {
    // Mock getUserMedia to prevent startCamera() from failing and setting state to 'error'.
    // Methods like startMove/startMerge/scanAgain/tryAgain call startCamera() which rejects
    // without a camera, and the catch block overwrites state to 'error'.
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn() },
        configurable: true,
      });
    }
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockReturnValue(new Promise(() => {}));

    await TestBed.configureTestingModule({
      imports: [MobileScanner],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    location = TestBed.inject(Location);

    fixture = TestBed.createComponent(MobileScanner);
    component = fixture.componentInstance;
    // Do NOT call fixture.detectChanges() here since ngOnInit tries to access BarcodeDetector
    // which doesn't exist in the test environment
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initial state', () => {
    it('should default to scanning state', () => {
      expect(component.state()).toBe('scanning');
    });

    it('should have empty error and result messages', () => {
      expect(component.errorMessage()).toBe('');
      expect(component.resultMessage()).toBe('');
    });

    it('should have null scanned data', () => {
      expect(component.scannedBarcode()).toBeNull();
      expect(component.scannedTag()).toBeNull();
      expect(component.tagChain()).toEqual([]);
    });

    it('should have null second scan data', () => {
      expect(component.secondScanAction()).toBeNull();
      expect(component.secondScannedBarcode()).toBeNull();
      expect(component.secondScannedTag()).toBeNull();
    });

    it('should have default split/trash quantities', () => {
      expect(component.splitQuantity()).toBe(1);
      expect(component.trashQuantity()).toBe(1);
      expect(component.trashAll()).toBe(false);
    });

    it('should have null confirm action', () => {
      expect(component.confirmAction()).toBeNull();
    });
  });

  describe('computed: isTrace', () => {
    it('should return true when scanned tag type is Trace', () => {
      component.scannedTag.set({ type: 'Trace' } as any);
      expect(component.isTrace()).toBe(true);
    });

    it('should return false when scanned tag type is not Trace', () => {
      component.scannedTag.set({ type: 'Location' } as any);
      expect(component.isTrace()).toBe(false);
    });

    it('should return false when no scanned tag', () => {
      expect(component.isTrace()).toBe(false);
    });
  });

  describe('computed: locationChain', () => {
    it('should return empty for single-item chain', () => {
      component.tagChain.set([{ id: 1 } as any]);
      expect(component.locationChain().length).toBe(0);
    });

    it('should return reversed chain without self', () => {
      const chain = [
        { id: 1, name: 'Self' },
        { id: 2, name: 'Parent' },
        { id: 3, name: 'Grandparent' },
      ] as any[];
      component.tagChain.set(chain);
      const loc = component.locationChain();
      expect(loc.length).toBe(2);
      expect(loc[0].name).toBe('Grandparent');
      expect(loc[1].name).toBe('Parent');
    });

    it('should return empty for empty chain', () => {
      component.tagChain.set([]);
      expect(component.locationChain().length).toBe(0);
    });
  });

  describe('startMove', () => {
    it('should set state to scanning_second for move', () => {
      component.startMove();
      expect(component.secondScanAction()).toBe('move');
      expect(component.secondScanInstruction()).toBe('Scan destination location or box');
      expect(component.state()).toBe('scanning_second');
    });
  });

  describe('startMerge', () => {
    it('should set state to scanning_second for merge', () => {
      component.startMerge();
      expect(component.secondScanAction()).toBe('merge');
      expect(component.secondScanInstruction()).toBe('Scan target barcode to merge into');
      expect(component.state()).toBe('scanning_second');
    });
  });

  describe('startSplit', () => {
    it('should set confirm action to split and enter confirming_action state', () => {
      component.startSplit();
      expect(component.splitQuantity()).toBe(1);
      expect(component.confirmAction()).toBe('split');
      expect(component.state()).toBe('confirming_action');
    });
  });

  describe('startTrash', () => {
    it('should set confirm action to trash and enter confirming_action state', () => {
      component.startTrash();
      expect(component.trashQuantity()).toBe(1);
      expect(component.trashAll()).toBe(false);
      expect(component.confirmAction()).toBe('trash');
      expect(component.state()).toBe('confirming_action');
    });
  });

  describe('toggleTrashAll', () => {
    it('should toggle trashAll on and set quantity to scanned tag quantity', () => {
      component.scannedTag.set({ quantity: 10 } as any);
      component.trashAll.set(false);
      component.toggleTrashAll();
      expect(component.trashAll()).toBe(true);
      expect(component.trashQuantity()).toBe(10);
    });

    it('should toggle trashAll off and reset quantity to 1', () => {
      component.trashAll.set(true);
      component.toggleTrashAll();
      expect(component.trashAll()).toBe(false);
      expect(component.trashQuantity()).toBe(1);
    });

    it('should default to 1 when no scanned tag quantity', () => {
      component.scannedTag.set(null);
      component.trashAll.set(false);
      component.toggleTrashAll();
      expect(component.trashQuantity()).toBe(1);
    });
  });

  describe('cancelAction', () => {
    it('should return to display state', () => {
      component.state.set('confirming_action');
      component.cancelAction();
      expect(component.state()).toBe('display');
    });
  });

  describe('cancelSecondScan', () => {
    it('should return to display state', () => {
      component.state.set('scanning_second');
      component.cancelSecondScan();
      expect(component.state()).toBe('display');
    });
  });

  describe('cancelSecondAction', () => {
    it('should clear second scan data and return to display', () => {
      component.secondScannedBarcode.set({ id: 5 } as any);
      component.secondScannedTag.set({ id: 5 } as any);
      component.cancelSecondAction();
      expect(component.secondScannedBarcode()).toBeNull();
      expect(component.secondScannedTag()).toBeNull();
      expect(component.state()).toBe('display');
    });
  });

  describe('scanAgain', () => {
    it('should reset state to scanning', () => {
      component.scannedBarcode.set({ id: 1 } as any);
      component.scannedTag.set({ id: 1 } as any);
      component.errorMessage.set('some error');
      component.scanAgain();
      expect(component.state()).toBe('scanning');
      expect(component.scannedBarcode()).toBeNull();
      expect(component.scannedTag()).toBeNull();
      expect(component.errorMessage()).toBe('');
    });
  });

  describe('tryAgain', () => {
    it('should reset state to scanning', () => {
      component.state.set('error');
      component.errorMessage.set('Failed');
      component.tryAgain();
      expect(component.state()).toBe('scanning');
      expect(component.errorMessage()).toBe('');
    });
  });

  describe('goBack', () => {
    it('should call location.back', () => {
      vi.spyOn(location, 'back');
      component.goBack();
      expect(location.back).toHaveBeenCalled();
    });
  });

  describe('getTypeBadgeClass', () => {
    it('should return badge-location for Location type', () => {
      component.scannedTag.set({ type: 'Location' } as any);
      expect(component.getTypeBadgeClass()).toBe('badge-location');
    });

    it('should return badge-box for Box type', () => {
      component.scannedTag.set({ type: 'Box' } as any);
      expect(component.getTypeBadgeClass()).toBe('badge-box');
    });

    it('should return badge-trace for Trace type', () => {
      component.scannedTag.set({ type: 'Trace' } as any);
      expect(component.getTypeBadgeClass()).toBe('badge-trace');
    });

    it('should return badge-equipment for Equipment type', () => {
      component.scannedTag.set({ type: 'Equipment' } as any);
      expect(component.getTypeBadgeClass()).toBe('badge-equipment');
    });

    it('should return empty string for unknown type', () => {
      component.scannedTag.set({ type: 'Unknown' } as any);
      expect(component.getTypeBadgeClass()).toBe('');
    });

    it('should return empty string when no scanned tag', () => {
      component.scannedTag.set(null);
      expect(component.getTypeBadgeClass()).toBe('');
    });
  });

  describe('ngOnInit without BarcodeDetector', () => {
    it('should set state to unsupported when BarcodeDetector not available', () => {
      // BarcodeDetector is not available in test environment
      fixture.detectChanges();
      expect(component.state()).toBe('unsupported');
    });
  });

  describe('ngOnDestroy', () => {
    it('should not throw', () => {
      expect(() => component.ngOnDestroy()).not.toThrow();
    });
  });
});
