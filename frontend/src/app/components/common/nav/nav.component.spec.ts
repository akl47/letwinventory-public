import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { NavComponent } from './nav.component';
import { AuthService } from '../../../services/auth.service';

describe('NavComponent', () => {
  let component: NavComponent;
  let fixture: ComponentFixture<NavComponent>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let mockDocument: { location: { href: string } };

  beforeEach(async () => {
    mockDocument = {
      location: { href: '' }
    };

    authServiceSpy = jasmine.createSpyObj('AuthService', ['logout'], {
      isAuthenticated: signal(false),
      currentUser: signal(null)
    });

    await TestBed.configureTestingModule({
      imports: [NavComponent, RouterTestingModule, NoopAnimationsModule],
      providers: [
        { provide: AuthService, useValue: authServiceSpy },
        { provide: DOCUMENT, useValue: mockDocument }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(NavComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('sidenav', () => {
    it('should start with sidenav not collapsed', () => {
      expect(component['isSidenavCollapsed']()).toBeFalse();
    });

    it('should toggle sidenav collapsed state', () => {
      expect(component['isSidenavCollapsed']()).toBeFalse();

      component.toggleSidenav();
      expect(component['isSidenavCollapsed']()).toBeTrue();

      component.toggleSidenav();
      expect(component['isSidenavCollapsed']()).toBeFalse();
    });
  });

  describe('authentication', () => {
    it('should show login when not authenticated', () => {
      expect(component['isAuthenticated']()).toBeFalse();
    });

    it('should show user when authenticated', () => {
      const mockUser = { id: 1, displayName: 'Test User', email: 'test@example.com' };

      // Update the spy to return authenticated state
      Object.defineProperty(authServiceSpy, 'isAuthenticated', {
        value: signal(true)
      });
      Object.defineProperty(authServiceSpy, 'currentUser', {
        value: signal(mockUser)
      });

      fixture = TestBed.createComponent(NavComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();

      expect(component['isAuthenticated']()).toBeTrue();
      expect(component['currentUser']()).toEqual(mockUser);
    });

    it('should redirect to Google OAuth on login', () => {
      component.login();
      expect(mockDocument.location.href).toBe('http://localhost:3000/api/auth/google');
    });

    it('should call authService.logout on logout', () => {
      component.logout();
      expect(authServiceSpy.logout).toHaveBeenCalled();
    });
  });
});
