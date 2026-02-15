import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { HarnessListDialog } from './harness-list-dialog';
import { HarnessService } from '../../../services/harness.service';
import { WireHarnessSummary } from '../../../models/harness.model';

describe('HarnessListDialog', () => {
  let component: HarnessListDialog;
  let fixture: ComponentFixture<HarnessListDialog>;
  let dialogRef: any;
  let harnessService: HarnessService;

  const mockHarnesses: WireHarnessSummary[] = [
    { id: 1, name: 'Harness A', partNumber: 'HRN-001', revision: 'A', activeFlag: true, updatedAt: '2026-01-15' } as WireHarnessSummary,
    { id: 2, name: 'Harness B', partNumber: 'HRN-002', revision: 'B', activeFlag: true, updatedAt: '2026-01-20' } as WireHarnessSummary,
    { id: 3, name: 'Harness C', partNumber: 'HRN-001', revision: 'C', activeFlag: true, updatedAt: '2026-01-25' } as WireHarnessSummary,
  ];

  describe('default mode', () => {
    beforeEach(async () => {
      dialogRef = { close: vi.fn() } as any;

      await TestBed.configureTestingModule({
        imports: [HarnessListDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: {} },
          { provide: MatDialogRef, useValue: dialogRef },
        ],
      }).compileComponents();

      harnessService = TestBed.inject(HarnessService);
      vi.spyOn(harnessService, 'getAllHarnesses').mockReturnValue(of({
        harnesses: mockHarnesses,
        pagination: { total: 3, page: 1, limit: 20, totalPages: 1 }
      }));

      fixture = TestBed.createComponent(HarnessListDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should load harnesses on init', () => {
      expect(harnessService.getAllHarnesses).toHaveBeenCalled();
      expect(component.harnesses().length).toBe(3);
      expect(component.loading()).toBe(false);
    });

    it('should have default state', () => {
      expect(component.selectedHarness()).toBeNull();
      expect(component.searchText).toBe('');
      expect(component.selectMode).toBe(false);
    });

    describe('selectHarness', () => {
      it('should set selectedHarness', () => {
        component.selectHarness(mockHarnesses[1]);
        expect(component.selectedHarness()?.id).toBe(2);
      });
    });

    describe('openSelected', () => {
      it('should fetch full harness and close dialog', () => {
        const fullHarness = { id: 1, name: 'Harness A', harnessData: {} } as any;
        vi.spyOn(harnessService, 'getHarnessById').mockReturnValue(of(fullHarness));

        component.selectHarness(mockHarnesses[0]);
        component.openSelected();

        expect(harnessService.getHarnessById).toHaveBeenCalledWith(1);
        expect(dialogRef.close).toHaveBeenCalledWith(fullHarness);
      });

      it('should not fetch when no harness selected', () => {
        vi.spyOn(harnessService, 'getHarnessById');
        component.openSelected();
        expect(harnessService.getHarnessById).not.toHaveBeenCalled();
      });
    });

    describe('deleteHarness', () => {
      it('should delete harness and reload on confirm', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        vi.spyOn(harnessService, 'deleteHarness').mockReturnValue(of({} as any));

        component.deleteHarness(mockHarnesses[0]);

        expect(harnessService.deleteHarness).toHaveBeenCalledWith(1);
      });

      it('should not delete when confirm cancelled', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        vi.spyOn(harnessService, 'deleteHarness');

        component.deleteHarness(mockHarnesses[0]);

        expect(harnessService.deleteHarness).not.toHaveBeenCalled();
      });
    });

    describe('onPageChange', () => {
      it('should load harnesses for new page', () => {
        component.onPageChange({ pageIndex: 2, pageSize: 20, length: 60 });
        // pageIndex is 0-based, but loadHarnesses expects 1-based
        expect(harnessService.getAllHarnesses).toHaveBeenCalledWith(3, 20);
      });
    });

    describe('formatDate', () => {
      it('should format date string', () => {
        const result = component.formatDate('2026-01-15T10:00:00Z');
        expect(result).toBeTruthy();
      });
    });

    describe('error handling', () => {
      it('should set loading false on error', () => {
        vi.mocked(harnessService.getAllHarnesses).mockReturnValue(throwError(() => new Error('fail')));
        component.loadHarnesses();
        expect(component.loading()).toBe(false);
      });
    });
  });

  describe('with excludeHarnessId', () => {
    beforeEach(async () => {
      dialogRef = { close: vi.fn() } as any;

      await TestBed.configureTestingModule({
        imports: [HarnessListDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: { excludeHarnessId: 2 } },
          { provide: MatDialogRef, useValue: dialogRef },
        ],
      }).compileComponents();

      harnessService = TestBed.inject(HarnessService);
      vi.spyOn(harnessService, 'getAllHarnesses').mockReturnValue(of({
        harnesses: mockHarnesses,
        pagination: { total: 3, page: 1, limit: 20, totalPages: 1 }
      }));

      fixture = TestBed.createComponent(HarnessListDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should filter out excluded harness by ID', () => {
      expect(component.harnesses().length).toBe(2);
      expect(component.harnesses().find(h => h.id === 2)).toBeUndefined();
    });

    it('should expose excludeHarnessId getter', () => {
      expect(component.excludeHarnessId).toBe(2);
    });
  });

  describe('with excludePartNumber', () => {
    beforeEach(async () => {
      dialogRef = { close: vi.fn() } as any;

      await TestBed.configureTestingModule({
        imports: [HarnessListDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: { excludePartNumber: 'HRN-001' } },
          { provide: MatDialogRef, useValue: dialogRef },
        ],
      }).compileComponents();

      harnessService = TestBed.inject(HarnessService);
      vi.spyOn(harnessService, 'getAllHarnesses').mockReturnValue(of({
        harnesses: mockHarnesses,
        pagination: { total: 3, page: 1, limit: 20, totalPages: 1 }
      }));

      fixture = TestBed.createComponent(HarnessListDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should filter out all revisions of excluded part number', () => {
      // HRN-001 has IDs 1 and 3
      expect(component.harnesses().length).toBe(1);
      expect(component.harnesses()[0].id).toBe(2);
    });
  });

  describe('select mode', () => {
    beforeEach(async () => {
      dialogRef = { close: vi.fn() } as any;

      await TestBed.configureTestingModule({
        imports: [HarnessListDialog],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideAnimationsAsync(),
          provideRouter([]),
          { provide: MAT_DIALOG_DATA, useValue: { selectMode: true } },
          { provide: MatDialogRef, useValue: dialogRef },
        ],
      }).compileComponents();

      harnessService = TestBed.inject(HarnessService);
      vi.spyOn(harnessService, 'getAllHarnesses').mockReturnValue(of({
        harnesses: mockHarnesses,
        pagination: { total: 3, page: 1, limit: 20, totalPages: 1 }
      }));

      fixture = TestBed.createComponent(HarnessListDialog);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should be in select mode', () => {
      expect(component.selectMode).toBe(true);
    });
  });
});
