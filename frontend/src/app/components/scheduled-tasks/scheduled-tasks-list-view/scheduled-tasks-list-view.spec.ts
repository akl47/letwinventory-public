import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute } from '@angular/router';
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
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScheduledTasksListView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
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

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads data on init (active only)', () => {
    expect(scheduledTaskService.clearCache).toHaveBeenCalled();
    expect(scheduledTaskService.getAll).toHaveBeenCalledWith(false);
    expect(component.allItems().length).toBe(1);
  });

  it('renders via <app-data-table>', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-data-table')).toBeTruthy();
  });

  it('goBack calls location.back', () => {
    vi.spyOn(location, 'back');
    component.goBack();
    expect(location.back).toHaveBeenCalled();
  });

  describe('cronToEnglish', () => {
    it('translates hourly cron', () => {
      expect(component.cronToEnglish('0 * * * *')).toBe('Every hour');
    });

    it('translates specific time', () => {
      expect(component.cronToEnglish('0 9 * * *')).toBe('At 9:00');
    });

    it('translates time with minutes', () => {
      expect(component.cronToEnglish('30 14 * * *')).toBe('At 14:30');
    });

    it('translates minute-only expression', () => {
      expect(component.cronToEnglish('15 * * * *')).toBe('At minute 15');
    });

    it('translates every-minute expression', () => {
      expect(component.cronToEnglish('* * * * *')).toBe('Every minute');
    });

    it('includes day of month', () => {
      expect(component.cronToEnglish('0 9 15 * *')).toBe('At 9:00 on day 15');
    });

    it('includes month', () => {
      expect(component.cronToEnglish('0 9 * 6 *')).toBe('At 9:00 of month 6');
    });

    it('includes day of week', () => {
      expect(component.cronToEnglish('0 9 * * 1')).toBe('At 9:00 on Mon');
    });

    it('handles Sunday (0)', () => {
      expect(component.cronToEnglish('0 9 * * 0')).toBe('At 9:00 on Sun');
    });

    it('returns original for invalid expressions', () => {
      expect(component.cronToEnglish('invalid')).toBe('invalid');
    });

    it('returns empty for blank input', () => {
      expect(component.cronToEnglish('')).toBe('');
      expect(component.cronToEnglish('  ')).toBe('');
    });
  });
});
