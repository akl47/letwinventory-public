import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { DOCUMENT } from '@angular/common';
import { Observable, catchError, map, of, Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { TaskViewPreferencesService } from './task-view-preferences.service';

export interface User {
    id: number;
    displayName: string;
    email: string;
}

interface RefreshResponse {
    accessToken: string;
    user: User;
}

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private readonly http = inject(HttpClient);
    private readonly router = inject(Router);
    private readonly document = inject(DOCUMENT);
    private readonly taskViewPreferences = inject(TaskViewPreferencesService);
    private readonly user = signal<User | null>(null);
    private readonly TOKEN_KEY = 'auth_token';

    // Refresh token state
    private isRefreshing = false;
    private refreshSubject = new Subject<string | null>();

    readonly isAuthenticated = computed(() => this.user() !== null);
    readonly currentUser = computed(() => this.user());
    readonly refreshComplete$ = this.refreshSubject.asObservable();

    constructor() {
        // Check for token in cookie first (from OAuth callback), then localStorage
        this.checkForOAuthCallback();
    }

    /**
     * Check if we just returned from OAuth callback.
     * The backend sets auth_token cookie and redirects here.
     */
    private checkForOAuthCallback(): void {
        const cookieToken = this.getCookie(this.TOKEN_KEY);
        if (cookieToken) {
            // Save to localStorage for future use
            localStorage.setItem(this.TOKEN_KEY, cookieToken);
            // Clear the cookie (we'll use localStorage going forward)
            this.deleteCookie(this.TOKEN_KEY);
            // Redirect to tasks page with default view if available
            const defaultParams = this.taskViewPreferences.getDefaultViewQueryParams();
            if (defaultParams) {
                this.router.navigate(['/tasks'], { queryParams: defaultParams });
            } else {
                this.router.navigate(['/tasks']);
            }
        }
    }

    private getCookie(name: string): string | null {
        const matches = this.document.cookie.match(
            new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')
        );
        return matches ? decodeURIComponent(matches[1]) : null;
    }

    private deleteCookie(name: string): void {
        this.document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }

    private getToken(): string | null {
        return localStorage.getItem(this.TOKEN_KEY);
    }

    setToken(token: string): void {
        localStorage.setItem(this.TOKEN_KEY, token);
        this.checkAuthStatus();
    }

    clearToken(): void {
        localStorage.removeItem(this.TOKEN_KEY);
        this.deleteCookie(this.TOKEN_KEY);
        this.user.set(null);
    }

    checkAuthStatus(): Observable<boolean> {
        const token = this.getToken();
        if (!token) {
            this.user.set(null);
            return of(false);
        }

        return this.http.get<{ valid: boolean; user: User }>(`${environment.apiUrl}/auth/user/checkToken`, {
            headers: { Authorization: `Bearer ${token}` }
        }).pipe(
            map(response => {
                if (response.valid) {
                    this.user.set(response.user);
                    return true;
                } else {
                    this.clearToken();
                    return false;
                }
            }),
            catchError((error) => {
                // Only clear tokens on explicit auth failures (401/403)
                // Network errors (status 0) mean backend is unreachable — don't destroy tokens
                if (error?.status === 401 || error?.status === 403) {
                    this.clearToken();
                }
                return of(false);
            })
        );
    }

    logout(): void {
        // Call backend to revoke refresh token
        this.http.post(`${environment.apiUrl}/auth/google/logout`, {}, { withCredentials: true })
            .pipe(catchError(() => of(null)))
            .subscribe(() => {
                this.clearToken();
                this.router.navigate(['/home']);
            });
    }

    /**
     * Refresh the access token using the httpOnly refresh token cookie.
     * Returns an observable that emits the new token or null on failure.
     */
    refreshAccessToken(): Observable<string | null> {
        if (this.isRefreshing) {
            console.log('[AUTH] refreshAccessToken called but already refreshing, returning subject');
            return this.refreshComplete$;
        }

        this.isRefreshing = true;
        console.log('[AUTH] Refreshing access token...');

        return this.http.post<RefreshResponse>(
            `${environment.apiUrl}/auth/user/refresh`,
            {},
            { withCredentials: true }
        ).pipe(
            map(response => {
                this.isRefreshing = false;
                if (response.accessToken) {
                    console.log('[AUTH] Refresh OK, new token received');
                    localStorage.setItem(this.TOKEN_KEY, response.accessToken);
                    this.user.set(response.user);
                    this.refreshSubject.next(response.accessToken);
                    return response.accessToken;
                }
                console.log('[AUTH] Refresh response missing accessToken');
                this.refreshSubject.next(null);
                return null;
            }),
            catchError(error => {
                this.isRefreshing = false;
                console.log('[AUTH] Refresh FAILED:', error.status, error.message || error.statusText);
                this.refreshSubject.next(null);
                this.clearToken();
                return of(null);
            })
        );
    }

    /** Check if a refresh is currently in progress */
    get isRefreshingToken(): boolean {
        return this.isRefreshing;
    }
}
