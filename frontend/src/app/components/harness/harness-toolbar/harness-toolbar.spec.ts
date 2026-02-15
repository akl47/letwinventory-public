import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { HarnessToolbar, HarnessTool } from './harness-toolbar';

describe('HarnessToolbar', () => {
  let component: HarnessToolbar;
  let fixture: ComponentFixture<HarnessToolbar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HarnessToolbar],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideAnimationsAsync(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(HarnessToolbar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('inputs', () => {
    it('should have default input values', () => {
      expect(component.hasChanges()).toBe(false);
      expect(component.isSaving()).toBe(false);
      expect(component.zoomLevel()).toBe(100);
      expect(component.gridEnabled()).toBe(true);
      expect(component.harnessName()).toBe('');
      expect(component.harnessPartNumber()).toBe('');
      expect(component.harnessRevision()).toBe('');
      expect(component.hasElementSelected()).toBe(false);
      expect(component.activeTool()).toBe('select');
      expect(component.canUndo()).toBe(false);
      expect(component.canRedo()).toBe(false);
      expect(component.isLocked()).toBe(false);
      expect(component.showSubHarnessBounds()).toBe(true);
    });

    it('should accept input values via setInput', () => {
      fixture.componentRef.setInput('hasChanges', true);
      fixture.componentRef.setInput('isSaving', true);
      fixture.componentRef.setInput('zoomLevel', 150);
      fixture.componentRef.setInput('gridEnabled', false);
      fixture.componentRef.setInput('harnessName', 'Test Harness');
      fixture.componentRef.setInput('harnessPartNumber', 'HRN-001');
      fixture.componentRef.setInput('harnessRevision', 'A');
      fixture.componentRef.setInput('hasElementSelected', true);
      fixture.componentRef.setInput('activeTool', 'wire');
      fixture.componentRef.setInput('canUndo', true);
      fixture.componentRef.setInput('canRedo', true);
      fixture.componentRef.setInput('isLocked', true);
      fixture.componentRef.setInput('showSubHarnessBounds', false);
      fixture.detectChanges();

      expect(component.hasChanges()).toBe(true);
      expect(component.isSaving()).toBe(true);
      expect(component.zoomLevel()).toBe(150);
      expect(component.gridEnabled()).toBe(false);
      expect(component.harnessName()).toBe('Test Harness');
      expect(component.harnessPartNumber()).toBe('HRN-001');
      expect(component.harnessRevision()).toBe('A');
      expect(component.hasElementSelected()).toBe(true);
      expect(component.activeTool()).toBe('wire');
      expect(component.canUndo()).toBe(true);
      expect(component.canRedo()).toBe(true);
      expect(component.isLocked()).toBe(true);
      expect(component.showSubHarnessBounds()).toBe(false);
    });
  });

  describe('setTool', () => {
    it('should emit toolChanged with the selected tool', () => {
      const emitSpy = vi.spyOn(component.toolChanged, 'emit');
      component.setTool('wire');
      expect(emitSpy).toHaveBeenCalledWith('wire');
    });

    it('should emit toolChanged with pan tool', () => {
      const emitSpy = vi.spyOn(component.toolChanged, 'emit');
      component.setTool('pan');
      expect(emitSpy).toHaveBeenCalledWith('pan');
    });

    it('should emit toolChanged with select tool', () => {
      const emitSpy = vi.spyOn(component.toolChanged, 'emit');
      component.setTool('select');
      expect(emitSpy).toHaveBeenCalledWith('select');
    });

    it('should emit toolChanged with nodeEdit tool', () => {
      const emitSpy = vi.spyOn(component.toolChanged, 'emit');
      component.setTool('nodeEdit');
      expect(emitSpy).toHaveBeenCalledWith('nodeEdit');
    });

    it('should emit toolChanged with connector tool', () => {
      const emitSpy = vi.spyOn(component.toolChanged, 'emit');
      component.setTool('connector');
      expect(emitSpy).toHaveBeenCalledWith('connector');
    });
  });

  describe('outputs', () => {
    it('should have output emitters defined', () => {
      expect(component.newHarness).toBeDefined();
      expect(component.openHarness).toBeDefined();
      expect(component.save).toBeDefined();
      expect(component.exportJSON).toBeDefined();
      expect(component.exportPNG).toBeDefined();
      expect(component.importJSON).toBeDefined();
      expect(component.addConnector).toBeDefined();
      expect(component.addCable).toBeDefined();
      expect(component.addComponent).toBeDefined();
      expect(component.addSubHarness).toBeDefined();
      expect(component.deleteSelected).toBeDefined();
      expect(component.rotateConnector).toBeDefined();
      expect(component.flipConnector).toBeDefined();
      expect(component.zoomIn).toBeDefined();
      expect(component.zoomOut).toBeDefined();
      expect(component.resetZoom).toBeDefined();
      expect(component.gridEnabledChange).toBeDefined();
      expect(component.showSubHarnessBoundsChange).toBeDefined();
      expect(component.toolChanged).toBeDefined();
      expect(component.undo).toBeDefined();
      expect(component.redo).toBeDefined();
    });
  });
});
