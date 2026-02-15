import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { HarnessAddPartDialog } from './harness-add-part-dialog';
import { HarnessPartsService } from '../../../services/harness-parts.service';

describe('HarnessAddPartDialog', () => {
  let component: HarnessAddPartDialog;
  let fixture: ComponentFixture<HarnessAddPartDialog>;
  let dialogRef: any;
  let partsService: HarnessPartsService;

  beforeEach(async () => {
    dialogRef = { close: vi.fn() } as any;

    await TestBed.configureTestingModule({
      imports: [HarnessAddPartDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    partsService = TestBed.inject(HarnessPartsService);
    vi.spyOn(partsService, 'getConnectors').mockReturnValue(of([]));
    vi.spyOn(partsService, 'getWires').mockReturnValue(of([]));
    vi.spyOn(partsService, 'getCables').mockReturnValue(of([]));

    fixture = TestBed.createComponent(HarnessAddPartDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initial state', () => {
    it('should have default tab 0', () => {
      expect(component.selectedTab).toBe(0);
    });

    it('should load all part types on init', () => {
      expect(partsService.getConnectors).toHaveBeenCalled();
      expect(partsService.getWires).toHaveBeenCalled();
      expect(partsService.getCables).toHaveBeenCalled();
    });

    it('should default to new mode when no existing parts', () => {
      expect(component.connectorMode).toBe('new');
      expect(component.wireMode).toBe('new');
      expect(component.cableMode).toBe('new');
    });

    it('should have default new connector values', () => {
      expect(component.newConnector.label).toBe('J1');
      expect(component.newConnector.type).toBe('male');
      expect(component.newConnector.pinCount).toBe(4);
      expect(component.newConnector.color).toBe('GY');
    });

    it('should have default new wire values', () => {
      expect(component.newWire.label).toBe('W1');
      expect(component.newWire.color).toBe('Black');
      expect(component.newWire.colorCode).toBe('BK');
    });

    it('should have one default cable wire', () => {
      expect(component.cableWires().length).toBe(1);
      expect(component.cableWires()[0].colorCode).toBe('BK');
    });
  });

  describe('onTabChange', () => {
    it('should update selectedTab', () => {
      component.onTabChange(2);
      expect(component.selectedTab).toBe(2);
    });
  });

  describe('getPartTypeName', () => {
    it('should return Connector for tab 0', () => {
      component.selectedTab = 0;
      expect(component.getPartTypeName()).toBe('Connector');
    });

    it('should return Wire for tab 1', () => {
      component.selectedTab = 1;
      expect(component.getPartTypeName()).toBe('Wire');
    });

    it('should return Cable for tab 2', () => {
      component.selectedTab = 2;
      expect(component.getPartTypeName()).toBe('Cable');
    });

    it('should return Part for unknown tab', () => {
      component.selectedTab = 99;
      expect(component.getPartTypeName()).toBe('Part');
    });
  });

  describe('getConnectorHex', () => {
    it('should return hex for known color code', () => {
      const hex = component.getConnectorHex('RD');
      expect(hex).toBeTruthy();
      expect(hex).not.toBe('#808080');
    });

    it('should return gray for unknown', () => {
      expect(component.getConnectorHex('UNKNOWN')).toBe('#808080');
    });
  });

  describe('getWireHex', () => {
    it('should return hex for known color code', () => {
      expect(component.getWireHex('RD')).toBe('#cc0000');
    });

    it('should return gray for unknown', () => {
      expect(component.getWireHex('UNKNOWN')).toBe('#808080');
    });
  });

  describe('updateNewWireColor', () => {
    it('should update wire color name from code', () => {
      component.newWire.colorCode = 'RD';
      component.updateNewWireColor();
      expect(component.newWire.color).toBe('Red');
    });

    it('should not update when code not found', () => {
      component.newWire.color = 'Original';
      component.newWire.colorCode = 'ZZZZZ';
      component.updateNewWireColor();
      expect(component.newWire.color).toBe('Original');
    });
  });

  describe('updateCableWireColor', () => {
    it('should update wire color from code', () => {
      const wire = { id: 'w1', color: 'Black', colorCode: 'RD' };
      component.updateCableWireColor(wire);
      expect(wire.color).toBe('Red');
    });
  });

  describe('addCableWire', () => {
    it('should add a new cable wire', () => {
      const initialCount = component.cableWires().length;
      component.addCableWire();
      expect(component.cableWires().length).toBe(initialCount + 1);
    });

    it('should add a black wire by default', () => {
      component.addCableWire();
      const last = component.cableWires()[component.cableWires().length - 1];
      expect(last.color).toBe('Black');
      expect(last.colorCode).toBe('BK');
    });
  });

  describe('removeCableWire', () => {
    it('should remove a cable wire', () => {
      component.addCableWire(); // Now 2 wires
      component.removeCableWire(0);
      expect(component.cableWires().length).toBe(1);
    });

    it('should not remove last wire', () => {
      expect(component.cableWires().length).toBe(1);
      component.removeCableWire(0);
      expect(component.cableWires().length).toBe(1);
    });
  });

  describe('isValid', () => {
    describe('connector tab (0)', () => {
      beforeEach(() => {
        component.selectedTab = 0;
      });

      it('should be valid with new mode, label, and pinCount > 0', () => {
        component.connectorMode = 'new';
        component.newConnector.label = 'J1';
        component.newConnector.pinCount = 4;
        expect(component.isValid()).toBe(true);
      });

      it('should be invalid with empty label', () => {
        component.connectorMode = 'new';
        component.newConnector.label = '';
        expect(component.isValid()).toBe(false);
      });

      it('should be invalid with pinCount 0', () => {
        component.connectorMode = 'new';
        component.newConnector.label = 'J1';
        component.newConnector.pinCount = 0;
        expect(component.isValid()).toBe(false);
      });

      it('should be valid in existing mode with selected ID', () => {
        component.connectorMode = 'existing';
        component.selectedConnectorId = 5;
        expect(component.isValid()).toBe(true);
      });

      it('should be invalid in existing mode without selection', () => {
        component.connectorMode = 'existing';
        component.selectedConnectorId = null;
        expect(component.isValid()).toBe(false);
      });
    });

    describe('wire tab (1)', () => {
      beforeEach(() => {
        component.selectedTab = 1;
      });

      it('should be valid with new mode, label, and colorCode', () => {
        component.wireMode = 'new';
        component.newWire.label = 'W1';
        component.newWire.colorCode = 'RD';
        expect(component.isValid()).toBe(true);
      });

      it('should be invalid with empty label', () => {
        component.wireMode = 'new';
        component.newWire.label = '';
        expect(component.isValid()).toBe(false);
      });

      it('should be valid in existing mode with selection', () => {
        component.wireMode = 'existing';
        component.selectedWireId = 3;
        expect(component.isValid()).toBe(true);
      });
    });

    describe('cable tab (2)', () => {
      beforeEach(() => {
        component.selectedTab = 2;
      });

      it('should be valid with new mode, label, and wires', () => {
        component.cableMode = 'new';
        component.newCable.label = 'CABLE-A';
        expect(component.isValid()).toBe(true); // has default 1 wire
      });

      it('should be invalid with empty label', () => {
        component.cableMode = 'new';
        component.newCable.label = '';
        expect(component.isValid()).toBe(false);
      });

      it('should be valid in existing mode with selection', () => {
        component.cableMode = 'existing';
        component.selectedCableId = 7;
        expect(component.isValid()).toBe(true);
      });
    });
  });

  describe('save', () => {
    it('should not close when invalid', () => {
      component.selectedTab = 0;
      component.connectorMode = 'new';
      component.newConnector.label = '';
      component.save();
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should close with new connector result', () => {
      component.selectedTab = 0;
      component.connectorMode = 'new';
      component.saveConnectorToLibrary = false;
      component.newConnector.label = 'J1';
      component.newConnector.type = 'female';
      component.newConnector.pinCount = 4;
      component.newConnector.color = 'BK';

      component.save();

      expect(dialogRef.close).toHaveBeenCalled();
      const result = vi.mocked(dialogRef.close).mock.lastCall![0];
      expect(result.type).toBe('connector');
      expect(result.connector.label).toBe('J1');
      expect(result.connector.type).toBe('female');
      expect(result.connector.pinCount).toBe(4);
      expect(result.connector.pins.length).toBe(4);
    });

    it('should close with new wire result', () => {
      component.selectedTab = 1;
      component.wireMode = 'new';
      component.saveWireToLibrary = false;
      component.newWire.label = 'W1';
      component.newWire.color = 'Red';
      component.newWire.colorCode = 'RD';
      component.newWire.gaugeAWG = '22';

      component.save();

      expect(dialogRef.close).toHaveBeenCalled();
      const result = vi.mocked(dialogRef.close).mock.lastCall![0];
      expect(result.type).toBe('wire');
      expect(result.wire.label).toBe('W1');
      expect(result.wire.color).toBe('Red');
    });

    it('should close with new cable result', () => {
      component.selectedTab = 2;
      component.cableMode = 'new';
      component.saveCableToLibrary = false;
      component.newCable.label = 'CABLE-A';
      component.newCable.gaugeAWG = '18';

      component.save();

      expect(dialogRef.close).toHaveBeenCalled();
      const result = vi.mocked(dialogRef.close).mock.lastCall![0];
      expect(result.type).toBe('cable');
      expect(result.cable.label).toBe('CABLE-A');
    });
  });

  describe('with existing connectors data', () => {
    beforeEach(async () => {
      await TestBed.resetTestingModule().configureTestingModule({
        imports: [HarnessAddPartDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          {
            provide: MAT_DIALOG_DATA,
            useValue: {
              existingConnectors: [
                { id: 'c1', label: 'J1', type: 'male', pinCount: 1, pins: [], position: { x: 0, y: 0 } },
              ],
              existingCables: [
                { id: 'cb1', label: 'CABLE-A', wireCount: 1, wires: [] },
              ]
            }
          },
          { provide: MatDialogRef, useValue: { close: vi.fn() } as any },
        ],
      }).compileComponents();

      partsService = TestBed.inject(HarnessPartsService);
      vi.spyOn(partsService, 'getConnectors').mockReturnValue(of([]));
      vi.spyOn(partsService, 'getWires').mockReturnValue(of([]));
      vi.spyOn(partsService, 'getCables').mockReturnValue(of([]));

      fixture = TestBed.createComponent(HarnessAddPartDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should generate unique connector label J2', () => {
      expect(component.newConnector.label).toBe('J2');
    });

    it('should generate unique cable label CABLE-B', () => {
      expect(component.newCable.label).toBe('CABLE-B');
    });
  });

  describe('with initial tab', () => {
    beforeEach(async () => {
      await TestBed.resetTestingModule().configureTestingModule({
        imports: [HarnessAddPartDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: { initialTab: 2 } },
          { provide: MatDialogRef, useValue: { close: vi.fn() } as any },
        ],
      }).compileComponents();

      partsService = TestBed.inject(HarnessPartsService);
      vi.spyOn(partsService, 'getConnectors').mockReturnValue(of([]));
      vi.spyOn(partsService, 'getWires').mockReturnValue(of([]));
      vi.spyOn(partsService, 'getCables').mockReturnValue(of([]));

      fixture = TestBed.createComponent(HarnessAddPartDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should start on cable tab when initialTab is 2', () => {
      expect(component.selectedTab).toBe(2);
    });
  });

  describe('loadConnectors with existing data', () => {
    beforeEach(async () => {
      await TestBed.resetTestingModule().configureTestingModule({
        imports: [HarnessAddPartDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: {} },
          { provide: MatDialogRef, useValue: { close: vi.fn() } as any },
        ],
      }).compileComponents();

      partsService = TestBed.inject(HarnessPartsService);
      vi.spyOn(partsService, 'getConnectors').mockReturnValue(of([{ id: 1, label: 'DB-9' }] as any));
      vi.spyOn(partsService, 'getWires').mockReturnValue(of([{ id: 1, label: 'Wire A' }] as any));
      vi.spyOn(partsService, 'getCables').mockReturnValue(of([{ id: 1, label: 'Cable A' }] as any));

      fixture = TestBed.createComponent(HarnessAddPartDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should switch to existing mode when connectors exist', () => {
      expect(component.connectorMode).toBe('existing');
      expect(component.dbConnectors().length).toBe(1);
    });

    it('should switch to existing mode when wires exist', () => {
      expect(component.wireMode).toBe('existing');
      expect(component.dbWires().length).toBe(1);
    });

    it('should switch to existing mode when cables exist', () => {
      expect(component.cableMode).toBe('existing');
      expect(component.dbCables().length).toBe(1);
    });
  });
});
