import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { HarnessCableDialog } from './harness-cable-dialog';
import { HarnessCable } from '../../../models/harness.model';

describe('HarnessCableDialog', () => {
  let component: HarnessCableDialog;
  let fixture: ComponentFixture<HarnessCableDialog>;
  let dialogRef: any;

  const mockCables: HarnessCable[] = [
    {
      id: 'cable-1', label: 'W1', wireCount: 2, gaugeAWG: '22',
      wires: [
        { id: 'w1', color: 'Red', colorCode: 'RD' },
        { id: 'w2', color: 'Black', colorCode: 'BK' },
      ]
    },
    {
      id: 'cable-2', label: 'W2', wireCount: 1, gaugeAWG: '18',
      wires: [
        { id: 'w3', color: 'Green', colorCode: 'GN' },
      ]
    }
  ];

  beforeEach(async () => {
    dialogRef = { close: vi.fn() } as any;

    await TestBed.configureTestingModule({
      imports: [HarnessCableDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: { cables: mockCables } },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HarnessCableDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should deep clone cables from dialog data', () => {
    expect(component.cables().length).toBe(2);
    // Verify it is a deep clone (not same reference)
    expect(component.cables()[0]).not.toBe(mockCables[0]);
    expect(component.cables()[0].label).toBe('W1');
  });

  describe('addCable', () => {
    it('should add a new cable with unique label', () => {
      component.addCable();
      expect(component.cables().length).toBe(3);
      const newCable = component.cables()[2];
      expect(newCable.wireCount).toBe(1);
      expect(newCable.gaugeAWG).toBe('22');
      expect(newCable.wires.length).toBe(1);
    });

    it('should generate unique label W3 when W1 and W2 exist', () => {
      component.addCable();
      const newCable = component.cables()[2];
      expect(newCable.label).toBe('W3');
    });

    it('should skip existing labels when generating', () => {
      // Cables already have W1 and W2
      component.addCable(); // W3
      component.addCable(); // W4
      expect(component.cables()[3].label).toBe('W4');
    });
  });

  describe('removeCable', () => {
    it('should remove cable after confirm', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      component.removeCable(component.cables()[0]);
      expect(component.cables().length).toBe(1);
      expect(component.cables()[0].label).toBe('W2');
    });

    it('should not remove cable when confirm is cancelled', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      component.removeCable(component.cables()[0]);
      expect(component.cables().length).toBe(2);
    });
  });

  describe('addWire', () => {
    it('should add a wire to a cable', () => {
      const cable = component.cables()[0];
      const initialCount = cable.wires.length;
      component.addWire(cable);
      expect(cable.wires.length).toBe(initialCount + 1);
      expect(cable.wireCount).toBe(initialCount + 1);
    });

    it('should add a black wire by default', () => {
      const cable = component.cables()[0];
      component.addWire(cable);
      const newWire = cable.wires[cable.wires.length - 1];
      expect(newWire.color).toBe('Black');
      expect(newWire.colorCode).toBe('BK');
    });
  });

  describe('removeWire', () => {
    it('should remove a wire from a cable', () => {
      const cable = component.cables()[0];
      expect(cable.wires.length).toBe(2);
      component.removeWire(cable, 0);
      expect(cable.wires.length).toBe(1);
      expect(cable.wireCount).toBe(1);
    });

    it('should not remove last wire', () => {
      const cable = component.cables()[1]; // has 1 wire
      component.removeWire(cable, 0);
      expect(cable.wires.length).toBe(1);
    });
  });

  describe('quickAdd', () => {
    it('should add a cable from quick add form', () => {
      component.quickLabel = 'W3';
      component.quickGauge = '16';
      component.quickColors = 'RD,BK,GN';

      component.quickAdd();

      expect(component.cables().length).toBe(3);
      const newCable = component.cables()[2];
      expect(newCable.label).toBe('W3');
      expect(newCable.gaugeAWG).toBe('16');
      expect(newCable.wireCount).toBe(3);
      expect(newCable.wires.length).toBe(3);
    });

    it('should resolve color codes to names', () => {
      component.quickLabel = 'W3';
      component.quickColors = 'RD';
      component.quickAdd();

      const newCable = component.cables()[2];
      expect(newCable.wires[0].color).toBe('Red');
      expect(newCable.wires[0].colorCode).toBe('RD');
    });

    it('should use raw code when color not found', () => {
      component.quickLabel = 'W3';
      component.quickColors = 'CUSTOM';
      component.quickAdd();

      const newCable = component.cables()[2];
      expect(newCable.wires[0].color).toBe('CUSTOM');
    });

    it('should not add when label is empty', () => {
      component.quickLabel = '';
      component.quickColors = 'RD';
      component.quickAdd();
      expect(component.cables().length).toBe(2);
    });

    it('should not add when colors is empty', () => {
      component.quickLabel = 'W3';
      component.quickColors = '';
      component.quickAdd();
      expect(component.cables().length).toBe(2);
    });

    it('should reset quick add form after adding', () => {
      component.quickLabel = 'W3';
      component.quickGauge = '16';
      component.quickColors = 'RD';

      component.quickAdd();

      expect(component.quickLabel).toBe('');
      expect(component.quickColors).toBe('');
    });
  });

  describe('save', () => {
    it('should close dialog with current cables', () => {
      component.save();
      expect(dialogRef.close).toHaveBeenCalledWith(component.cables());
    });
  });

  describe('empty data', () => {
    beforeEach(async () => {
      await TestBed.resetTestingModule().configureTestingModule({
        imports: [HarnessCableDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: {} },
          { provide: MatDialogRef, useValue: { close: vi.fn() } as any },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HarnessCableDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should have empty cables when no data provided', () => {
      expect(component.cables().length).toBe(0);
    });

    it('should generate W1 label for first added cable', () => {
      component.addCable();
      expect(component.cables()[0].label).toBe('W1');
    });
  });
});
