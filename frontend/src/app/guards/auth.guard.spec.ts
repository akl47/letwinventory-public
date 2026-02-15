import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, firstValueFrom } from 'rxjs';
import { vi } from 'vitest';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

describe('authGuard', () => {
    let authService: AuthService;
    let router: Router;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
        });
        authService = TestBed.inject(AuthService);
        router = TestBed.inject(Router);
    });

    it('should allow access when already authenticated', () => {
        vi.spyOn(authService, 'isAuthenticated').mockReturnValue(true);

        const result = TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));

        expect(result).toBe(true);
    });

    it('should check auth status when not authenticated', async () => {
        vi.spyOn(authService, 'isAuthenticated').mockReturnValue(false);
        vi.spyOn(authService, 'checkAuthStatus').mockReturnValue(of(true));

        const result = TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));

        if (result instanceof Object && 'subscribe' in result) {
            const val = await firstValueFrom(result as any);
            expect(val).toBe(true);
        }
    });

    it('should redirect to /home when auth check fails', async () => {
        vi.spyOn(authService, 'isAuthenticated').mockReturnValue(false);
        vi.spyOn(authService, 'checkAuthStatus').mockReturnValue(of(false));
        vi.spyOn(router, 'createUrlTree');

        const result = TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));

        if (result instanceof Object && 'subscribe' in result) {
            await firstValueFrom(result as any);
            expect(router.createUrlTree).toHaveBeenCalledWith(['/home']);
        }
    });
});
