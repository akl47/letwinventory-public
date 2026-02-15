import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { Location } from '@angular/common';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ScheduledTasksListView } from './scheduled-tasks-list-view';
import { ScheduledTaskService } from '../../../services/scheduled-task.service';
import { ScheduledTask } from '../../../models/scheduled-task.model';

describe('ScheduledTasksListView', () => {
  let component: ScheduledTasksListView;
  let fixture: ComponentFixture<ScheduledTasksListView>;
  let scheduledTaskService: ScheduledTaskService;
  let location: Location;

  const mockItems: ScheduledTask[] = [
    {
      id: 1, ownerUserID: 1, name: 'Daily Backup', description: 'Run backup', taskListID: 1, projectID: 1,
      taskTypeEnum: 'scheduled', cronExpression: '0 2 * * *', timezone: 'UTC',
      nextRunAt: new Date('2026-02-15'), activeFlag: true,
      notifyOnCreate: true, createdAt: new Date(), updatedAt: new Date(),
      taskList: { id: 1, name: 'Maintenance' },
      project: { id: 1, name: 'Infra', shortName: 'INF', tagColorHex: 'ff0000' },
    },
    {
      id: 2, ownerUserID: 1, name: 'Weekly Report', description: null as any, taskListID: 2,
      taskTypeEnum: 'scheduled', cronExpression: '0 9 * * 1', timezone: 'America/Los_Angeles',
      nextRunAt: new Date('2026-02-17'), activeFlag: true,
      notifyOnCreate: false, createdAt: new Date(), updatedAt: new Date(),
      taskList: { id: 2, name: 'Reports' },
    },
    {
      id: 3, ownerUserID: 1, name: 'Old Task', description: 'Inactive', taskListID: 1,
      taskTypeEnum: 'scheduled', cronExpression: '* * * * *', timezone: 'UTC',
      nextRunAt: new Date('2026-01-01'), activeFlag: false,
      notifyOnCreate: true, createdAt: new Date(), updatedAt: new Date(),
      taskList: { id: 1, name: 'Maintenance' },
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScheduledTasksListView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    scheduledTaskService = TestBed.inject(ScheduledTaskService);
    location = TestBed.inject(Location);
    vi.spyOn(scheduledTaskService, 'clearCache');
    vi.spyOn(scheduledTaskService, 'getAll').mockReturnValue(of(mockItems));

    fixture = TestBed.createComponent(ScheduledTasksListView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load data on init', () => {
    expect(scheduledTaskService.clearCache).toHaveBeenCalled();
    expect(scheduledTaskService.getAll).toHaveBeenCalledWith(false);
    expect(component.allItems().length).toBe(3);
  });

  it('should filter inactive items by default', () => {
    const displayed = component.displayedItems();
    expect(displayed.every(i => i.activeFlag === true)).toBe(true);
    expect(displayed.length).toBe(2);
  });

  describe('goBack', () => {
    it('should call location.back', () => {
      vi.spyOn(location, 'back');
      component.goBack();
      expect(location.back).toHaveBeenCalled();
    });
  });

  describe('applyFiltersAndSort', () => {
    it('should include inactive when showInactive is true', () => {
      component.showInactive.set(true);
      component.allItems.set(mockItems);
      component.applyFiltersAndSort();
      expect(component.displayedItems().length).toBe(3);
    });

    it('should filter by name', () => {
      component.onSearchChange('daily');
      expect(component.displayedItems().length).toBe(1);
      expect(component.displayedItems()[0].name).toBe('Daily Backup');
    });

    it('should filter by cron expression', () => {
      component.onSearchChange('0 9');
      expect(component.displayedItems().length).toBe(1);
    });

    it('should filter by task list name', () => {
      component.onSearchChange('reports');
      expect(component.displayedItems().length).toBe(1);
    });

    it('should filter by project name', () => {
      component.onSearchChange('infra');
      expect(component.displayedItems().length).toBe(1);
    });

    it('should sort by name ascending by default', () => {
      const displayed = component.displayedItems();
      expect(displayed[0].name).toBe('Daily Backup');
      expect(displayed[1].name).toBe('Weekly Report');
    });

    it('should sort by nextRunAt', () => {
      component.onSortChange({ active: 'nextRunAt', direction: 'asc' });
      const displayed = component.displayedItems();
      expect(displayed[0].name).toBe('Daily Backup');
    });
  });

  describe('onSearchChange', () => {
    it('should reset page index', () => {
      component.pageIndex.set(3);
      component.onSearchChange('test');
      expect(component.pageIndex()).toBe(0);
    });
  });

  describe('onPageChange', () => {
    it('should update pagination', () => {
      component.onPageChange({ pageIndex: 1, pageSize: 25, length: 50 });
      expect(component.pageIndex()).toBe(1);
      expect(component.pageSize()).toBe(25);
    });
  });

  describe('onToggleInactive', () => {
    it('should reset page index and reload data', () => {
      component.pageIndex.set(2);
      component.onToggleInactive(true);
      expect(component.pageIndex()).toBe(0);
      expect(component.showInactive()).toBe(true);
    });
  });

  describe('getTotalCount', () => {
    it('should return count of active filtered items', () => {
      expect(component.getTotalCount()).toBe(2);
    });

    it('should include inactive when showInactive is true', () => {
      component.showInactive.set(true);
      expect(component.getTotalCount()).toBe(3);
    });

    it('should respect search filter', () => {
      component.searchText.set('weekly');
      expect(component.getTotalCount()).toBe(1);
    });
  });

  describe('cronToEnglish', () => {
    it('should translate hourly cron', () => {
      expect(component.cronToEnglish('0 * * * *')).toBe('Every hour');
    });

    it('should translate specific time', () => {
      expect(component.cronToEnglish('0 9 * * *')).toBe('At 9:00');
    });

    it('should translate time with minutes', () => {
      expect(component.cronToEnglish('30 14 * * *')).toBe('At 14:30');
    });

    it('should translate minute-only expression', () => {
      expect(component.cronToEnglish('15 * * * *')).toBe('At minute 15');
    });

    it('should translate every-minute expression', () => {
      expect(component.cronToEnglish('* * * * *')).toBe('Every minute');
    });

    it('should include day of month', () => {
      expect(component.cronToEnglish('0 9 15 * *')).toBe('At 9:00 on day 15');
    });

    it('should include month', () => {
      expect(component.cronToEnglish('0 9 * 6 *')).toBe('At 9:00 of month 6');
    });

    it('should include day of week', () => {
      expect(component.cronToEnglish('0 9 * * 1')).toBe('At 9:00 on Mon');
    });

    it('should handle Sunday (0)', () => {
      expect(component.cronToEnglish('0 9 * * 0')).toBe('At 9:00 on Sun');
    });

    it('should return original for invalid expressions', () => {
      expect(component.cronToEnglish('invalid')).toBe('invalid');
    });

    it('should return empty for blank input', () => {
      expect(component.cronToEnglish('')).toBe('');
      expect(component.cronToEnglish('  ')).toBe('');
    });
  });

  describe('pagination', () => {
    it('should paginate correctly', () => {
      component.pageSize.set(1);
      component.applyFiltersAndSort();
      expect(component.displayedItems().length).toBe(1);
    });
  });
});
