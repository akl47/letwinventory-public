import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { HarnessListView } from './harness-list-view';
import { HarnessService } from '../../../services/harness.service';
import { WireHarnessSummary } from '../../../models/harness.model';

describe('HarnessListView', () => {
  let component: HarnessListView;
  let fixture: ComponentFixture<HarnessListView>;
  let harnessService: HarnessService;

  const mockHarnesses: WireHarnessSummary[] = [
    {
      id: 1, name: 'Harness Alpha', partNumber: 'HRN-001', revision: 'A',
      description: 'First harness', activeFlag: true, releaseState: 'draft',
      updatedAt: '2026-01-15T10:00:00Z', createdAt: '2026-01-01T10:00:00Z'
    } as WireHarnessSummary,
    {
      id: 2, name: 'Harness Beta', partNumber: 'HRN-002', revision: 'B',
      description: 'Second harness', activeFlag: true, releaseState: 'released',
      updatedAt: '2026-01-20T10:00:00Z', createdAt: '2026-01-05T10:00:00Z'
    } as WireHarnessSummary,
    {
      id: 3, name: 'Harness Gamma', partNumber: 'HRN-003', revision: 'A',
      description: 'Inactive harness', activeFlag: false, releaseState: 'draft',
      updatedAt: '2026-01-10T10:00:00Z', createdAt: '2026-01-02T10:00:00Z'
    } as WireHarnessSummary,
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HarnessListView],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideAnimationsAsync(), provideRouter([])],
    }).compileComponents();

    harnessService = TestBed.inject(HarnessService);
    vi.spyOn(harnessService, 'getAllHarnesses').mockReturnValue(of({
      harnesses: mockHarnesses,
      pagination: { total: 3, page: 1, limit: 20, totalPages: 1 }
    }));

    fixture = TestBed.createComponent(HarnessListView);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initial state', () => {
    it('should load harnesses on init', () => {
      expect(harnessService.getAllHarnesses).toHaveBeenCalled();
      expect(component.allHarnesses().length).toBe(3);
      expect(component.isLoading()).toBe(false);
    });

    it('should have default signal values', () => {
      expect(component.searchText()).toBe('');
      expect(component.showInactive()).toBe(false);
      expect(component.pageSize()).toBe(10);
      expect(component.pageIndex()).toBe(0);
      expect(component.sortColumn()).toBe('updatedAt');
      expect(component.sortDirection()).toBe('desc');
    });

    it('should filter out inactive harnesses by default', () => {
      // Only active harnesses shown (2 of 3)
      expect(component.displayedHarnesses().length).toBe(2);
    });
  });

  describe('applyFiltersAndSort', () => {
    it('should show inactive when toggled', () => {
      component.onToggleInactive(true);
      expect(component.showInactive()).toBe(true);
      expect(component.displayedHarnesses().length).toBe(3);
    });

    it('should filter by search text on name', () => {
      component.onSearchChange('Alpha');
      expect(component.displayedHarnesses().length).toBe(1);
      expect(component.displayedHarnesses()[0].name).toBe('Harness Alpha');
    });

    it('should filter by search text on partNumber', () => {
      component.onSearchChange('HRN-002');
      expect(component.displayedHarnesses().length).toBe(1);
      expect(component.displayedHarnesses()[0].name).toBe('Harness Beta');
    });

    it('should filter by search text on description', () => {
      component.onSearchChange('Second');
      expect(component.displayedHarnesses().length).toBe(1);
    });

    it('should be case-insensitive search', () => {
      component.onSearchChange('alpha');
      expect(component.displayedHarnesses().length).toBe(1);
    });

    it('should reset page index when searching', () => {
      component.pageIndex.set(2);
      component.onSearchChange('Alpha');
      expect(component.pageIndex()).toBe(0);
    });
  });

  describe('sorting', () => {
    it('should sort by name ascending', () => {
      component.onSortChange({ active: 'name', direction: 'asc' });
      const displayed = component.displayedHarnesses();
      expect(displayed[0].name).toBe('Harness Alpha');
      expect(displayed[1].name).toBe('Harness Beta');
    });

    it('should sort by name descending', () => {
      component.onSortChange({ active: 'name', direction: 'desc' });
      const displayed = component.displayedHarnesses();
      expect(displayed[0].name).toBe('Harness Beta');
      expect(displayed[1].name).toBe('Harness Alpha');
    });

    it('should sort by updatedAt by default (desc)', () => {
      // Default sort: updatedAt desc -> Beta (Jan 20) before Alpha (Jan 15)
      const displayed = component.displayedHarnesses();
      expect(displayed[0].name).toBe('Harness Beta');
    });
  });

  describe('pagination', () => {
    it('should update page index and size on page change', () => {
      component.onPageChange({ pageIndex: 1, pageSize: 5, length: 3 });
      expect(component.pageIndex()).toBe(1);
      expect(component.pageSize()).toBe(5);
    });
  });

  describe('getTotalCount', () => {
    it('should return count of active harnesses', () => {
      expect(component.getTotalCount()).toBe(2);
    });

    it('should return count of all harnesses when showInactive', () => {
      component.onToggleInactive(true);
      expect(component.getTotalCount()).toBe(3);
    });

    it('should return filtered count with search', () => {
      component.onSearchChange('Alpha');
      expect(component.getTotalCount()).toBe(1);
    });
  });

  describe('formatDate', () => {
    it('should format a date string', () => {
      const formatted = component.formatDate('2026-01-15T10:00:00Z');
      expect(formatted).toContain('Jan');
      expect(formatted).toContain('15');
      expect(formatted).toContain('2026');
    });
  });

  describe('onRowMouseDown', () => {
    it('should prevent default for middle click', () => {
      const event = { button: 1, preventDefault: vi.fn() } as unknown as MouseEvent;
      component.onRowMouseDown(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should not prevent default for left click', () => {
      const event = { button: 0, preventDefault: vi.fn() } as unknown as MouseEvent;
      component.onRowMouseDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('onRowAuxClick', () => {
    it('should open in new tab on middle click', () => {
      vi.spyOn(window, 'open');
      const event = { button: 1, preventDefault: vi.fn() } as unknown as MouseEvent;
      component.onRowAuxClick(event, mockHarnesses[0]);
      expect(window.open).toHaveBeenCalledWith('/#/harness/editor/1', '_blank');
    });
  });

  describe('error handling', () => {
    it('should set isLoading to false on error', () => {
      vi.mocked(harnessService.getAllHarnesses).mockReturnValue(throwError(() => new Error('fail')));
      component.loadHarnesses();
      expect(component.isLoading()).toBe(false);
    });
  });

  describe('displayedColumns', () => {
    it('should have expected columns', () => {
      expect(component.displayedColumns).toContain('name');
      expect(component.displayedColumns).toContain('partNumber');
      expect(component.displayedColumns).toContain('revision');
      expect(component.displayedColumns).toContain('releaseState');
      expect(component.displayedColumns).toContain('description');
      expect(component.displayedColumns).toContain('updatedAt');
      expect(component.displayedColumns).toContain('actions');
    });
  });
});
