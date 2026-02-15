import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { HarnessAddCableDialog } from './harness-add-cable-dialog';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { HarnessCable } from '../../../models/harness.model';

describe('HarnessAddCableDialog', () => {
  let component: HarnessAddCableDialog;
  let fixture: ComponentFixture<HarnessAddCableDialog>;
  let dialogRef: any;

  describe('create mode', () => {
    beforeEach(async () => {
      dialogRef = { close: vi.fn() } as any;

      await TestBed.configureTestingModule({
        imports: [HarnessAddCableDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: {} },
          { provide: MatDialogRef, useValue: dialogRef },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HarnessAddCableDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should have default form values', () => {
      expect(component.label).toBe('');
      expect(component.gaugeAWG).toBe('22');
      expect(component.lengthMm).toBeUndefined();
      expect(component.wires().length).toBe(0);
      expect(component.isEdit()).toBe(false);
      expect(component.isLocked()).toBe(false);
    });

    describe('displayPart', () => {
      it('should return part name', () => {
        expect(component.displayPart({ name: 'Cable Assembly' } as any)).toBe('Cable Assembly');
      });

      it('should return empty string for null', () => {
        expect(component.displayPart(null as any)).toBe('');
      });
    });

    describe('getWireHex', () => {
      it('should return hex for known color code', () => {
        expect(component.getWireHex('RD')).toBe('#cc0000');
      });

      it('should return hex for known color name', () => {
        expect(component.getWireHex('Red')).toBe('#cc0000');
      });

      it('should return default gray for unknown', () => {
        expect(component.getWireHex('UNKNOWN')).toBe('#808080');
      });
    });

    describe('isValid', () => {
      it('should be invalid with empty label', () => {
        component.label = '';
        expect(component.isValid()).toBe(false);
      });

      it('should be invalid without selected part in create mode', () => {
        component.label = 'W1';
        expect(component.isValid()).toBe(false);
      });

      it('should be valid with label and selected part', () => {
        component.label = 'W1';
        component.selectedPart.set({ id: 1, name: 'Cable' } as any);
        expect(component.isValid()).toBe(true);
      });
    });

    describe('clearSelectedPart', () => {
      it('should reset all part-related state', () => {
        component.selectedPart.set({ id: 1, name: 'Test' } as any);
        component.linkedCable.set({ id: 1 } as any);
        component.wires.set([{ id: 'w1', color: 'Red', colorCode: 'RD' }]);
        component.cableDiagramImage = 'base64data';

        component.clearSelectedPart();

        expect(component.selectedPart()).toBeNull();
        expect(component.linkedCable()).toBeNull();
        expect(component.wires().length).toBe(0);
        expect(component.cableDiagramImage).toBeUndefined();
      });
    });

    describe('onWireDrop', () => {
      it('should reorder wires after drag and drop', () => {
        component.wires.set([
          { id: 'w1', color: 'Red', colorCode: 'RD' },
          { id: 'w2', color: 'Black', colorCode: 'BK' },
          { id: 'w3', color: 'Green', colorCode: 'GN' },
        ]);

        component.onWireDrop({
          previousIndex: 0,
          currentIndex: 2,
          container: {} as any,
          previousContainer: {} as any,
          isPointerOverContainer: true,
          item: {} as any,
          distance: { x: 0, y: 0 },
          dropPoint: { x: 0, y: 0 },
          event: {} as any,
        });

        expect(component.wires()[0].id).toBe('w2');
        expect(component.wires()[1].id).toBe('w3');
        expect(component.wires()[2].id).toBe('w1');
      });
    });

    describe('save', () => {
      it('should not close when invalid', () => {
        component.label = '';
        component.save();
        expect(dialogRef.close).not.toHaveBeenCalled();
      });

      it('should close with cable data when valid', () => {
        component.label = 'W1';
        component.gaugeAWG = '18';
        component.lengthMm = 500;
        component.selectedPart.set({ id: 3, name: 'Cable Assembly' } as any);
        component.wires.set([
          { id: 'w1', color: 'Red', colorCode: 'RD' },
          { id: 'w2', color: 'Black', colorCode: 'BK' },
        ]);

        component.save();

        const result = vi.mocked(dialogRef.close).mock.lastCall![0] as HarnessCable;
        expect(result.label).toBe('W1');
        expect(result.gaugeAWG).toBe('18');
        expect(result.lengthMm).toBe(500);
        expect(result.wireCount).toBe(2);
        expect(result.wires.length).toBe(2);
        expect(result.partId).toBe(3);
        expect(result.partName).toBe('Cable Assembly');
      });
    });
  });

  describe('edit mode', () => {
    const existingCable: HarnessCable = {
      id: 'cable-existing',
      label: 'W5',
      wireCount: 3,
      gaugeAWG: '16',
      lengthMm: 1000,
      wires: [
        { id: 'w1', color: 'Red', colorCode: 'RD' },
        { id: 'w2', color: 'Black', colorCode: 'BK' },
        { id: 'w3', color: 'Green', colorCode: 'GN' },
      ],
      position: { x: 400, y: 300 },
      partName: 'Power Cable',
      partId: 7,
      dbId: 15,
      cableDiagramImage: 'base64diagram',
    };

    beforeEach(async () => {
      dialogRef = { close: vi.fn() } as any;

      await TestBed.configureTestingModule({
        imports: [HarnessAddCableDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: { editCable: existingCable } },
          { provide: MatDialogRef, useValue: dialogRef },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HarnessAddCableDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should be in edit mode', () => {
      expect(component.isEdit()).toBe(true);
    });

    it('should populate form from edit cable', () => {
      expect(component.label).toBe('W5');
      expect(component.gaugeAWG).toBe('16');
      expect(component.lengthMm).toBe(1000);
      expect(component.wires().length).toBe(3);
      expect(component.cableDiagramImage).toBe('base64diagram');
    });

    it('should be valid in edit mode without selected part', () => {
      expect(component.isValid()).toBe(true);
    });

    it('should preserve position and IDs on save', () => {
      component.save();
      const result = vi.mocked(dialogRef.close).mock.lastCall![0] as HarnessCable;
      expect(result.id).toBe('cable-existing');
      expect(result.position).toEqual({ x: 400, y: 300 });
      expect(result.dbId).toBe(15);
    });
  });

  describe('duplicate label detection', () => {
    beforeEach(async () => {
      dialogRef = { close: vi.fn() } as any;

      await TestBed.configureTestingModule({
        imports: [HarnessAddCableDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          {
            provide: MAT_DIALOG_DATA,
            useValue: { existingCables: [{ id: 'c1', label: 'W1', wireCount: 1, wires: [] }] }
          },
          { provide: MatDialogRef, useValue: dialogRef },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HarnessAddCableDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should be invalid when label duplicates existing cable', () => {
      component.label = 'W1';
      component.selectedPart.set({ id: 1, name: 'Test' } as any);
      expect(component.isValid()).toBe(false);
    });
  });

  describe('onPartSelected', () => {
    beforeEach(async () => {
      dialogRef = { close: vi.fn() } as any;

      await TestBed.configureTestingModule({
        imports: [HarnessAddCableDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: {} },
          { provide: MatDialogRef, useValue: dialogRef },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HarnessAddCableDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should populate form from linked cable', () => {
      const partsService = TestBed.inject(HarnessPartsService);
      vi.spyOn(partsService, 'getCableByPartId').mockReturnValue(of({
        id: 10,
        label: 'Shielded Cable',
        gaugeAWG: '20',
        wireCount: 2,
        wires: [
          { color: 'Red', colorCode: 'RD' },
          { color: 'Black', colorCode: 'BK' },
        ],
        cableDiagramImage: 'diagram-data',
      } as any));

      component.onPartSelected({ id: 5, name: 'Shielded Cable' } as any);

      expect(component.label).toBe('Shielded Cable');
      expect(component.gaugeAWG).toBe('20');
      expect(component.wires().length).toBe(2);
      expect(component.cableDiagramImage).toBe('diagram-data');
    });

    it('should use defaults when no linked cable', () => {
      const partsService = TestBed.inject(HarnessPartsService);
      vi.spyOn(partsService, 'getCableByPartId').mockReturnValue(of(null));

      component.onPartSelected({ id: 5, name: 'Custom Cable' } as any);

      expect(component.label).toBe('Custom Cable');
      expect(component.gaugeAWG).toBe('22');
      expect(component.wires().length).toBe(1);
    });
  });
});
