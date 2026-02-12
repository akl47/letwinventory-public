import { HttpInterceptorFn, HttpErrorResponse, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError, filter, take } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Skip adding token for refresh endpoint to avoid circular dependency
  const isRefreshRequest = req.url.includes('/auth/user/refresh');

  let clonedRequest = req;
  const token = localStorage.getItem('auth_token');

  if (token && !isRefreshRequest) {
    clonedRequest = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  return next(clonedRequest).pipe(
    catchError((error: HttpErrorResponse) => {
      // Only attempt refresh for 401 errors on non-refresh requests
      if (error.status === 401 && !isRefreshRequest) {
        console.log('[AUTH] 401 received, attempting refresh | URL:', req.url);
        return handleTokenRefresh(authService, router, req, next);
      }

      if (error.status === 403) {
        console.log('[AUTH] 403 received, clearing token | URL:', req.url);
        authService.clearToken();
        router.navigate(['/home']);
      }

      return throwError(() => error);
    })
  );
};

function handleTokenRefresh(
  authService: AuthService,
  router: Router,
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) {
  // If already refreshing, wait for the refresh to complete
  if (authService.isRefreshingToken) {
    console.log('[AUTH] Refresh already in progress, queuing request:', req.url);
    return authService.refreshComplete$.pipe(
      filter(token => token !== null),
      take(1),
      switchMap(token => {
        const clonedRequest = req.clone({
          setHeaders: {
            Authorization: `Bearer ${token}`
          }
        });
        return next(clonedRequest);
      }),
      catchError(() => {
        authService.clearToken();
        router.navigate(['/home']);
        return throwError(() => new Error('Token refresh failed'));
      })
    );
  }

  // Attempt to refresh the token
  return authService.refreshAccessToken().pipe(
    switchMap(newToken => {
      if (newToken) {
        // Retry the original request with the new token
        const clonedRequest = req.clone({
          setHeaders: {
            Authorization: `Bearer ${newToken}`
          }
        });
        return next(clonedRequest);
      }

      // Refresh failed, redirect to login
      authService.clearToken();
      router.navigate(['/home']);
      return throwError(() => new Error('Token refresh failed'));
    }),
    catchError(() => {
      authService.clearToken();
      router.navigate(['/home']);
      return throwError(() => new Error('Token refresh failed'));
    })
  );
}
