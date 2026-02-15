import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { HarnessComponentDialog } from './harness-component-dialog';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { HarnessComponent } from '../../../models/harness.model';

describe('HarnessComponentDialog', () => {
  let component: HarnessComponentDialog;
  let fixture: ComponentFixture<HarnessComponentDialog>;
  let dialogRef: any;

  describe('create mode', () => {
    beforeEach(async () => {
      dialogRef = { close: vi.fn() } as any;

      await TestBed.configureTestingModule({
        imports: [HarnessComponentDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: {} },
          { provide: MatDialogRef, useValue: dialogRef },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HarnessComponentDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should have default form values', () => {
      expect(component.label).toBe('');
      expect(component.pinCount).toBe(0);
      expect(component.pinGroups().length).toBe(0);
      expect(component.isEdit()).toBe(false);
      expect(component.isLocked()).toBe(false);
    });

    describe('displayPart', () => {
      it('should return part name', () => {
        expect(component.displayPart({ name: 'Resistor 100ohm' } as any)).toBe('Resistor 100ohm');
      });

      it('should return empty string for null', () => {
        expect(component.displayPart(null as any)).toBe('');
      });
    });

    describe('getTotalPinCount', () => {
      it('should return 0 when no pin groups', () => {
        expect(component.getTotalPinCount()).toBe(0);
      });

      it('should sum pins across all groups', () => {
        component.pinGroups.set([
          { id: 'g1', name: 'Group A', pinTypeID: null, pins: [{ id: 'p1', number: '1' }, { id: 'p2', number: '2' }] },
          { id: 'g2', name: 'Group B', pinTypeID: null, pins: [{ id: 'p3', number: '3' }] },
        ]);
        expect(component.getTotalPinCount()).toBe(3);
      });
    });

    describe('toggleGroupHidden', () => {
      it('should toggle hidden state on a pin group', () => {
        const group = { id: 'g1', name: 'Group', pinTypeID: null, pins: [], hidden: false };
        component.pinGroups.set([group]);
        component.toggleGroupHidden(group);
        expect(group.hidden).toBe(true);
      });

      it('should toggle back to visible', () => {
        const group = { id: 'g1', name: 'Group', pinTypeID: null, pins: [], hidden: true };
        component.pinGroups.set([group]);
        component.toggleGroupHidden(group);
        expect(group.hidden).toBe(false);
      });
    });

    describe('togglePinHidden', () => {
      it('should toggle hidden state on a pin', () => {
        const pin = { id: 'p1', number: '1', hidden: false };
        component.pinGroups.set([{ id: 'g1', name: 'G', pinTypeID: null, pins: [pin] }]);
        component.togglePinHidden(pin);
        expect(pin.hidden).toBe(true);
      });
    });

    describe('clearSelectedPart', () => {
      it('should reset selection and pin groups', () => {
        component.selectedPart.set({ id: 1, name: 'Test' } as any);
        component.linkedComponent.set({ id: 1 } as any);
        component.pinGroups.set([{ id: 'g1', name: 'G', pinTypeID: null, pins: [] }]);

        component.clearSelectedPart();

        expect(component.selectedPart()).toBeNull();
        expect(component.linkedComponent()).toBeNull();
        expect(component.pinGroups().length).toBe(0);
      });
    });

    describe('isValid', () => {
      it('should be invalid with empty label', () => {
        component.label = '';
        expect(component.isValid()).toBe(false);
      });

      it('should be invalid without selected part in create mode', () => {
        component.label = 'R1';
        expect(component.isValid()).toBe(false);
      });

      it('should be valid with label and selected part', () => {
        component.label = 'R1';
        component.selectedPart.set({ id: 1, name: 'Test' } as any);
        expect(component.isValid()).toBe(true);
      });
    });

    describe('save', () => {
      it('should not close when invalid', () => {
        component.label = '';
        component.save();
        expect(dialogRef.close).not.toHaveBeenCalled();
      });

      it('should close with component data when valid', () => {
        component.label = 'R1';
        component.selectedPart.set({ id: 5, name: 'Resistor' } as any);
        component.pinGroups.set([
          { id: 'g1', name: 'Leads', pinTypeID: null, pins: [{ id: 'p1', number: '1' }] }
        ]);

        component.save();

        const result = vi.mocked(dialogRef.close).mock.lastCall![0] as HarnessComponent;
        expect(result.label).toBe('R1');
        expect(result.pinCount).toBe(1);
        expect(result.pinGroups.length).toBe(1);
        expect(result.partId).toBe(5);
        expect(result.partName).toBe('Resistor');
      });
    });
  });

  describe('edit mode', () => {
    const existingComponent: HarnessComponent = {
      id: 'comp-existing',
      label: 'U1',
      pinCount: 4,
      pinGroups: [
        {
          id: 'g1', name: 'Input', pinTypeID: null,
          pins: [{ id: 'p1', number: '1' }, { id: 'p2', number: '2' }]
        },
        {
          id: 'g2', name: 'Output', pinTypeID: null,
          pins: [{ id: 'p3', number: '3' }, { id: 'p4', number: '4' }]
        }
      ],
      position: { x: 500, y: 300 },
      rotation: 180,
      flipped: true,
      partName: 'IC Chip',
      partId: 10,
      dbId: 20,
    };

    beforeEach(async () => {
      dialogRef = { close: vi.fn() } as any;

      await TestBed.configureTestingModule({
        imports: [HarnessComponentDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: { editComponent: existingComponent } },
          { provide: MatDialogRef, useValue: dialogRef },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HarnessComponentDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should be in edit mode', () => {
      expect(component.isEdit()).toBe(true);
    });

    it('should populate form from edit component', () => {
      expect(component.label).toBe('U1');
      expect(component.pinCount).toBe(4);
      expect(component.pinGroups().length).toBe(2);
    });

    it('should be valid in edit mode without selected part', () => {
      expect(component.isValid()).toBe(true);
    });

    it('should preserve position and rotation on save', () => {
      component.save();
      const result = vi.mocked(dialogRef.close).mock.lastCall![0] as HarnessComponent;
      expect(result.id).toBe('comp-existing');
      expect(result.position).toEqual({ x: 500, y: 300 });
      expect(result.rotation).toBe(180);
      expect(result.flipped).toBe(true);
      expect(result.dbId).toBe(20);
    });
  });

  describe('duplicate label detection', () => {
    beforeEach(async () => {
      dialogRef = { close: vi.fn() } as any;

      await TestBed.configureTestingModule({
        imports: [HarnessComponentDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          {
            provide: MAT_DIALOG_DATA,
            useValue: {
              existingComponents: [
                { id: 'c1', label: 'R1', pinCount: 2, pinGroups: [], position: { x: 0, y: 0 } }
              ]
            }
          },
          { provide: MatDialogRef, useValue: dialogRef },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HarnessComponentDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should be invalid when label duplicates existing component', () => {
      component.label = 'R1';
      component.selectedPart.set({ id: 1, name: 'Test' } as any);
      expect(component.isValid()).toBe(false);
    });

    it('should be valid with unique label', () => {
      component.label = 'R2';
      component.selectedPart.set({ id: 1, name: 'Test' } as any);
      expect(component.isValid()).toBe(true);
    });
  });

  describe('onPartSelected', () => {
    beforeEach(async () => {
      dialogRef = { close: vi.fn() } as any;

      await TestBed.configureTestingModule({
        imports: [HarnessComponentDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: {} },
          { provide: MatDialogRef, useValue: dialogRef },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HarnessComponentDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should populate form from linked component', () => {
      const partsService = TestBed.inject(HarnessPartsService);
      vi.spyOn(partsService, 'getComponentByPartId').mockReturnValue(of({
        id: 10,
        label: 'Relay',
        pinCount: 5,
        pins: [
          { name: 'Coil', pinTypeID: null, pins: [{ number: '1' }, { number: '2' }] },
          { name: 'Contact', pinTypeID: null, pins: [{ number: '3' }, { number: '4' }, { number: '5' }] },
        ]
      } as any));

      component.onPartSelected({ id: 5, name: 'Relay Module' } as any);

      expect(component.selectedPart()?.id).toBe(5);
      expect(component.label).toBe('Relay');
      expect(component.pinCount).toBe(5);
      expect(component.pinGroups().length).toBe(2);
    });

    it('should use defaults when no linked component', () => {
      const partsService = TestBed.inject(HarnessPartsService);
      vi.spyOn(partsService, 'getComponentByPartId').mockReturnValue(of(null));

      component.onPartSelected({ id: 5, name: 'Custom Part' } as any);

      expect(component.label).toBe('Custom Part');
      expect(component.pinCount).toBe(0);
      expect(component.pinGroups().length).toBe(0);
    });
  });
});
