import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient, HttpErrorResponse } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { of, throwError } from 'rxjs';

describe('authInterceptor', () => {
    let httpClient: HttpClient;
    let httpMock: HttpTestingController;
    let authService: AuthService;
    let router: Router;

    beforeEach(() => {
        localStorage.clear();

        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptors([authInterceptor])),
                provideHttpClientTesting(),
                provideRouter([]),
            ],
        });

        httpClient = TestBed.inject(HttpClient);
        httpMock = TestBed.inject(HttpTestingController);
        authService = TestBed.inject(AuthService);
        router = TestBed.inject(Router);
    });

    afterEach(() => {
        httpMock.verify();
        localStorage.clear();
    });

    it('should add Authorization header when token exists', () => {
        localStorage.setItem('auth_token', 'test-jwt-token');

        httpClient.get('/api/test').subscribe();

        const req = httpMock.expectOne('/api/test');
        expect(req.request.headers.get('Authorization')).toBe('Bearer test-jwt-token');
        req.flush({});
    });

    it('should not add Authorization header when no token', () => {
        httpClient.get('/api/test').subscribe();

        const req = httpMock.expectOne('/api/test');
        expect(req.request.headers.has('Authorization')).toBe(false);
        req.flush({});
    });

    it('should not add Authorization header for refresh requests', () => {
        localStorage.setItem('auth_token', 'test-jwt-token');

        httpClient.post('/api/auth/user/refresh', {}).subscribe();

        const req = httpMock.expectOne('/api/auth/user/refresh');
        expect(req.request.headers.has('Authorization')).toBe(false);
        req.flush({});
    });

    it('should pass through successful responses', () => {
        httpClient.get('/api/test').subscribe(result => {
            expect(result).toEqual({ data: 'ok' });
        });

        const req = httpMock.expectOne('/api/test');
        req.flush({ data: 'ok' });
    });

    it('should attempt token refresh on 401 error', () => {
        localStorage.setItem('auth_token', 'expired-token');
        vi.spyOn(authService, 'refreshAccessToken').mockReturnValue(of('new-token'));

        httpClient.get('/api/protected').subscribe();

        const req = httpMock.expectOne('/api/protected');
        req.flush(null, { status: 401, statusText: 'Unauthorized' });

        // After refresh, the original request is retried with new token
        const retryReq = httpMock.expectOne('/api/protected');
        expect(retryReq.request.headers.get('Authorization')).toBe('Bearer new-token');
        retryReq.flush({ data: 'success' });
    });

    it('should redirect to /home when refresh returns null', () => {
        localStorage.setItem('auth_token', 'expired-token');
        vi.spyOn(authService, 'refreshAccessToken').mockReturnValue(of(null));
        vi.spyOn(authService, 'clearToken');
        vi.spyOn(router, 'navigate');

        httpClient.get('/api/protected').subscribe({
            error: (err) => {
                expect(err.message).toBe('Token refresh failed');
            }
        });

        const req = httpMock.expectOne('/api/protected');
        req.flush(null, { status: 401, statusText: 'Unauthorized' });

        expect(authService.clearToken).toHaveBeenCalled();
        expect(router.navigate).toHaveBeenCalledWith(['/home']);
    });

    it('should redirect to /home when refresh throws error', () => {
        localStorage.setItem('auth_token', 'expired-token');
        vi.spyOn(authService, 'refreshAccessToken').mockReturnValue(throwError(() => new Error('Network error')));
        vi.spyOn(authService, 'clearToken');
        vi.spyOn(router, 'navigate');

        httpClient.get('/api/protected').subscribe({
            error: (err) => {
                expect(err.message).toBe('Token refresh failed');
            }
        });

        const req = httpMock.expectOne('/api/protected');
        req.flush(null, { status: 401, statusText: 'Unauthorized' });

        expect(authService.clearToken).toHaveBeenCalled();
        expect(router.navigate).toHaveBeenCalledWith(['/home']);
    });

    it('should queue requests during an active refresh', () => {
        localStorage.setItem('auth_token', 'expired-token');
        // Mark service as already refreshing
        (authService as any).isRefreshing = true;

        vi.spyOn(router, 'navigate');

        httpClient.get('/api/queued').subscribe(result => {
            expect(result).toEqual({ queued: true });
        });

        const req = httpMock.expectOne('/api/queued');
        req.flush(null, { status: 401, statusText: 'Unauthorized' });

        // Simulate refresh completing with new token via the subject
        (authService as any).refreshSubject.next('refreshed-token');

        const retryReq = httpMock.expectOne('/api/queued');
        expect(retryReq.request.headers.get('Authorization')).toBe('Bearer refreshed-token');
        retryReq.flush({ queued: true });

        (authService as any).isRefreshing = false;
    });

    it('should propagate 403 error without clearing token (insufficient permissions)', () => {
        localStorage.setItem('auth_token', 'test-token');
        vi.spyOn(authService, 'clearToken');
        vi.spyOn(router, 'navigate');

        httpClient.get('/api/forbidden').subscribe({
            error: (err: HttpErrorResponse) => {
                expect(err.status).toBe(403);
            }
        });

        const req = httpMock.expectOne('/api/forbidden');
        req.flush(null, { status: 403, statusText: 'Forbidden' });

        expect(authService.clearToken).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('should propagate non-401/403 errors without refresh', () => {
        httpClient.get('/api/server-error').subscribe({
            error: (err: HttpErrorResponse) => {
                expect(err.status).toBe(500);
            }
        });

        const req = httpMock.expectOne('/api/server-error');
        req.flush(null, { status: 500, statusText: 'Internal Server Error' });
    });

    it('should not attempt refresh for 401 on refresh endpoint itself', () => {
        vi.spyOn(authService, 'refreshAccessToken');

        httpClient.post('/api/auth/user/refresh', {}).subscribe({
            error: (err: HttpErrorResponse) => {
                expect(err.status).toBe(401);
            }
        });

        const req = httpMock.expectOne('/api/auth/user/refresh');
        req.flush(null, { status: 401, statusText: 'Unauthorized' });

        expect(authService.refreshAccessToken).not.toHaveBeenCalled();
    });
});
