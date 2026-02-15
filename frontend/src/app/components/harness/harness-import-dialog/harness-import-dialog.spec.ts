import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { HarnessImportDialog } from './harness-import-dialog';
import { HarnessService } from '../../../services/harness.service';

describe('HarnessImportDialog', () => {
  let component: HarnessImportDialog;
  let fixture: ComponentFixture<HarnessImportDialog>;
  let dialogRef: any;
  let harnessService: HarnessService;

  beforeEach(async () => {
    dialogRef = { close: vi.fn() } as any;

    await TestBed.configureTestingModule({
      imports: [HarnessImportDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    harnessService = TestBed.inject(HarnessService);

    fixture = TestBed.createComponent(HarnessImportDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initial state', () => {
    it('should have default signal values', () => {
      expect(component.isDragOver()).toBe(false);
      expect(component.fileContent()).toBe('');
      expect(component.fileName()).toBe('');
      expect(component.validating()).toBe(false);
      expect(component.validationErrors().length).toBe(0);
      expect(component.parsedData()).toBeNull();
      expect(component.isValid()).toBe(false);
      expect(component.showSample).toBe(false);
    });

    it('should have empty pastedJson', () => {
      expect(component.pastedJson).toBe('');
    });

    it('should have sample JSON defined', () => {
      expect(component.sampleJson).toBeTruthy();
      expect(component.sampleJson).toContain('Sample Harness');
    });
  });

  describe('drag events', () => {
    it('should set isDragOver true on dragOver', () => {
      const event = { preventDefault: vi.fn() } as unknown as DragEvent;
      component.onDragOver(event);
      expect(component.isDragOver()).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should set isDragOver false on dragLeave', () => {
      component.isDragOver.set(true);
      const event = { preventDefault: vi.fn() } as unknown as DragEvent;
      component.onDragLeave(event);
      expect(component.isDragOver()).toBe(false);
    });

    it('should set isDragOver false on drop', () => {
      component.isDragOver.set(true);
      const event = {
        preventDefault: vi.fn(),
        dataTransfer: { files: [] }
      } as unknown as DragEvent;
      component.onDrop(event);
      expect(component.isDragOver()).toBe(false);
    });
  });

  describe('clearFile', () => {
    it('should reset all file-related state', () => {
      component.fileContent.set('some content');
      component.fileName.set('file.json');
      component.parsedData.set({} as any);
      component.isValid.set(true);
      component.validationErrors.set([{ message: 'error' }]);

      const event = { stopPropagation: vi.fn() } as unknown as Event;
      component.clearFile(event);

      expect(component.fileContent()).toBe('');
      expect(component.fileName()).toBe('');
      expect(component.parsedData()).toBeNull();
      expect(component.isValid()).toBe(false);
      expect(component.validationErrors().length).toBe(0);
      expect(event.stopPropagation).toHaveBeenCalled();
    });
  });

  describe('onJsonPasted', () => {
    it('should clear file state and validate when JSON pasted', () => {
      vi.spyOn(harnessService, 'validateHarness').mockReturnValue(of({ valid: true, errors: [] }));

      component.pastedJson = JSON.stringify({
        name: 'Test', connectors: [], cables: [], connections: []
      });
      component.fileContent.set('old content');
      component.fileName.set('old.json');

      component.onJsonPasted();

      expect(component.fileContent()).toBe('');
      expect(component.fileName()).toBe('');
    });

    it('should reset validation state when pasted JSON is empty', () => {
      component.pastedJson = '   ';
      component.parsedData.set({} as any);
      component.isValid.set(true);

      component.onJsonPasted();

      expect(component.parsedData()).toBeNull();
      expect(component.isValid()).toBe(false);
    });
  });

  describe('JSON validation', () => {
    it('should set validation errors for invalid JSON syntax', () => {
      component.pastedJson = 'not valid json {{{';
      component.onJsonPasted();

      expect(component.validationErrors().length).toBeGreaterThan(0);
      expect(component.validationErrors()[0].message).toContain('Invalid JSON');
      expect(component.isValid()).toBe(false);
    });

    it('should set error when name is missing', () => {
      vi.spyOn(harnessService, 'validateHarness').mockReturnValue(of({ valid: true, errors: [] }));

      component.pastedJson = JSON.stringify({ connectors: [], cables: [], connections: [] });
      component.onJsonPasted();

      expect(component.validationErrors().some(e => e.message.includes('name'))).toBe(true);
    });

    it('should set error when connectors is not an array', () => {
      component.pastedJson = JSON.stringify({ name: 'Test', connectors: 'bad', cables: [], connections: [] });
      component.onJsonPasted();

      expect(component.validationErrors().some(e => e.message.includes('connectors'))).toBe(true);
    });

    it('should set error when cables is not an array', () => {
      component.pastedJson = JSON.stringify({ name: 'Test', connectors: [], cables: 'bad', connections: [] });
      component.onJsonPasted();

      expect(component.validationErrors().some(e => e.message.includes('cables'))).toBe(true);
    });

    it('should set error when connections is not an array', () => {
      component.pastedJson = JSON.stringify({ name: 'Test', connectors: [], cables: [], connections: 'bad' });
      component.onJsonPasted();

      expect(component.validationErrors().some(e => e.message.includes('connections'))).toBe(true);
    });

    it('should validate via backend and set valid on success', () => {
      vi.spyOn(harnessService, 'validateHarness').mockReturnValue(of({ valid: true, errors: [] }));

      component.pastedJson = JSON.stringify({
        name: 'Test', connectors: [], cables: [], connections: []
      });
      component.onJsonPasted();

      expect(component.isValid()).toBe(true);
      expect(component.parsedData()).toBeTruthy();
    });

    it('should show backend validation errors', () => {
      vi.spyOn(harnessService, 'validateHarness').mockReturnValue(of({
        valid: false,
        errors: ['Connector J1 references nonexistent pin']
      }));

      component.pastedJson = JSON.stringify({
        name: 'Test', connectors: [], cables: [], connections: []
      });
      component.onJsonPasted();

      expect(component.isValid()).toBe(false);
      expect(component.validationErrors().length).toBe(1);
    });

    it('should accept data if backend validation fails (fallback)', () => {
      vi.spyOn(harnessService, 'validateHarness').mockReturnValue(throwError(() => new Error('Server error')));

      component.pastedJson = JSON.stringify({
        name: 'Test', connectors: [], cables: [], connections: []
      });
      component.onJsonPasted();

      // Falls back to accepting if basic structure is OK
      expect(component.isValid()).toBe(true);
    });
  });

  describe('useSample', () => {
    it('should populate pastedJson with sample and validate', () => {
      vi.spyOn(harnessService, 'validateHarness').mockReturnValue(of({ valid: true, errors: [] }));

      component.useSample();

      expect(component.pastedJson).toBe(component.sampleJson);
      expect(component.fileContent()).toBe('');
      expect(component.fileName()).toBe('');
    });
  });

  describe('import', () => {
    it('should close dialog with parsed data', () => {
      const testData = { name: 'Test', connectors: [], cables: [], connections: [] } as any;
      component.parsedData.set(testData);

      component.import();

      expect(dialogRef.close).toHaveBeenCalledWith(testData);
    });

    it('should not close if no parsed data', () => {
      component.parsedData.set(null);
      component.import();
      expect(dialogRef.close).not.toHaveBeenCalled();
    });
  });

  describe('file processing', () => {
    it('should reject non-JSON files', () => {
      const event = {
        target: {
          files: [new File(['content'], 'test.txt', { type: 'text/plain' })]
        }
      } as unknown as Event;

      component.onFileSelected(event);

      expect(component.validationErrors().length).toBe(1);
      expect(component.validationErrors()[0].message).toContain('.json');
    });
  });
});
