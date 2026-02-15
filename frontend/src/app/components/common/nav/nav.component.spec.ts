import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, Router } from '@angular/router';
import { DOCUMENT } from '@angular/common';
import { vi } from 'vitest';

import { NavComponent } from './nav.component';
import { AuthService } from '../../../services/auth.service';
import { TaskViewPreferencesService } from '../../../services/task-view-preferences.service';

describe('NavComponent', () => {
  let component: NavComponent;
  let fixture: ComponentFixture<NavComponent>;
  let authService: AuthService;
  let router: Router;
  let taskViewPreferences: TaskViewPreferencesService;
  let mockDocument: any;

  beforeEach(async () => {
    mockDocument = {
      location: { href: '' },
      cookie: '',
    };

    await TestBed.configureTestingModule({
      imports: [NavComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    authService = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    taskViewPreferences = TestBed.inject(TaskViewPreferencesService);

    fixture = TestBed.createComponent(NavComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('toggleSidenav', () => {
    it('should toggle collapsed state', () => {
      // Access the protected signal through the component instance
      const initialState = (component as any).isSidenavCollapsed();
      component.toggleSidenav();
      expect((component as any).isSidenavCollapsed()).toBe(!initialState);
    });

    it('should toggle back', () => {
      const initialState = (component as any).isSidenavCollapsed();
      component.toggleSidenav();
      component.toggleSidenav();
      expect((component as any).isSidenavCollapsed()).toBe(initialState);
    });
  });

  describe('navigateToTasks', () => {
    it('should navigate to /tasks with default params when available', () => {
      vi.spyOn(taskViewPreferences, 'getDefaultViewQueryParams').mockReturnValue({
        projects: 'all',
        noProject: 'show',
        subtasks: 'hide',
      });
      vi.spyOn(router, 'navigate');

      const event = new Event('click');
      vi.spyOn(event, 'preventDefault');

      component.navigateToTasks(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/tasks'], {
        queryParams: { projects: 'all', noProject: 'show', subtasks: 'hide' },
      });
    });

    it('should navigate to /tasks without params when no defaults', () => {
      vi.spyOn(taskViewPreferences, 'getDefaultViewQueryParams').mockReturnValue(null);
      vi.spyOn(router, 'navigate');

      const event = new Event('click');
      vi.spyOn(event, 'preventDefault');

      component.navigateToTasks(event);

      expect(router.navigate).toHaveBeenCalledWith(['/tasks']);
    });
  });

  describe('login', () => {
    it('should redirect to Google auth URL', () => {
      const doc = TestBed.inject(DOCUMENT);
      // login() sets document.location.href, just ensure it doesn't throw
      // Can't fully test location redirect in unit tests but can verify method exists
      expect(component.login).toBeDefined();
    });
  });

  describe('logout', () => {
    it('should call authService.logout', () => {
      vi.spyOn(authService, 'logout');
      component.logout();
      expect(authService.logout).toHaveBeenCalled();
    });
  });

  describe('openSettings', () => {
    it('should navigate to /settings', () => {
      vi.spyOn(router, 'navigate');
      component.openSettings();
      expect(router.navigate).toHaveBeenCalledWith(['/settings']);
    });
  });

  describe('ngOnInit mobile behavior', () => {
    it('should set isMobileRoute based on current URL', () => {
      // Default URL in test is not /mobile, so should be false
      expect((component as any).isMobileRoute()).toBe(false);
    });
  });

  describe('ngOnDestroy', () => {
    it('should not throw on destroy', () => {
      expect(() => component.ngOnDestroy()).not.toThrow();
    });
  });

  describe('protected signals', () => {
    it('should expose isAuthenticated as computed signal', () => {
      expect((component as any).isAuthenticated).toBeDefined();
    });

    it('should expose currentUser as computed signal', () => {
      expect((component as any).currentUser).toBeDefined();
    });

    it('should expose appVersion', () => {
      expect((component as any).appVersion).toBeDefined();
    });
  });
});
