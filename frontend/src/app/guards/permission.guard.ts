import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const permissionGuard: CanActivateFn = (route) => {
    const authService = inject(AuthService);
    const router = inject(Router);
    // A single resource, or several when any one of them grants access.
    const resource = route.data?.['resource'] as string | string[] | undefined;

    if (!resource || [resource].flat().some(r => authService.hasAnyPermission(r))) {
        return true;
    }
    return router.createUrlTree(['/home']);
};
