import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const permissionGuard: CanActivateFn = (route) => {
    const authService = inject(AuthService);
    const router = inject(Router);
    const resource = route.data?.['resource'] as string;

    if (!resource || authService.hasAnyPermission(resource)) {
        return true;
    }
    return router.createUrlTree(['/home']);
};
