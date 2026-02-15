import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { HarnessSyncDialog, SyncChange, SyncDialogData } from './harness-sync-dialog';

describe('HarnessSyncDialog', () => {
  let component: HarnessSyncDialog;
  let fixture: ComponentFixture<HarnessSyncDialog>;
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  const mockChanges: SyncChange[] = [
    {
      elementType: 'connector',
      elementId: 'conn-1',
      label: 'J1',
      changes: [
        { field: 'Pin Count', description: '4 -> 6' },
        { field: 'Type', description: 'male -> female' }
      ],
      dbData: { pinCount: 6, type: 'female' },
      accepted: true
    },
    {
      elementType: 'cable',
      elementId: 'cable-1',
      label: 'W1',
      changes: [
        { field: 'Wire Count', description: '2 -> 4' }
      ],
      dbData: { wireCount: 4 },
      accepted: true
    },
    {
      elementType: 'component',
      elementId: 'comp-1',
      label: 'R1',
      changes: [
        { field: 'Pin Groups', description: '1 groups -> 2 groups' }
      ],
      dbData: { pinCount: 4 },
      accepted: false
    }
  ];

  beforeEach(async () => {
    dialogRef = { close: vi.fn() } as any;

    await TestBed.configureTestingModule({
      imports: [HarnessSyncDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: { changes: mockChanges } },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HarnessSyncDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should receive changes from dialog data', () => {
    expect(component.data.changes.length).toBe(3);
    expect(component.data.changes[0].label).toBe('J1');
  });

  describe('getTypeIcon', () => {
    it('should return correct icon for connector', () => {
      expect(component.getTypeIcon('connector')).toBe('settings_input_component');
    });

    it('should return correct icon for cable', () => {
      expect(component.getTypeIcon('cable')).toBe('cable');
    });

    it('should return correct icon for component', () => {
      expect(component.getTypeIcon('component')).toBe('memory');
    });

    it('should return info icon for unknown type', () => {
      expect(component.getTypeIcon('unknown')).toBe('info');
    });
  });

  describe('acceptSelected', () => {
    it('should close dialog with current changes', () => {
      component.acceptSelected();
      expect(dialogRef.close).toHaveBeenCalledWith(mockChanges);
    });

    it('should preserve accepted state of each change', () => {
      component.acceptSelected();
      const result = vi.mocked(dialogRef.close).mock.calls.at(-1)![0] as SyncChange[];
      expect(result[0].accepted).toBe(true);
      expect(result[1].accepted).toBe(true);
      expect(result[2].accepted).toBe(false);
    });
  });

  describe('keepAll', () => {
    it('should set all changes to not accepted and close', () => {
      component.keepAll();

      expect(dialogRef.close).toHaveBeenCalled();
      const result = vi.mocked(dialogRef.close).mock.calls.at(-1)![0] as SyncChange[];
      expect(result.every(c => c.accepted === false)).toBe(true);
    });
  });

  describe('with empty changes', () => {
    beforeEach(async () => {
      await TestBed.resetTestingModule().configureTestingModule({
        imports: [HarnessSyncDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: { changes: [] } },
          { provide: MatDialogRef, useValue: { close: vi.fn() } as any },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HarnessSyncDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should handle empty changes array', () => {
      expect(component.data.changes.length).toBe(0);
    });
  });
});
