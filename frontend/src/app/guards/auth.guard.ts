import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    // If already authenticated, allow access
    if (authService.isAuthenticated()) {
        return true;
    }

    // Otherwise, check auth status (handles page refresh/direct URL entry)
    return authService.checkAuthStatus().pipe(
        map(isAuthenticated => {
            if (isAuthenticated) {
                return true;
            }
            // Redirect to home if not authenticated
            return router.createUrlTree(['/home']);
        })
    );
};
