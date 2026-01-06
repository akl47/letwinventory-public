import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { AuthService, User } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let mockDocument: Document;

  beforeEach(() => {
    mockDocument = {
      cookie: ''
    } as Document;

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DOCUMENT, useValue: mockDocument }
      ]
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);

    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  describe('initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should start with isAuthenticated as false', () => {
      expect(service.isAuthenticated()).toBeFalsy();
    });

    it('should start with currentUser as null', () => {
      expect(service.currentUser()).toBeNull();
    });
  });

  describe('setToken', () => {
    it('should store token in localStorage', () => {
      service.setToken('test-token');
      expect(localStorage.getItem('auth_token')).toBe('test-token');
    });
  });

  describe('clearToken', () => {
    it('should remove token from localStorage', () => {
      localStorage.setItem('auth_token', 'test-token');
      service.clearToken();
      expect(localStorage.getItem('auth_token')).toBeNull();
    });

    it('should set user to null', () => {
      service.clearToken();
      expect(service.currentUser()).toBeNull();
    });
  });

  describe('checkAuthStatus', () => {
    it('should return false when no token exists', (done) => {
      service.checkAuthStatus().subscribe(result => {
        expect(result).toBeFalsy();
        expect(service.isAuthenticated()).toBeFalsy();
        done();
      });
    });

    it('should return true when token is valid', (done) => {
      localStorage.setItem('auth_token', 'valid-token');

      const mockUser: User = {
        id: 1,
        displayName: 'Test User',
        email: 'test@example.com'
      };

      service.checkAuthStatus().subscribe(result => {
        expect(result).toBeTruthy();
        expect(service.isAuthenticated()).toBeTruthy();
        expect(service.currentUser()).toEqual(mockUser);
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/auth/user/checkToken');
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer valid-token');
      req.flush({ valid: true, user: mockUser });
    });

    it('should return false and clear token when response is invalid', (done) => {
      localStorage.setItem('auth_token', 'invalid-token');

      service.checkAuthStatus().subscribe(result => {
        expect(result).toBeFalsy();
        expect(localStorage.getItem('auth_token')).toBeNull();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/auth/user/checkToken');
      req.flush({ valid: false });
    });

    it('should return false and clear token on HTTP error', (done) => {
      localStorage.setItem('auth_token', 'error-token');

      service.checkAuthStatus().subscribe(result => {
        expect(result).toBeFalsy();
        expect(localStorage.getItem('auth_token')).toBeNull();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/auth/user/checkToken');
      req.error(new ProgressEvent('error'));
    });
  });

  describe('logout', () => {
    it('should clear the token', () => {
      localStorage.setItem('auth_token', 'test-token');
      service.logout();
      expect(localStorage.getItem('auth_token')).toBeNull();
    });
  });
});
