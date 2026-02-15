import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { DOCUMENT } from '@angular/common';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { TaskViewPreferencesService } from './task-view-preferences.service';

const API_URL = 'https://dev.letwin.co/api';

describe('AuthService', () => {
    let service: AuthService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        localStorage.clear();

        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: Router, useValue: { navigate: vi.fn() } },
                { provide: DOCUMENT, useValue: { cookie: '' } },
                { provide: TaskViewPreferencesService, useValue: { getDefaultViewQueryParams: vi.fn().mockReturnValue(null) } },
            ]
        });
        service = TestBed.inject(AuthService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
        localStorage.clear();
    });

    it('isAuthenticated should be false initially', () => {
        expect(service.isAuthenticated()).toBe(false);
    });

    it('currentUser should be null initially', () => {
        expect(service.currentUser()).toBeNull();
    });

    describe('checkAuthStatus', () => {
        it('should return false when no token in localStorage', () => {
            let result: boolean | undefined;
            service.checkAuthStatus().subscribe(v => result = v);
            expect(result).toBe(false);
        });

        it('should GET checkToken and return true when token is valid', () => {
            localStorage.setItem('auth_token', 'test-token');

            let result: boolean | undefined;
            service.checkAuthStatus().subscribe(v => result = v);

            const req = httpMock.expectOne(`${API_URL}/auth/user/checkToken`);
            expect(req.request.method).toBe('GET');
            expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');

            req.flush({ valid: true, user: { id: 1, displayName: 'Test', email: 'test@test.com' } });

            expect(result).toBe(true);
            expect(service.isAuthenticated()).toBe(true);
            expect(service.currentUser()?.displayName).toBe('Test');
        });

        it('should return false and clear token when response is not valid', () => {
            localStorage.setItem('auth_token', 'bad-token');

            let result: boolean | undefined;
            service.checkAuthStatus().subscribe(v => result = v);

            const req = httpMock.expectOne(`${API_URL}/auth/user/checkToken`);
            req.flush({ valid: false, user: null });

            expect(result).toBe(false);
            expect(localStorage.getItem('auth_token')).toBeNull();
            expect(service.isAuthenticated()).toBe(false);
        });

        it('should return false and clear token on HTTP error', () => {
            localStorage.setItem('auth_token', 'expired-token');

            let result: boolean | undefined;
            service.checkAuthStatus().subscribe(v => result = v);

            const req = httpMock.expectOne(`${API_URL}/auth/user/checkToken`);
            req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

            expect(result).toBe(false);
            expect(localStorage.getItem('auth_token')).toBeNull();
        });
    });

    describe('refreshAccessToken', () => {
        it('should POST to refresh endpoint and store new token', () => {
            let result: string | null | undefined;
            service.refreshAccessToken().subscribe(v => result = v);

            const req = httpMock.expectOne(`${API_URL}/auth/user/refresh`);
            expect(req.request.method).toBe('POST');
            expect(req.request.withCredentials).toBe(true);

            req.flush({ accessToken: 'new-token', user: { id: 1, displayName: 'Test', email: 'test@test.com' } });

            expect(result).toBe('new-token');
            expect(localStorage.getItem('auth_token')).toBe('new-token');
            expect(service.isAuthenticated()).toBe(true);
        });

        it('should return existing subject when already refreshing', () => {
            // Start first refresh
            service.refreshAccessToken().subscribe();

            // Second call should not make a new HTTP request
            let secondResult: string | null | undefined;
            service.refreshAccessToken().subscribe(v => secondResult = v);

            // Only one request should exist
            const req = httpMock.expectOne(`${API_URL}/auth/user/refresh`);
            req.flush({ accessToken: 'new-token', user: { id: 1, displayName: 'Test', email: 'test@test.com' } });

            expect(secondResult).toBe('new-token');
        });

        it('should clear token on refresh failure', () => {
            localStorage.setItem('auth_token', 'old-token');

            let result: string | null | undefined;
            service.refreshAccessToken().subscribe(v => result = v);

            const req = httpMock.expectOne(`${API_URL}/auth/user/refresh`);
            req.flush('Error', { status: 401, statusText: 'Unauthorized' });

            expect(result).toBeNull();
            expect(localStorage.getItem('auth_token')).toBeNull();
        });
    });

    describe('clearToken', () => {
        it('should remove token from localStorage and set user to null', () => {
            localStorage.setItem('auth_token', 'some-token');

            service.clearToken();

            expect(localStorage.getItem('auth_token')).toBeNull();
            expect(service.isAuthenticated()).toBe(false);
            expect(service.currentUser()).toBeNull();
        });
    });

    describe('logout', () => {
        it('should POST to logout endpoint and clear token', () => {
            localStorage.setItem('auth_token', 'some-token');

            service.logout();

            const req = httpMock.expectOne(`${API_URL}/auth/google/logout`);
            expect(req.request.method).toBe('POST');
            req.flush({});

            expect(localStorage.getItem('auth_token')).toBeNull();
            expect(service.isAuthenticated()).toBe(false);
        });
    });
});
