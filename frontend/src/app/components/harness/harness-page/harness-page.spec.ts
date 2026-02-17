import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { HarnessPage } from './harness-page';
import { HarnessService } from '../../../services/harness.service';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { HarnessHistoryService } from '../../../services/harness-history.service';
import { AuthService } from '../../../services/auth.service';
import { HarnessData, HarnessConnector, createEmptyHarnessData } from '../../../models/harness.model';
import { CanvasSelection } from '../harness-canvas/harness-canvas';

describe('HarnessPage', () => {
  let component: HarnessPage;
  let fixture: ComponentFixture<HarnessPage>;
  let harnessService: HarnessService;
  let historyService: HarnessHistoryService;

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
          { id: 'pin-3', number: '3', label: '' },
          { id: 'pin-4', number: '4', label: '' },
        ],
        position: { x: 100, y: 200 }, zIndex: 1
      },
      {
        id: 'conn-2', label: 'J2', type: 'female', pinCount: 2,
        pins: [{ id: 'pin-5', number: '1' }, { id: 'pin-6', number: '2' }],
        position: { x: 400, y: 200 }, zIndex: 2
      }
    ],
    cables: [
      {
        id: 'cable-1', label: 'W1', wireCount: 2, gaugeAWG: '22',
        wires: [{ id: 'w1', color: 'Red', colorCode: 'RD' }, { id: 'w2', color: 'Black', colorCode: 'BK' }],
        position: { x: 250, y: 200 }, zIndex: 0
      }
    ],
    components: [
      {
        id: 'comp-1', label: 'R1', pinCount: 2,
        pinGroups: [{ id: 'g1', name: 'Leads', pinTypeID: null, pins: [{ id: 'cp1', number: '1' }, { id: 'cp2', number: '2' }] }],
        position: { x: 300, y: 300 }, zIndex: 3
      }
    ],
    connections: [
      {
        id: 'connection-1',
        fromConnector: 'conn-1', fromPin: 'pin-1',
        toConnector: 'conn-2', toPin: 'pin-5',
        color: 'RD'
      }
    ],
    subHarnesses: [],
    canvasSettings: { zoom: 1, gridEnabled: true, snapToGrid: true }
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HarnessPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideAnimationsAsync(), provideRouter([])],
    }).compileComponents();

    harnessService = TestBed.inject(HarnessService);
    historyService = TestBed.inject(HarnessHistoryService);
    const authService = TestBed.inject(AuthService);
    vi.spyOn(authService, 'hasPermission').mockReturnValue(true);

    fixture = TestBed.createComponent(HarnessPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initial state', () => {
    it('should have null currentHarnessId', () => {
      expect(component.currentHarnessId()).toBeNull();
    });

    it('should have select as active tool', () => {
      expect(component.activeTool()).toBe('select');
    });

    it('should have grid enabled', () => {
      expect(component.gridEnabled()).toBe(true);
    });

    it('should have showSubHarnessBounds true', () => {
      expect(component.showSubHarnessBounds()).toBe(true);
    });

    it('should have zoom at 100', () => {
      expect(component.zoomLevel()).toBe(100);
    });

    it('should have autoSave enabled', () => {
      expect(component.autoSaveEnabled()).toBe(true);
    });

    it('should not be saving', () => {
      expect(component.isSaving()).toBe(false);
    });

    it('should have null clipboard', () => {
      expect(component.clipboardConnector()).toBeNull();
    });
  });

  describe('computed properties', () => {
    it('should compute hasMultipleSelected false with no selection', () => {
      expect(component.hasMultipleSelected()).toBe(false);
    });

    it('should compute hasMultipleSelected true with multiple', () => {
      component.currentSelection.set({
        type: 'multiple',
        selectedIds: [{ type: 'connector', id: 'c1' }, { type: 'connector', id: 'c2' }]
      } as CanvasSelection);
      expect(component.hasMultipleSelected()).toBe(true);
    });

    it('should compute hasGroupSelected false by default', () => {
      expect(component.hasGroupSelected()).toBe(false);
    });

    it('should compute hasGroupSelected true when group selected', () => {
      component.currentSelection.set({
        type: 'connector',
        groupId: 'group-1'
      } as CanvasSelection);
      expect(component.hasGroupSelected()).toBe(true);
    });

    it('should compute canUndo from history service', () => {
      expect(component.canUndo()).toBe(false);
      historyService.push(createEmptyHarnessData('Test'));
      expect(component.canUndo()).toBe(true);
    });

    it('should compute canRedo from history service', () => {
      expect(component.canRedo()).toBe(false);
    });
  });

  describe('release state computed properties', () => {
    it('should compute isReleased false for draft', () => {
      component.harnessData.set({ ...mockHarnessData, releaseState: 'draft' });
      expect(component.isReleased()).toBe(false);
    });

    it('should compute isReleased true for released', () => {
      component.harnessData.set({ ...mockHarnessData, releaseState: 'released' });
      expect(component.isReleased()).toBe(true);
    });

    it('should compute isInReview true for review', () => {
      component.harnessData.set({ ...mockHarnessData, releaseState: 'review' });
      expect(component.isInReview()).toBe(true);
    });

    it('should compute isLocked true for released', () => {
      component.harnessData.set({ ...mockHarnessData, releaseState: 'released' });
      expect(component.isLocked()).toBe(true);
    });

    it('should compute isLocked true for review', () => {
      component.harnessData.set({ ...mockHarnessData, releaseState: 'review' });
      expect(component.isLocked()).toBe(true);
    });

    it('should compute isLocked false for draft', () => {
      component.harnessData.set({ ...mockHarnessData, releaseState: 'draft' });
      expect(component.isLocked()).toBe(false);
    });
  });

  describe('hasUnsavedChanges', () => {
    it('should be false when data matches original', () => {
      const data = createEmptyHarnessData('Test');
      component.harnessData.set(data);
      component.originalData.set(JSON.stringify(data));
      expect(component.hasUnsavedChanges()).toBe(false);
    });

    it('should be true when data differs from original', () => {
      const data = createEmptyHarnessData('Test');
      component.harnessData.set(data);
      component.originalData.set(JSON.stringify({ ...data, name: 'Different' }));
      expect(component.hasUnsavedChanges()).toBe(true);
    });
  });

  describe('createNewHarness', () => {
    it('should create empty harness data', () => {
      component.createNewHarness();
      const data = component.harnessData();
      expect(data).toBeTruthy();
      expect(data!.name).toBe('New Harness');
      expect(data!.connectors.length).toBe(0);
    });

    it('should create harness with part data', () => {
      component.createNewHarness({ id: 5, name: 'Motor Harness', description: 'For motor' } as any);
      const data = component.harnessData();
      expect(data!.name).toBe('Motor Harness');
      expect(data!.partNumber).toBe('Motor Harness');
      expect(data!.description).toBe('For motor');
      expect(component.linkedPartId()).toBe(5);
    });

    it('should clear history on new harness', () => {
      vi.spyOn(historyService, 'clear');
      component.createNewHarness();
      expect(historyService.clear).toHaveBeenCalled();
    });

    it('should reset currentHarnessId', () => {
      component.currentHarnessId.set(42);
      component.createNewHarness();
      expect(component.currentHarnessId()).toBeNull();
    });
  });

  describe('onToolChanged', () => {
    it('should update active tool', () => {
      component.onToolChanged('wire');
      expect(component.activeTool()).toBe('wire');
    });

    it('should update to pan', () => {
      component.onToolChanged('pan');
      expect(component.activeTool()).toBe('pan');
    });
  });

  describe('onCanvasToolChangeRequest', () => {
    it('should update active tool from canvas request', () => {
      component.onCanvasToolChangeRequest('nodeEdit');
      expect(component.activeTool()).toBe('nodeEdit');
    });
  });

  describe('onSelectionChanged', () => {
    it('should update current selection', () => {
      const selection: CanvasSelection = { type: 'connector', connector: mockHarnessData.connectors[0] };
      component.onSelectionChanged(selection);
      expect(component.currentSelection()?.type).toBe('connector');
    });
  });

  describe('onDataChanged', () => {
    it('should update harnessData', () => {
      component.onDataChanged(mockHarnessData);
      expect(component.harnessData()?.name).toBe('Test Harness');
    });
  });

  describe('onMetadataChanged', () => {
    it('should update harness metadata field', () => {
      component.harnessData.set({ ...mockHarnessData });
      vi.spyOn(historyService, 'push');

      component.onMetadataChanged({ field: 'name', value: 'Updated Name' });

      expect(component.harnessData()!.name).toBe('Updated Name');
      expect(historyService.push).toHaveBeenCalled();
    });

    it('should not update when harnessData is null', () => {
      component.harnessData.set(null);
      component.onMetadataChanged({ field: 'name', value: 'Test' });
      expect(component.harnessData()).toBeNull();
    });
  });

  describe('onConnectorPropertyChanged', () => {
    it('should update connector property', () => {
      component.harnessData.set({ ...mockHarnessData });
      component.currentSelection.set({ type: 'connector', connector: mockHarnessData.connectors[0] });
      vi.spyOn(historyService, 'push');

      component.onConnectorPropertyChanged({ field: 'label', value: 'J1-Updated' });

      const updatedConn = component.harnessData()!.connectors.find(c => c.id === 'conn-1');
      expect(updatedConn!.label).toBe('J1-Updated');
    });

    it('should regenerate pins when pinCount increases', () => {
      component.harnessData.set({ ...mockHarnessData });
      component.currentSelection.set({ type: 'connector', connector: mockHarnessData.connectors[0] });

      component.onConnectorPropertyChanged({ field: 'pinCount', value: 6 });

      const updatedConn = component.harnessData()!.connectors.find(c => c.id === 'conn-1');
      expect(updatedConn!.pins.length).toBe(6);
    });

    it('should truncate pins when pinCount decreases', () => {
      component.harnessData.set({ ...mockHarnessData });
      component.currentSelection.set({ type: 'connector', connector: mockHarnessData.connectors[0] });

      component.onConnectorPropertyChanged({ field: 'pinCount', value: 2 });

      const updatedConn = component.harnessData()!.connectors.find(c => c.id === 'conn-1');
      expect(updatedConn!.pins.length).toBe(2);
    });
  });

  describe('onConnectionPropertyChanged', () => {
    it('should update connection property', () => {
      component.harnessData.set({ ...mockHarnessData });
      const conn = mockHarnessData.connections[0];
      component.currentSelection.set({ type: 'wire', connection: conn });
      vi.spyOn(historyService, 'push');

      component.onConnectionPropertyChanged({ field: 'color', value: 'BK' });

      const updated = component.harnessData()!.connections.find(c => c.id === 'connection-1');
      expect(updated!.color).toBe('BK');
    });
  });

  describe('onPinLabelChanged', () => {
    it('should update pin label', () => {
      component.harnessData.set({ ...mockHarnessData });
      component.currentSelection.set({ type: 'connector', connector: mockHarnessData.connectors[0] });

      component.onPinLabelChanged({ index: 0, label: 'VCC' });

      const updatedConn = component.harnessData()!.connectors.find(c => c.id === 'conn-1');
      expect(updatedConn!.pins[0].label).toBe('VCC');
    });
  });

  describe('onBulkWiresChanged', () => {
    it('should update multiple connections at once', () => {
      const data = {
        ...mockHarnessData,
        connections: [
          { id: 'c1', color: 'RD' } as any,
          { id: 'c2', color: 'BK' } as any,
          { id: 'c3', color: 'GN' } as any,
        ]
      };
      component.harnessData.set(data);
      vi.spyOn(historyService, 'push');

      component.onBulkWiresChanged({ connectionIds: ['c1', 'c2'], field: 'color', value: 'BU' });

      const connections = component.harnessData()!.connections;
      expect(connections.find(c => c.id === 'c1')!.color).toBe('BU');
      expect(connections.find(c => c.id === 'c2')!.color).toBe('BU');
      expect(connections.find(c => c.id === 'c3')!.color).toBe('GN'); // unchanged
    });
  });

  describe('copyConnector / pasteConnector', () => {
    it('should copy selected connector to clipboard', () => {
      component.harnessData.set({ ...mockHarnessData });
      component.currentSelection.set({ type: 'connector', connector: mockHarnessData.connectors[0] });

      component.copyConnector();

      expect(component.clipboardConnector()).toBeTruthy();
      expect(component.clipboardConnector()!.label).toBe('J1');
    });

    it('should not copy when no connector selected', () => {
      component.currentSelection.set({ type: 'none' } as CanvasSelection);
      component.copyConnector();
      expect(component.clipboardConnector()).toBeNull();
    });

    it('should paste connector with new ID and offset position', () => {
      component.harnessData.set({ ...mockHarnessData });
      component.currentSelection.set({ type: 'connector', connector: mockHarnessData.connectors[0] });

      component.copyConnector();
      vi.spyOn(historyService, 'push');
      component.pasteConnector();

      const connectors = component.harnessData()!.connectors;
      expect(connectors.length).toBe(3); // 2 original + 1 pasted
      const pasted = connectors[2];
      expect(pasted.id).not.toBe('conn-1');
      expect(pasted.position.x).toBe(140); // 100 + 40
      expect(pasted.position.y).toBe(240); // 200 + 40
    });

    it('should not paste when clipboard is empty', () => {
      component.harnessData.set({ ...mockHarnessData });
      component.pasteConnector();
      expect(component.harnessData()!.connectors.length).toBe(2);
    });
  });

  describe('onSubHarnessDataChanged', () => {
    it('should store pending sub-harness changes', () => {
      const subData = createEmptyHarnessData('Sub');
      component.onSubHarnessDataChanged({ subHarnessId: 5, data: subData });
      expect(component.hasPendingSubHarnessChanges()).toBe(true);
    });
  });

  describe('onDragStart / onDragEnd', () => {
    it('should begin transaction on drag start', () => {
      component.harnessData.set({ ...mockHarnessData });
      vi.spyOn(historyService, 'beginTransaction');
      component.onDragStart();
      expect(historyService.beginTransaction).toHaveBeenCalled();
    });

    it('should commit transaction on drag end', () => {
      component.harnessData.set({ ...mockHarnessData });
      vi.spyOn(historyService, 'commitTransaction');
      component.onDragEnd();
      expect(historyService.commitTransaction).toHaveBeenCalled();
    });
  });

  describe('onUndo / onRedo', () => {
    it('should restore previous state on undo', () => {
      const original = createEmptyHarnessData('Original');
      component.harnessData.set(original);
      historyService.push(original);

      const modified = { ...original, name: 'Modified' };
      component.harnessData.set(modified);

      component.onUndo();

      expect(component.harnessData()!.name).toBe('Original');
    });

    it('should not change when nothing to undo', () => {
      historyService.clear();
      const data = createEmptyHarnessData('Current');
      component.harnessData.set(data);
      component.onUndo();
      expect(component.harnessData()!.name).toBe('Current');
    });

    it('should restore next state on redo', () => {
      const original = createEmptyHarnessData('Original');
      component.harnessData.set(original);
      historyService.push(original);

      const modified = { ...original, name: 'Modified' };
      component.harnessData.set(modified);

      component.onUndo(); // back to Original
      component.onRedo(); // forward to Modified

      // After redo, should get Modified back
      expect(component.harnessData()!.name).toBe('Modified');
    });
  });

  describe('layer ordering', () => {
    beforeEach(() => {
      component.harnessData.set({ ...mockHarnessData });
    });

    it('should bring connector to front', () => {
      component.currentSelection.set({ type: 'connector', connector: mockHarnessData.connectors[0] });
      vi.spyOn(historyService, 'push');

      component.onBringToFront();

      const conn = component.harnessData()!.connectors.find(c => c.id === 'conn-1');
      expect(conn!.zIndex).toBe(4); // max was 3, so 3+1
    });

    it('should send connector to back', () => {
      component.currentSelection.set({ type: 'connector', connector: mockHarnessData.connectors[0] });
      vi.spyOn(historyService, 'push');

      component.onSendToBack();

      const conn = component.harnessData()!.connectors.find(c => c.id === 'conn-1');
      expect(conn!.zIndex).toBe(-1); // min was 0, so 0-1
    });

    it('should move connector forward by 1', () => {
      component.currentSelection.set({ type: 'connector', connector: mockHarnessData.connectors[0] });
      vi.spyOn(historyService, 'push');

      component.onMoveForward();

      const conn = component.harnessData()!.connectors.find(c => c.id === 'conn-1');
      expect(conn!.zIndex).toBe(2); // was 1, now 2
    });

    it('should move connector backward by 1', () => {
      component.currentSelection.set({ type: 'connector', connector: mockHarnessData.connectors[0] });
      vi.spyOn(historyService, 'push');

      component.onMoveBackward();

      const conn = component.harnessData()!.connectors.find(c => c.id === 'conn-1');
      expect(conn!.zIndex).toBe(0); // was 1, now 0
    });

    it('should bring cable to front', () => {
      component.currentSelection.set({ type: 'cable', cable: mockHarnessData.cables[0] });
      vi.spyOn(historyService, 'push');

      component.onBringToFront();

      const cable = component.harnessData()!.cables.find(c => c.id === 'cable-1');
      expect(cable!.zIndex).toBe(4);
    });

    it('should bring component to front', () => {
      component.currentSelection.set({ type: 'component', component: mockHarnessData.components![0] });
      vi.spyOn(historyService, 'push');

      component.onBringToFront();

      const comp = component.harnessData()!.components!.find(c => c.id === 'comp-1');
      expect(comp!.zIndex).toBe(4);
    });
  });

  describe('onConnectorMoved', () => {
    it('should update connector position in harnessData', () => {
      component.harnessData.set({ ...mockHarnessData });
      const movedConnector = { ...mockHarnessData.connectors[0], position: { x: 150, y: 250 } };

      component.onConnectorMoved({ connector: movedConnector, x: 150, y: 250 });

      const conn = component.harnessData()!.connectors.find(c => c.id === 'conn-1');
      expect(conn!.position).toEqual({ x: 150, y: 250 });
    });
  });

  describe('onCableMoved', () => {
    it('should update cable position in harnessData', () => {
      component.harnessData.set({ ...mockHarnessData });
      const movedCable = { ...mockHarnessData.cables[0], position: { x: 300, y: 300 } };

      component.onCableMoved({ cable: movedCable, x: 300, y: 300 });

      const cable = component.harnessData()!.cables.find(c => c.id === 'cable-1');
      expect(cable!.position).toEqual({ x: 300, y: 300 });
    });
  });

  describe('onComponentMoved', () => {
    it('should update component position in harnessData', () => {
      component.harnessData.set({ ...mockHarnessData });
      const movedComp = { ...mockHarnessData.components![0], position: { x: 350, y: 350 } };

      component.onComponentMoved({ component: movedComp, x: 350, y: 350 });

      const comp = component.harnessData()!.components!.find(c => c.id === 'comp-1');
      expect(comp!.position).toEqual({ x: 350, y: 350 });
    });
  });

  describe('onExportJSON', () => {
    it('should not throw when harnessData is null', () => {
      component.harnessData.set(null);
      expect(() => component.onExportJSON()).not.toThrow();
    });

    it('should create download link for JSON export', () => {
      component.harnessData.set({ ...mockHarnessData });
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
      vi.spyOn(URL, 'revokeObjectURL');

      const mockA = { href: '', download: '', click: vi.fn() };
      const spy = vi.spyOn(document, 'createElement').mockReturnValue(mockA as any);

      component.onExportJSON();

      expect(spy).toHaveBeenCalledWith('a');
      expect(mockA.click).toHaveBeenCalled();
      expect(mockA.download).toBe('Test Harness.json');

      spy.mockRestore();
    });
  });

  describe('loadHarness', () => {
    it('should load harness from service', () => {
      vi.spyOn(harnessService, 'getHarnessById').mockReturnValue(of({
        id: 1,
        name: 'Loaded Harness',
        partNumber: 'HRN-100',
        revision: 'B',
        description: 'Loaded',
        releaseState: 'draft',
        partID: 10,
        harnessData: {
          name: 'Loaded Harness', partNumber: 'HRN-100', revision: 'B', description: 'Loaded',
          connectors: [], cables: [], components: [], connections: [],
          canvasSettings: { zoom: 1, gridEnabled: true, snapToGrid: true }
        }
      } as any));
      vi.spyOn(historyService, 'clear');

      component.loadHarness(1);

      expect(harnessService.getHarnessById).toHaveBeenCalledWith(1);
      expect(component.currentHarnessId()).toBe(1);
      expect(component.linkedPartId()).toBe(10);
      expect(historyService.clear).toHaveBeenCalled();
    });
  });

  describe('onSubHarnessEditModeChanged', () => {
    it('should not throw when called', () => {
      expect(() => component.onSubHarnessEditModeChanged(true)).not.toThrow();
      expect(() => component.onSubHarnessEditModeChanged(false)).not.toThrow();
    });
  });

  describe('ngOnDestroy', () => {
    it('should not throw on destroy', () => {
      expect(() => component.ngOnDestroy()).not.toThrow();
    });
  });
});
