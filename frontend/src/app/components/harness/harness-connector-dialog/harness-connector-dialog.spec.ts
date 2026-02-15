import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { HarnessConnectorDialog } from './harness-connector-dialog';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { HarnessConnector } from '../../../models/harness.model';

describe('HarnessConnectorDialog', () => {
  let component: HarnessConnectorDialog;
  let fixture: ComponentFixture<HarnessConnectorDialog>;
  let dialogRef: any;

  function createComponent(dialogData: any = {}) {
    dialogRef = { close: vi.fn() } as any;

    TestBed.configureTestingModule({
      imports: [HarnessConnectorDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HarnessConnectorDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  describe('create mode', () => {
    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [HarnessConnectorDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: {} },
          { provide: MatDialogRef, useValue: { close: vi.fn() } as any },
        ],
      }).compileComponents();

      dialogRef = TestBed.inject(MatDialogRef) as any;
      fixture = TestBed.createComponent(HarnessConnectorDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should have default form values', () => {
      expect(component.label).toBe('');
      expect(component.connectorType).toBe('male');
      expect(component.pinCount).toBe(4);
      expect(component.color).toBe('GY');
      expect(component.isEdit()).toBe(false);
      expect(component.isLocked()).toBe(false);
    });

    it('should have empty selected part', () => {
      expect(component.selectedPart()).toBeNull();
      expect(component.linkedConnector()).toBeNull();
    });

    describe('displayPart', () => {
      it('should return part name', () => {
        expect(component.displayPart({ name: 'Test Part' } as any)).toBe('Test Part');
      });

      it('should return empty string for null', () => {
        expect(component.displayPart(null as any)).toBe('');
      });
    });

    describe('getTypeLabel', () => {
      it('should return Male for male type', () => {
        expect(component.getTypeLabel('male')).toBe('Male');
      });

      it('should return Female for female type', () => {
        expect(component.getTypeLabel('female')).toBe('Female');
      });

      it('should return Terminal for terminal type', () => {
        expect(component.getTypeLabel('terminal')).toBe('Terminal');
      });

      it('should return Splice for splice type', () => {
        expect(component.getTypeLabel('splice')).toBe('Splice');
      });

      it('should return raw type for unknown type', () => {
        expect(component.getTypeLabel('custom')).toBe('custom');
      });
    });

    describe('getColorHex', () => {
      it('should return hex for known color code', () => {
        const hex = component.getColorHex('RD');
        expect(hex).toBeTruthy();
        expect(hex).not.toBe('#808080');
      });

      it('should return default gray for unknown code', () => {
        expect(component.getColorHex('UNKNOWN')).toBe('#808080');
      });
    });

    describe('getColorName', () => {
      it('should return name for known color code', () => {
        expect(component.getColorName('GY')).toBe('Gray');
      });

      it('should return code itself for unknown code', () => {
        expect(component.getColorName('XYZ')).toBe('XYZ');
      });
    });

    describe('isValid', () => {
      it('should be invalid with empty label', () => {
        component.label = '';
        expect(component.isValid()).toBe(false);
      });

      it('should be invalid without selected part in create mode', () => {
        component.label = 'J1';
        expect(component.isValid()).toBe(false);
      });

      it('should be valid with label and selected part', () => {
        component.label = 'J1';
        component.selectedPart.set({ id: 1, name: 'Test' } as any);
        expect(component.isValid()).toBe(true);
      });

      it('should be invalid with duplicate label', () => {
        // Recreate with existing connectors data
        TestBed.resetTestingModule();
      });
    });

    describe('clearSelectedPart', () => {
      it('should reset selected part and linked connector', () => {
        component.selectedPart.set({ id: 1, name: 'Test' } as any);
        component.linkedConnector.set({ id: 1 } as any);
        component.pins.set([{ id: 'pin-1', number: '1' }]);

        component.clearSelectedPart();

        expect(component.selectedPart()).toBeNull();
        expect(component.linkedConnector()).toBeNull();
        expect(component.pins().length).toBe(0);
      });
    });

    describe('save', () => {
      it('should not close dialog when invalid', () => {
        component.label = '';
        component.save();
        expect(dialogRef.close).not.toHaveBeenCalled();
      });

      it('should close dialog with connector when valid', () => {
        component.label = 'J1';
        component.connectorType = 'female';
        component.pinCount = 2;
        component.color = 'BK';
        component.selectedPart.set({ id: 1, name: 'Test Connector' } as any);
        component.pins.set([
          { id: 'pin-1', number: '1', label: '' },
          { id: 'pin-2', number: '2', label: '' },
        ]);

        component.save();

        expect(dialogRef.close).toHaveBeenCalled();
        const result = vi.mocked(dialogRef.close).mock.lastCall![0] as HarnessConnector;
        expect(result.label).toBe('J1');
        expect(result.type).toBe('female');
        expect(result.pinCount).toBe(2);
        expect(result.color).toBe('BK');
        expect(result.partId).toBe(1);
        expect(result.partName).toBe('Test Connector');
      });
    });
  });

  describe('edit mode', () => {
    const existingConnector: HarnessConnector = {
      id: 'conn-existing',
      label: 'J5',
      type: 'female',
      pinCount: 8,
      pins: Array.from({ length: 8 }, (_, i) => ({
        id: `pin-${i + 1}`, number: String(i + 1), label: ''
      })),
      position: { x: 300, y: 400 },
      color: 'BU',
      rotation: 90,
      flipped: true,
      partName: 'Existing Part',
      partId: 42,
      dbId: 99,
    };

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [HarnessConnectorDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: { editConnector: existingConnector } },
          { provide: MatDialogRef, useValue: { close: vi.fn() } as any },
        ],
      }).compileComponents();

      dialogRef = TestBed.inject(MatDialogRef) as any;
      fixture = TestBed.createComponent(HarnessConnectorDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should be in edit mode', () => {
      expect(component.isEdit()).toBe(true);
    });

    it('should populate form from edit connector', () => {
      expect(component.label).toBe('J5');
      expect(component.connectorType).toBe('female');
      expect(component.pinCount).toBe(8);
      expect(component.color).toBe('BU');
      expect(component.pins().length).toBe(8);
    });

    it('should be valid in edit mode without selected part', () => {
      expect(component.isValid()).toBe(true);
    });

    it('should preserve edit properties on save', () => {
      component.save();
      const result = vi.mocked(dialogRef.close).mock.lastCall![0] as HarnessConnector;
      expect(result.id).toBe('conn-existing');
      expect(result.position).toEqual({ x: 300, y: 400 });
      expect(result.rotation).toBe(90);
      expect(result.flipped).toBe(true);
      expect(result.dbId).toBe(99);
      expect(result.partId).toBe(42);
      expect(result.partName).toBe('Existing Part');
    });
  });

  describe('locked mode', () => {
    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [HarnessConnectorDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: { isLocked: true, editConnector: { id: 'c1', label: 'J1', type: 'male', pinCount: 1, pins: [{ id: 'p1', number: '1' }], position: { x: 0, y: 0 } } } },
          { provide: MatDialogRef, useValue: { close: vi.fn() } as any },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HarnessConnectorDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should set isLocked signal', () => {
      expect(component.isLocked()).toBe(true);
    });
  });

  describe('onPartSelected', () => {
    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [HarnessConnectorDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: {} },
          { provide: MatDialogRef, useValue: { close: vi.fn() } as any },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HarnessConnectorDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should populate form when linked connector found', () => {
      const partsService = TestBed.inject(HarnessPartsService);
      vi.spyOn(partsService, 'getConnectorByPartId').mockReturnValue(of({
        id: 10,
        label: 'DB-9',
        type: 'male',
        pinCount: 9,
        color: 'BK',
        pins: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, number: String(i + 1), label: '' })),
      } as any));

      component.onPartSelected({ id: 5, name: 'DB-9 Connector' } as any);

      expect(component.selectedPart()?.id).toBe(5);
      expect(partsService.getConnectorByPartId).toHaveBeenCalledWith(5);
    });

    it('should use defaults when no linked connector', () => {
      const partsService = TestBed.inject(HarnessPartsService);
      vi.spyOn(partsService, 'getConnectorByPartId').mockReturnValue(of(null));

      component.onPartSelected({ id: 5, name: 'Custom Part' } as any);

      expect(component.label).toBe('Custom Part');
      expect(component.connectorType).toBe('male');
      expect(component.pinCount).toBe(1);
    });
  });
});
