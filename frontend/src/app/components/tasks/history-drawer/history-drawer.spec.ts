import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { HistoryDrawerComponent } from './history-drawer';
import { HistoryService } from '../../../services/history.service';
import { ProjectService } from '../../../services/project.service';
import { TaskService } from '../../../services/task.service';

describe('HistoryDrawerComponent', () => {
  let component: HistoryDrawerComponent;
  let fixture: ComponentFixture<HistoryDrawerComponent>;
  let historyService: HistoryService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HistoryDrawerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    historyService = TestBed.inject(HistoryService);
    const projectService = TestBed.inject(ProjectService);
    const taskService = TestBed.inject(TaskService);

    vi.spyOn(projectService, 'getProjects').mockReturnValue(of([]));
    vi.spyOn(taskService, 'getTaskLists').mockReturnValue(of([]));
    vi.spyOn(historyService, 'getAllHistory').mockReturnValue(of([]));

    fixture = TestBed.createComponent(HistoryDrawerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('isCreatedAction', () => {
    it('should return true for CREATED action', () => {
      expect(component.isCreatedAction({ actionType: { code: 'CREATED' } } as any)).toBe(true);
    });

    it('should return false for other actions', () => {
      expect(component.isCreatedAction({ actionType: { code: 'MOVE_LIST' } } as any)).toBe(false);
    });
  });

  describe('getActionLabel', () => {
    it('should return correct label for each action type', () => {
      expect(component.getActionLabel({ actionType: { code: 'MOVE_LIST' } } as any)).toBe('moved a card');
      expect(component.getActionLabel({ actionType: { code: 'ADD_TO_PROJECT' } } as any)).toBe('added card to project');
      expect(component.getActionLabel({ actionType: { code: 'ADD_PRIORITY' } } as any)).toBe('set priority');
      expect(component.getActionLabel({ actionType: { code: 'CHANGE_STATUS' } } as any)).toBe('changed status');
      expect(component.getActionLabel({ actionType: { code: 'CREATED' } } as any)).toBe('created a card');
      expect(component.getActionLabel({ actionType: { code: 'UNKNOWN' } } as any)).toBe('updated card');
    });
  });

  describe('getLabel', () => {
    it('should return list name for MOVE_LIST', () => {
      component.taskLists = [{ id: 1, name: 'To Do' } as any];
      expect(component.getLabel({ actionType: { code: 'MOVE_LIST' }, fromID: 1 } as any, 'from')).toBe('To Do');
    });

    it('should return fallback for unknown list', () => {
      component.taskLists = [];
      expect(component.getLabel({ actionType: { code: 'MOVE_LIST' }, toID: 99 } as any, 'to')).toBe('List 99');
    });

    it('should return project name for ADD_TO_PROJECT', () => {
      component.projects = [{ id: 5, name: 'My Project' } as any];
      expect(component.getLabel({ actionType: { code: 'ADD_TO_PROJECT' }, toID: 5 } as any, 'to')).toBe('My Project');
    });

    it('should return None for ADD_TO_PROJECT with id 0', () => {
      expect(component.getLabel({ actionType: { code: 'ADD_TO_PROJECT' }, toID: 0 } as any, 'to')).toBe('None');
    });

    it('should return priority names for ADD_PRIORITY', () => {
      expect(component.getLabel({ actionType: { code: 'ADD_PRIORITY' }, toID: 0 } as any, 'to')).toBe('Normal');
      expect(component.getLabel({ actionType: { code: 'ADD_PRIORITY' }, toID: 1 } as any, 'to')).toBe('Tracking');
      expect(component.getLabel({ actionType: { code: 'ADD_PRIORITY' }, toID: 2 } as any, 'to')).toBe('Critical Path');
    });

    it('should return status for CHANGE_STATUS', () => {
      expect(component.getLabel({ actionType: { code: 'CHANGE_STATUS' }, toID: 1 } as any, 'to')).toBe('Completed');
      expect(component.getLabel({ actionType: { code: 'CHANGE_STATUS' }, toID: 0 } as any, 'to')).toBe('Pending');
    });
  });

  describe('loadMoreHistory', () => {
    it('should not load when already loading', () => {
      component.isLoading = true;
      vi.mocked(historyService.getAllHistory).mockClear();
      component.loadMoreHistory();
      expect(historyService.getAllHistory).not.toHaveBeenCalled();
    });

    it('should not load when no more items', () => {
      component.hasMore = false;
      vi.mocked(historyService.getAllHistory).mockClear();
      component.loadMoreHistory();
      expect(historyService.getAllHistory).not.toHaveBeenCalled();
    });

    it('should set hasMore to false when fewer items returned', () => {
      vi.mocked(historyService.getAllHistory).mockReturnValue(of([{ id: 1 }] as any));
      component.hasMore = true;
      component.isLoading = false;
      component.loadMoreHistory();
      expect(component.hasMore).toBe(false);
    });
  });
});
