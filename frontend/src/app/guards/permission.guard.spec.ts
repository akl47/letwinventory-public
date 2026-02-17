import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { permissionGuard } from './permission.guard';
import { AuthService } from '../services/auth.service';

describe('permissionGuard', () => {
    let authService: AuthService;
    let router: Router;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
        });
        authService = TestBed.inject(AuthService);
        router = TestBed.inject(Router);
    });

    it('should return true when no resource specified', () => {
        const mockRoute = { data: {} };

        const result = TestBed.runInInjectionContext(() =>
            permissionGuard(mockRoute as any, {} as any)
        );

        expect(result).toBe(true);
    });

    it('should return true when user has permission', () => {
        vi.spyOn(authService, 'hasAnyPermission').mockReturnValue(true);
        const mockRoute = { data: { resource: 'admin' } };

        const result = TestBed.runInInjectionContext(() =>
            permissionGuard(mockRoute as any, {} as any)
        );

        expect(result).toBe(true);
        expect(authService.hasAnyPermission).toHaveBeenCalledWith('admin');
    });

    it('should return UrlTree to /home when user lacks permission', () => {
        vi.spyOn(authService, 'hasAnyPermission').mockReturnValue(false);
        const createUrlTreeSpy = vi.spyOn(router, 'createUrlTree');
        const mockRoute = { data: { resource: 'admin' } };

        const result = TestBed.runInInjectionContext(() =>
            permissionGuard(mockRoute as any, {} as any)
        );

        expect(authService.hasAnyPermission).toHaveBeenCalledWith('admin');
        expect(createUrlTreeSpy).toHaveBeenCalledWith(['/home']);
        expect(result).toEqual(router.createUrlTree(['/home']));
    });
});
