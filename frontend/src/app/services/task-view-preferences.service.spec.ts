import { TaskViewPreferencesService, TaskViewPreferences } from './task-view-preferences.service';

describe('TaskViewPreferencesService', () => {
  let service: TaskViewPreferencesService;

  beforeEach(() => {
    // Clear cookies
    document.cookie = 'taskViewDefaults=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    service = new TaskViewPreferencesService();
  });

  afterEach(() => {
    document.cookie = 'taskViewDefaults=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('getDefaultView returns null when no cookie exists', () => {
    expect(service.getDefaultView()).toBeNull();
  });

  it('hasDefaultView returns false when no cookie exists', () => {
    expect(service.hasDefaultView()).toBe(false);
  });

  it('saveDefaultView stores preferences in cookie', () => {
    const prefs: TaskViewPreferences = { projects: '1,2', noProject: 'true', subtasks: 'false' };
    service.saveDefaultView(prefs);
    expect(service.hasDefaultView()).toBe(true);
    expect(service.getDefaultView()).toEqual(prefs);
  });

  it('getDefaultViewQueryParams returns params from saved cookie', () => {
    const prefs: TaskViewPreferences = { projects: '3', noProject: 'false', subtasks: 'true' };
    service.saveDefaultView(prefs);
    expect(service.getDefaultViewQueryParams()).toEqual({
      projects: '3',
      noProject: 'false',
      subtasks: 'true',
    });
  });

  it('getDefaultViewQueryParams returns null when no cookie', () => {
    expect(service.getDefaultViewQueryParams()).toBeNull();
  });

  it('isCurrentViewDefault returns true when matching', () => {
    const prefs: TaskViewPreferences = { projects: '1', noProject: 'true', subtasks: 'false' };
    service.saveDefaultView(prefs);
    expect(service.isCurrentViewDefault('1', 'true', 'false')).toBe(true);
  });

  it('isCurrentViewDefault returns false when not matching', () => {
    const prefs: TaskViewPreferences = { projects: '1', noProject: 'true', subtasks: 'false' };
    service.saveDefaultView(prefs);
    expect(service.isCurrentViewDefault('2', 'true', 'false')).toBe(false);
  });

  it('isCurrentViewDefault returns false when no cookie', () => {
    expect(service.isCurrentViewDefault('1', 'true', 'false')).toBe(false);
  });

  it('getDefaultView returns null for malformed cookie', () => {
    document.cookie = 'taskViewDefaults=not-valid-json; path=/';
    expect(service.getDefaultView()).toBeNull();
  });
});
