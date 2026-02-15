import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { vi } from 'vitest';

import { HarnessCanvas } from './harness-canvas';
import { HarnessData, HarnessConnector, HarnessCable, HarnessComponent, createEmptyHarnessData } from '../../../models/harness.model';

describe('HarnessCanvas', () => {
  let component: HarnessCanvas;
  let fixture: ComponentFixture<HarnessCanvas>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HarnessCanvas],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HarnessCanvas);
    component = fixture.componentInstance;

    // Prevent actual canvas rendering that would fail without real DOM canvas
    vi.spyOn(component as any, 'render').mockImplementation(() => {});

    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('default input values', () => {
    it('should have null harnessData by default', () => {
      expect(component.harnessData()).toBeNull();
    });

    it('should have select as default active tool', () => {
      expect(component.activeTool()).toBe('select');
    });

    it('should have grid enabled by default', () => {
      expect(component.gridEnabled()).toBe(true);
    });

    it('should have grid size of 20 by default', () => {
      expect(component.gridSize()).toBe(20);
    });

    it('should have isLocked false by default', () => {
      expect(component.isLocked()).toBe(false);
    });

    it('should have showSubHarnessBounds true by default', () => {
      expect(component.showSubHarnessBounds()).toBe(true);
    });
  });

  describe('outputs', () => {
    it('should have all output emitters defined', () => {
      expect(component.selectionChanged).toBeDefined();
      expect(component.dataChanged).toBeDefined();
      expect(component.connectorMoved).toBeDefined();
      expect(component.cableMoved).toBeDefined();
      expect(component.componentMoved).toBeDefined();
      expect(component.editConnector).toBeDefined();
      expect(component.editCable).toBeDefined();
      expect(component.editComponent).toBeDefined();
      expect(component.editChildConnector).toBeDefined();
      expect(component.editChildCable).toBeDefined();
      expect(component.editChildComponent).toBeDefined();
      expect(component.bringToFront).toBeDefined();
      expect(component.moveForward).toBeDefined();
      expect(component.moveBackward).toBeDefined();
      expect(component.sendToBack).toBeDefined();
      expect(component.rotateSelected).toBeDefined();
      expect(component.flipSelected).toBeDefined();
      expect(component.requestDelete).toBeDefined();
      expect(component.requestToolChange).toBeDefined();
      expect(component.subHarnessDataChanged).toBeDefined();
      expect(component.subHarnessEditModeChanged).toBeDefined();
      expect(component.dragStart).toBeDefined();
      expect(component.dragEnd).toBeDefined();
    });
  });

  describe('zoom', () => {
    it('should have default zoom of 1', () => {
      expect(component.zoom()).toBe(1);
    });

    it('should increase zoom on zoomIn', () => {
      component.zoomIn();
      expect(component.zoom()).toBeGreaterThan(1);
    });

    it('should decrease zoom on zoomOut', () => {
      component.zoomOut();
      expect(component.zoom()).toBeLessThan(1);
    });

    it('should reset zoom to 1', () => {
      component.zoomIn();
      component.zoomIn();
      component.resetZoom();
      expect(component.zoom()).toBe(1);
    });

    it('should cap zoom at max 5', () => {
      for (let i = 0; i < 30; i++) {
        component.zoomIn();
      }
      expect(component.zoom()).toBeLessThanOrEqual(5);
    });

    it('should cap zoom at min 0.1', () => {
      for (let i = 0; i < 50; i++) {
        component.zoomOut();
      }
      expect(component.zoom()).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe('context menu state', () => {
    it('should have context menu hidden by default', () => {
      expect(component.contextMenuVisible).toBe(false);
    });

    it('should have context menu at 0,0', () => {
      expect(component.contextMenuX).toBe(0);
      expect(component.contextMenuY).toBe(0);
    });
  });

  describe('sub-harness edit mode', () => {
    it('should have no sub-harness being edited by default', () => {
      expect(component.editingSubHarnessId()).toBeNull();
    });
  });

  describe('debug flag', () => {
    it('should have debug bounds disabled by default', () => {
      expect(component.debugShowBounds).toBe(false);
    });
  });

  describe('addConnector', () => {
    it('should add a connector to harnessData and emit dataChanged', () => {
      const emitSpy = vi.spyOn(component.dataChanged, 'emit');
      const data = createEmptyHarnessData('Test');
      fixture.componentRef.setInput('harnessData', data);
      fixture.detectChanges();

      const connector: HarnessConnector = {
        id: 'conn-1', label: 'J1', type: 'male', pinCount: 2,
        pins: [{ id: 'p1', number: '1' }, { id: 'p2', number: '2' }],
        position: { x: 100, y: 200 }
      };

      component.addConnector(connector);

      expect(emitSpy).toHaveBeenCalled();
      const emittedData = vi.mocked(emitSpy).mock.lastCall![0] as HarnessData;
      expect(emittedData.connectors.length).toBe(1);
      expect(emittedData.connectors[0].label).toBe('J1');
    });

    it('should not add when harnessData is null', () => {
      const emitSpy = vi.spyOn(component.dataChanged, 'emit');
      component.addConnector({ id: 'c1', label: 'J1', type: 'male', pinCount: 1, pins: [], position: { x: 0, y: 0 } });
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('addCable', () => {
    it('should add a cable to harnessData and emit dataChanged', () => {
      const emitSpy = vi.spyOn(component.dataChanged, 'emit');
      const data = createEmptyHarnessData('Test');
      fixture.componentRef.setInput('harnessData', data);
      fixture.detectChanges();

      const cable: HarnessCable = {
        id: 'cable-1', label: 'W1', wireCount: 2,
        wires: [
          { id: 'w1', color: 'Red', colorCode: 'RD' },
          { id: 'w2', color: 'Black', colorCode: 'BK' }
        ],
        position: { x: 200, y: 200 }
      };

      component.addCable(cable);

      expect(emitSpy).toHaveBeenCalled();
      const emittedData = vi.mocked(emitSpy).mock.lastCall![0] as HarnessData;
      expect(emittedData.cables.length).toBe(1);
      expect(emittedData.cables[0].label).toBe('W1');
    });
  });

  describe('addComponent', () => {
    it('should add a component to harnessData and emit dataChanged', () => {
      const emitSpy = vi.spyOn(component.dataChanged, 'emit');
      const data = createEmptyHarnessData('Test');
      fixture.componentRef.setInput('harnessData', data);
      fixture.detectChanges();

      const comp: HarnessComponent = {
        id: 'comp-1', label: 'R1', pinCount: 2,
        pinGroups: [{ id: 'g1', name: 'Leads', pinTypeID: null, pins: [{ id: 'p1', number: '1' }, { id: 'p2', number: '2' }] }],
        position: { x: 300, y: 300 }
      };

      component.addComponent(comp);

      expect(emitSpy).toHaveBeenCalled();
      const emittedData = vi.mocked(emitSpy).mock.lastCall![0] as HarnessData;
      expect(emittedData.components!.length).toBe(1);
      expect(emittedData.components![0].label).toBe('R1');
    });
  });

  describe('deleteSelected', () => {
    it('should not emit when harnessData is null', () => {
      const emitSpy = vi.spyOn(component.dataChanged, 'emit');
      component.deleteSelected();
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('should not emit when nothing is selected', () => {
      const emitSpy = vi.spyOn(component.dataChanged, 'emit');
      const data = createEmptyHarnessData('Test');
      fixture.componentRef.setInput('harnessData', data);
      fixture.detectChanges();

      component.deleteSelected();
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('groupSelected / ungroupSelected', () => {
    it('should not emit when harnessData is null', () => {
      const emitSpy = vi.spyOn(component.dataChanged, 'emit');
      component.groupSelected();
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('should not emit for ungroupSelected when harnessData is null', () => {
      const emitSpy = vi.spyOn(component.dataChanged, 'emit');
      component.ungroupSelected();
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('updateSubHarnessData', () => {
    it('should not throw when called with unknown ID', () => {
      expect(() => {
        component.updateSubHarnessData(999, createEmptyHarnessData('Sub'));
      }).not.toThrow();
    });
  });

  describe('normalizeAllConnections', () => {
    it('should not throw when harnessData is null', () => {
      expect(() => component.normalizeAllConnections()).not.toThrow();
    });

    it('should not throw with empty connections', () => {
      const data = createEmptyHarnessData('Test');
      fixture.componentRef.setInput('harnessData', data);
      fixture.detectChanges();
      expect(() => component.normalizeAllConnections()).not.toThrow();
    });
  });

  describe('exportAsPNG', () => {
    it('should return null when no harnessData', () => {
      expect(component.exportAsPNG()).toBeNull();
    });
  });

  describe('exportAsThumbnail', () => {
    it('should return a data URL string', () => {
      expect(typeof component.exportAsThumbnail()).toBe('string');
    });
  });

  describe('input changes', () => {
    it('should accept harnessData input', () => {
      const data = createEmptyHarnessData('Test');
      fixture.componentRef.setInput('harnessData', data);
      fixture.detectChanges();
      expect(component.harnessData()?.name).toBe('Test');
    });

    it('should accept activeTool input', () => {
      fixture.componentRef.setInput('activeTool', 'wire');
      fixture.detectChanges();
      expect(component.activeTool()).toBe('wire');
    });

    it('should accept gridEnabled input', () => {
      fixture.componentRef.setInput('gridEnabled', false);
      fixture.detectChanges();
      expect(component.gridEnabled()).toBe(false);
    });

    it('should accept isLocked input', () => {
      fixture.componentRef.setInput('isLocked', true);
      fixture.detectChanges();
      expect(component.isLocked()).toBe(true);
    });
  });
});
