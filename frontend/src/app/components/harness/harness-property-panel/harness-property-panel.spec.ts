import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { HarnessPropertyPanel } from './harness-property-panel';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { HarnessData, HarnessConnection } from '../../../models/harness.model';
import { CanvasSelection } from '../harness-canvas/harness-canvas';

describe('HarnessPropertyPanel', () => {
  let component: HarnessPropertyPanel;
  let fixture: ComponentFixture<HarnessPropertyPanel>;
  let harnessPartsService: HarnessPartsService;

  const mockHarnessData: HarnessData = {
    name: 'Test Harness',
    partNumber: 'HRN-001',
    revision: 'A',
    description: 'Test description',
    connectors: [
      {
        id: 'conn-1', label: 'J1', type: 'male', pinCount: 4,
        pins: [
          { id: 'pin-1', number: '1', label: 'PWR' },
          { id: 'pin-2', number: '2', label: 'GND' },
          { id: 'pin-3', number: '3', label: 'SIG+' },
          { id: 'pin-4', number: '4', label: 'SIG-' },
        ],
        position: { x: 100, y: 200 }
      },
      {
        id: 'conn-2', label: 'P1', type: 'female', pinCount: 2,
        pins: [
          { id: 'pin-5', number: '1', label: '' },
          { id: 'pin-6', number: '2', label: '' },
        ],
        position: { x: 400, y: 200 }
      }
    ],
    cables: [
      {
        id: 'cable-1', label: 'W1', wireCount: 2, gaugeAWG: '22',
        wires: [
          { id: 'wire-1', color: 'Red', colorCode: 'RD' },
          { id: 'wire-2', color: 'Black', colorCode: 'BK' },
        ],
        position: { x: 250, y: 200 }
      }
    ],
    components: [
      {
        id: 'comp-1', label: 'R1', pinCount: 2,
        pinGroups: [
          {
            id: 'group-1', name: 'Leads', pinTypeID: null,
            pins: [
              { id: 'cpin-1', number: '1', label: 'A' },
              { id: 'cpin-2', number: '2', label: 'B' },
            ]
          }
        ],
        position: { x: 300, y: 300 }
      }
    ],
    connections: [
      {
        id: 'connection-1',
        fromConnector: 'conn-1', fromPin: 'pin-1',
        toConnector: 'conn-2', toPin: 'pin-5',
        color: 'RD', gauge: '22', lengthMm: 100,
        fromTermination: 'f-pin', toTermination: 'm-pin'
      } as HarnessConnection,
      {
        id: 'connection-2',
        fromConnector: 'conn-1', fromPin: 'pin-2',
        toCable: 'cable-1', toWire: 'wire-1', toSide: 'left' as const,
        color: 'BK', gauge: '22'
      } as HarnessConnection,
      {
        id: 'connection-3',
        fromComponent: 'comp-1', fromComponentPin: 'cpin-1',
        toCable: 'cable-1', toWire: 'wire-2', toSide: 'right' as const,
        color: 'GN', gauge: '20'
      } as HarnessConnection,
    ],
    canvasSettings: { zoom: 1, gridEnabled: true, snapToGrid: true }
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HarnessPropertyPanel],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideAnimationsAsync(), provideRouter([])],
    }).compileComponents();

    harnessPartsService = TestBed.inject(HarnessPartsService);
    vi.spyOn(harnessPartsService, 'getWireEnds').mockReturnValue(of([
      { id: 1, code: 'f-pin', name: 'Female Pin', description: '', activeFlag: true },
      { id: 2, code: 'm-pin', name: 'Male Pin', description: '', activeFlag: true },
    ]));

    fixture = TestBed.createComponent(HarnessPropertyPanel);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit / loadWireEnds', () => {
    it('should load wire ends from service on init', () => {
      expect(harnessPartsService.getWireEnds).toHaveBeenCalled();
      expect(component.terminationTypes().length).toBe(2);
      expect(component.terminationTypes()[0]).toEqual({ value: 'f-pin', label: 'Female Pin' });
    });
  });

  describe('default input values', () => {
    it('should have null harnessData by default', () => {
      expect(component.harnessData()).toBeNull();
    });

    it('should have null selection by default', () => {
      expect(component.selection()).toBeNull();
    });

    it('should have isReleased false by default', () => {
      expect(component.isReleased()).toBe(false);
    });

    it('should have isLocked false by default', () => {
      expect(component.isLocked()).toBe(false);
    });
  });

  describe('computed properties', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
      fixture.detectChanges();
    });

    it('should compute cables from harnessData', () => {
      expect(component.cables().length).toBe(1);
      expect(component.cables()[0].label).toBe('W1');
    });

    it('should compute connectorCount', () => {
      expect(component.connectorCount()).toBe(2);
    });

    it('should compute connectionCount', () => {
      expect(component.connectionCount()).toBe(3);
    });

    it('should compute totalPins', () => {
      expect(component.totalPins()).toBe(6); // 4 + 2
    });

    it('should return empty arrays when harnessData is null', () => {
      fixture.componentRef.setInput('harnessData', null);
      fixture.detectChanges();
      expect(component.cables().length).toBe(0);
      expect(component.connectorCount()).toBe(0);
      expect(component.connectionCount()).toBe(0);
      expect(component.totalPins()).toBe(0);
    });
  });

  describe('selectedWireIds', () => {
    it('should return empty array when no selection', () => {
      expect(component.selectedWireIds().length).toBe(0);
    });

    it('should return wire IDs from multi-selection', () => {
      const selection: CanvasSelection = {
        type: 'multiple',
        selectedIds: [
          { type: 'connection', id: 'connection-1' },
          { type: 'connection', id: 'connection-2' },
          { type: 'connector', id: 'conn-1' },
        ]
      };
      fixture.componentRef.setInput('selection', selection);
      fixture.detectChanges();
      expect(component.selectedWireIds()).toEqual(['connection-1', 'connection-2']);
    });
  });

  describe('hasMultipleWiresSelected', () => {
    it('should return false when no wires selected', () => {
      expect(component.hasMultipleWiresSelected()).toBe(false);
    });

    it('should return true when multiple wires selected', () => {
      const selection: CanvasSelection = {
        type: 'multiple',
        selectedIds: [
          { type: 'connection', id: 'connection-1' },
          { type: 'connection', id: 'connection-2' },
        ]
      };
      fixture.componentRef.setInput('selection', selection);
      fixture.detectChanges();
      expect(component.hasMultipleWiresSelected()).toBe(true);
    });
  });

  describe('selectedWiresCommonValues', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
    });

    it('should return null when no wires selected', () => {
      expect(component.selectedWiresCommonValues()).toBeNull();
    });

    it('should return common values across selected wires', () => {
      const selection: CanvasSelection = {
        type: 'multiple',
        selectedIds: [
          { type: 'connection', id: 'connection-1' },
          { type: 'connection', id: 'connection-2' },
        ]
      };
      fixture.componentRef.setInput('selection', selection);
      fixture.detectChanges();

      const common = component.selectedWiresCommonValues();
      expect(common).toBeTruthy();
      // Both have gauge '22' so it should be common
      expect(common!.gauge).toBe('22');
    });
  });

  describe('updateMetadata', () => {
    it('should emit metadataChanged with field and value', () => {
      const emitSpy = vi.spyOn(component.metadataChanged, 'emit');
      const event = { target: { value: 'New Name' } } as unknown as Event;
      component.updateMetadata('name', event);
      expect(emitSpy).toHaveBeenCalledWith({ field: 'name', value: 'New Name' });
    });
  });

  describe('updateConnector', () => {
    it('should emit connectorChanged with string value', () => {
      const emitSpy = vi.spyOn(component.connectorChanged, 'emit');
      const event = { target: { value: 'J2' } } as unknown as Event;
      component.updateConnector('label', event);
      expect(emitSpy).toHaveBeenCalledWith({ field: 'label', value: 'J2' });
    });

    it('should parse pinCount as integer', () => {
      const emitSpy = vi.spyOn(component.connectorChanged, 'emit');
      const event = { target: { value: '8' } } as unknown as Event;
      component.updateConnector('pinCount', event);
      expect(emitSpy).toHaveBeenCalledWith({ field: 'pinCount', value: 8 });
    });

    it('should default pinCount to 1 when parsing fails', () => {
      const emitSpy = vi.spyOn(component.connectorChanged, 'emit');
      const event = { target: { value: 'abc' } } as unknown as Event;
      component.updateConnector('pinCount', event);
      expect(emitSpy).toHaveBeenCalledWith({ field: 'pinCount', value: 1 });
    });
  });

  describe('updateConnectorSelect', () => {
    it('should emit connectorChanged with field and value', () => {
      const emitSpy = vi.spyOn(component.connectorChanged, 'emit');
      component.updateConnectorSelect('type', 'female');
      expect(emitSpy).toHaveBeenCalledWith({ field: 'type', value: 'female' });
    });
  });

  describe('updatePinLabel', () => {
    it('should emit pinLabelChanged', () => {
      const emitSpy = vi.spyOn(component.pinLabelChanged, 'emit');
      const event = { target: { value: 'VCC' } } as unknown as Event;
      component.updatePinLabel(0, event);
      expect(emitSpy).toHaveBeenCalledWith({ index: 0, label: 'VCC' });
    });
  });

  describe('updateConnection', () => {
    it('should emit connectionChanged', () => {
      const emitSpy = vi.spyOn(component.connectionChanged, 'emit');
      component.updateConnection('color', 'RD');
      expect(emitSpy).toHaveBeenCalledWith({ field: 'color', value: 'RD' });
    });
  });

  describe('updateConnectionInput', () => {
    it('should emit connectionChanged for string fields', () => {
      const emitSpy = vi.spyOn(component.connectionChanged, 'emit');
      const event = { target: { value: 'Wire Label' } } as unknown as Event;
      component.updateConnectionInput('label', event);
      expect(emitSpy).toHaveBeenCalledWith({ field: 'label', value: 'Wire Label' });
    });

    it('should parse lengthMm as integer', () => {
      const emitSpy = vi.spyOn(component.connectionChanged, 'emit');
      const event = { target: { value: '250' } } as unknown as Event;
      component.updateConnectionInput('lengthMm', event);
      expect(emitSpy).toHaveBeenCalledWith({ field: 'lengthMm', value: 250 });
    });

    it('should set lengthMm to undefined when empty', () => {
      const emitSpy = vi.spyOn(component.connectionChanged, 'emit');
      const event = { target: { value: '' } } as unknown as Event;
      component.updateConnectionInput('lengthMm', event);
      expect(emitSpy).toHaveBeenCalledWith({ field: 'lengthMm', value: undefined });
    });
  });

  describe('getConnectorLabel', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
      fixture.detectChanges();
    });

    it('should return connector label when found', () => {
      expect(component.getConnectorLabel('conn-1')).toBe('J1');
    });

    it('should return connectorId when label not found', () => {
      expect(component.getConnectorLabel('nonexistent')).toBe('nonexistent');
    });

    it('should return Unknown when connectorId is undefined', () => {
      expect(component.getConnectorLabel(undefined)).toBe('Unknown');
    });
  });

  describe('getPinNumber', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
      fixture.detectChanges();
    });

    it('should return pin number when found', () => {
      expect(component.getPinNumber('conn-1', 'pin-1')).toBe('1');
    });

    it('should return pinId when pin not found', () => {
      expect(component.getPinNumber('conn-1', 'nonexistent')).toBe('nonexistent');
    });

    it('should return ? when connectorId is undefined', () => {
      expect(component.getPinNumber(undefined, 'pin-1')).toBe('?');
    });

    it('should return ? when pinId is undefined', () => {
      expect(component.getPinNumber('conn-1', undefined)).toBe('?');
    });
  });

  describe('getCableLabel', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
      fixture.detectChanges();
    });

    it('should return cable label when found', () => {
      expect(component.getCableLabel('cable-1')).toBe('W1');
    });

    it('should return Unknown when undefined', () => {
      expect(component.getCableLabel(undefined)).toBe('Unknown');
    });
  });

  describe('getComponentLabel', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
      fixture.detectChanges();
    });

    it('should return component label when found', () => {
      expect(component.getComponentLabel('comp-1')).toBe('R1');
    });

    it('should return Unknown when undefined', () => {
      expect(component.getComponentLabel(undefined)).toBe('Unknown');
    });
  });

  describe('getComponentPinNumber', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
      fixture.detectChanges();
    });

    it('should return pin number from component pin groups', () => {
      expect(component.getComponentPinNumber('comp-1', 'cpin-1')).toBe('1');
    });

    it('should return ? when componentId is undefined', () => {
      expect(component.getComponentPinNumber(undefined, 'cpin-1')).toBe('?');
    });

    it('should return pinId when pin not found', () => {
      expect(component.getComponentPinNumber('comp-1', 'nonexistent')).toBe('nonexistent');
    });
  });

  describe('getWireLabel', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
      fixture.detectChanges();
    });

    it('should return wire color as label when no explicit label', () => {
      expect(component.getWireLabel('cable-1', 'wire-1')).toBe('Red');
    });

    it('should return ? when cableId is undefined', () => {
      expect(component.getWireLabel(undefined, 'wire-1')).toBe('?');
    });

    it('should return wireId when wire not found', () => {
      expect(component.getWireLabel('cable-1', 'nonexistent')).toBe('nonexistent');
    });
  });

  describe('getEndpointDescription', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
      fixture.detectChanges();
    });

    it('should describe a connector from-endpoint', () => {
      const conn = mockHarnessData.connections[0];
      expect(component.getEndpointDescription(conn, 'from')).toBe('J1 Pin 1');
    });

    it('should describe a connector to-endpoint', () => {
      const conn = mockHarnessData.connections[0];
      expect(component.getEndpointDescription(conn, 'to')).toBe('P1 Pin 1');
    });

    it('should describe a cable to-endpoint', () => {
      const conn = mockHarnessData.connections[1];
      const desc = component.getEndpointDescription(conn, 'to');
      expect(desc).toContain('W1');
      expect(desc).toContain('[L]');
    });

    it('should describe a component from-endpoint', () => {
      const conn = mockHarnessData.connections[2];
      expect(component.getEndpointDescription(conn, 'from')).toBe('R1 Pin 1');
    });

    it('should return Unknown for undefined connection', () => {
      expect(component.getEndpointDescription(undefined, 'from')).toBe('Unknown');
    });
  });

  describe('getEndpointType', () => {
    it('should return connector for from-connector endpoint', () => {
      const conn = mockHarnessData.connections[0];
      expect(component.getEndpointType(conn, 'from')).toBe('connector');
    });

    it('should return cable for to-cable endpoint', () => {
      const conn = mockHarnessData.connections[1];
      expect(component.getEndpointType(conn, 'to')).toBe('cable');
    });

    it('should return component for from-component endpoint', () => {
      const conn = mockHarnessData.connections[2];
      expect(component.getEndpointType(conn, 'from')).toBe('component');
    });

    it('should return null for undefined connection', () => {
      expect(component.getEndpointType(undefined, 'from')).toBeNull();
    });
  });

  describe('getConnectorsForSelection / getCablesForSelection / getComponentsForSelection', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
      fixture.detectChanges();
    });

    it('should return all connectors', () => {
      expect(component.getConnectorsForSelection().length).toBe(2);
    });

    it('should return all cables', () => {
      expect(component.getCablesForSelection().length).toBe(1);
    });

    it('should return all components', () => {
      expect(component.getComponentsForSelection().length).toBe(1);
    });
  });

  describe('getPinsForConnector', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
      fixture.detectChanges();
    });

    it('should return pins for a valid connector', () => {
      expect(component.getPinsForConnector('conn-1').length).toBe(4);
    });

    it('should return empty array for undefined connectorId', () => {
      expect(component.getPinsForConnector(undefined).length).toBe(0);
    });
  });

  describe('getWiresForCableId', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
      fixture.detectChanges();
    });

    it('should return wires for a valid cable', () => {
      expect(component.getWiresForCableId('cable-1').length).toBe(2);
    });

    it('should return empty array for undefined cableId', () => {
      expect(component.getWiresForCableId(undefined).length).toBe(0);
    });
  });

  describe('getPinsForComponent', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
      fixture.detectChanges();
    });

    it('should return pins with group names', () => {
      const pins = component.getPinsForComponent('comp-1');
      expect(pins.length).toBe(2);
      expect(pins[0].groupName).toBe('Leads');
      expect(pins[0].pin.number).toBe('1');
    });

    it('should return empty array for undefined componentId', () => {
      expect(component.getPinsForComponent(undefined).length).toBe(0);
    });
  });

  describe('getCurrentEndpoint methods', () => {
    it('should return from-endpoint values when selectedWireEnd is from', () => {
      const conn = mockHarnessData.connections[0];
      const selection: CanvasSelection = { type: 'wire', connection: conn };
      fixture.componentRef.setInput('selection', selection);
      fixture.detectChanges();

      component.selectedWireEnd.set('from');
      expect(component.getCurrentEndpointConnectorId()).toBe('conn-1');
      expect(component.getCurrentEndpointPinId()).toBe('pin-1');
    });

    it('should return to-endpoint values when selectedWireEnd is to', () => {
      const conn = mockHarnessData.connections[0];
      const selection: CanvasSelection = { type: 'wire', connection: conn };
      fixture.componentRef.setInput('selection', selection);
      fixture.detectChanges();

      component.selectedWireEnd.set('to');
      expect(component.getCurrentEndpointConnectorId()).toBe('conn-2');
      expect(component.getCurrentEndpointPinId()).toBe('pin-5');
    });

    it('should return cable endpoint values', () => {
      const conn = mockHarnessData.connections[1];
      const selection: CanvasSelection = { type: 'wire', connection: conn };
      fixture.componentRef.setInput('selection', selection);
      fixture.detectChanges();

      component.selectedWireEnd.set('to');
      expect(component.getCurrentEndpointCableId()).toBe('cable-1');
      expect(component.getCurrentEndpointWireId()).toBe('wire-1');
      expect(component.getCurrentEndpointSide()).toBe('left');
    });

    it('should return component endpoint values', () => {
      const conn = mockHarnessData.connections[2];
      const selection: CanvasSelection = { type: 'wire', connection: conn };
      fixture.componentRef.setInput('selection', selection);
      fixture.detectChanges();

      component.selectedWireEnd.set('from');
      expect(component.getCurrentEndpointComponentId()).toBe('comp-1');
      expect(component.getCurrentEndpointComponentPinId()).toBe('cpin-1');
    });

    it('should return undefined when no selection', () => {
      expect(component.getCurrentEndpointConnectorId()).toBeUndefined();
      expect(component.getCurrentEndpointPinId()).toBeUndefined();
    });
  });

  describe('getCurrentEndpointTermination', () => {
    it('should return from termination', () => {
      const conn = mockHarnessData.connections[0];
      const selection: CanvasSelection = { type: 'wire', connection: conn };
      fixture.componentRef.setInput('selection', selection);
      fixture.detectChanges();

      component.selectedWireEnd.set('from');
      expect(component.getCurrentEndpointTermination()).toBe('f-pin');
    });

    it('should return to termination', () => {
      const conn = mockHarnessData.connections[0];
      const selection: CanvasSelection = { type: 'wire', connection: conn };
      fixture.componentRef.setInput('selection', selection);
      fixture.detectChanges();

      component.selectedWireEnd.set('to');
      expect(component.getCurrentEndpointTermination()).toBe('m-pin');
    });
  });

  describe('updateEndpointSide', () => {
    it('should emit connectionChanged with fromSide when selectedWireEnd is from', () => {
      const emitSpy = vi.spyOn(component.connectionChanged, 'emit');
      component.selectedWireEnd.set('from');
      component.updateEndpointSide('left');
      expect(emitSpy).toHaveBeenCalledWith({ field: 'fromSide', value: 'left' });
    });

    it('should emit connectionChanged with toSide when selectedWireEnd is to', () => {
      const emitSpy = vi.spyOn(component.connectionChanged, 'emit');
      component.selectedWireEnd.set('to');
      component.updateEndpointSide('right');
      expect(emitSpy).toHaveBeenCalledWith({ field: 'toSide', value: 'right' });
    });
  });

  describe('updateEndpointTermination', () => {
    it('should emit connectionChanged with fromTermination', () => {
      const emitSpy = vi.spyOn(component.connectionChanged, 'emit');
      component.selectedWireEnd.set('from');
      component.updateEndpointTermination('ferrule');
      expect(emitSpy).toHaveBeenCalledWith({ field: 'fromTermination', value: 'ferrule' });
    });

    it('should emit connectionChanged with toTermination', () => {
      const emitSpy = vi.spyOn(component.connectionChanged, 'emit');
      component.selectedWireEnd.set('to');
      component.updateEndpointTermination('ring');
      expect(emitSpy).toHaveBeenCalledWith({ field: 'toTermination', value: 'ring' });
    });
  });

  describe('updateBulkWires', () => {
    it('should emit bulkWiresChanged for selected wire IDs', () => {
      const emitSpy = vi.spyOn(component.bulkWiresChanged, 'emit');
      const selection: CanvasSelection = {
        type: 'multiple',
        selectedIds: [
          { type: 'connection', id: 'connection-1' },
          { type: 'connection', id: 'connection-2' },
        ]
      };
      fixture.componentRef.setInput('selection', selection);
      fixture.detectChanges();

      component.updateBulkWires('color', 'RD');
      expect(emitSpy).toHaveBeenCalledWith({
        connectionIds: ['connection-1', 'connection-2'],
        field: 'color',
        value: 'RD'
      });
    });

    it('should not emit when no wires selected', () => {
      const emitSpy = vi.spyOn(component.bulkWiresChanged, 'emit');
      component.updateBulkWires('color', 'RD');
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('updateBulkWiresInput', () => {
    it('should parse lengthMm as integer and call updateBulkWires', () => {
      const emitSpy = vi.spyOn(component.bulkWiresChanged, 'emit');
      const selection: CanvasSelection = {
        type: 'multiple',
        selectedIds: [{ type: 'connection', id: 'connection-1' }]
      };
      fixture.componentRef.setInput('selection', selection);
      fixture.detectChanges();

      const event = { target: { value: '500' } } as unknown as Event;
      component.updateBulkWiresInput('lengthMm', event);
      expect(emitSpy).toHaveBeenCalledWith({
        connectionIds: ['connection-1'],
        field: 'lengthMm',
        value: 500
      });
    });
  });

  describe('getWireHex', () => {
    it('should return hex for known color code', () => {
      const hex = component.getWireHex('BK');
      expect(hex).toBe('#1a1a1a');
    });

    it('should return default gray for unknown color code', () => {
      const hex = component.getWireHex('UNKNOWN');
      expect(hex).toBe('#808080');
    });
  });

  describe('getWiresForCable', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('harnessData', mockHarnessData);
      fixture.detectChanges();
    });

    it('should return wires for a cable', () => {
      const wires = component.getWiresForCable('cable-1');
      expect(wires.length).toBe(2);
    });

    it('should return empty array for undefined', () => {
      expect(component.getWiresForCable(undefined).length).toBe(0);
    });
  });
});
