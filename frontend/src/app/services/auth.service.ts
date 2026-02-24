import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { DOCUMENT } from '@angular/common';
import { Observable, catchError, map, of, Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { TaskViewPreferencesService } from './task-view-preferences.service';
import { Permission } from '../models/permission.model';

export interface User {
    id: number;
    displayName: string;
    email: string;
}

export interface Session {
    id: number;
    userAgent: string | null;
    createdAt: string;
    expiresAt: string;
}

export interface ApiKey {
    id: number;
    name: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
    permissions?: { id: number; resource: string; action: string }[];
}

interface RefreshResponse {
    accessToken: string;
    sessionId?: number;
    user: User;
    permissions?: string[];
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
    private readonly _permissions = signal<Set<string>>(new Set());
    private readonly _isImpersonating = signal(false);
    private readonly TOKEN_KEY = 'auth_token';
    private readonly ORIGINAL_TOKEN_KEY = 'original_auth_token';
    private readonly SESSION_ID_KEY = 'session_id';

    // Refresh token state
    private isRefreshing = false;
    private refreshSubject = new Subject<string | null>();

    readonly isAuthenticated = computed(() => this.user() !== null);
    readonly currentUser = computed(() => this.user());
    readonly isImpersonating = computed(() => this._isImpersonating());
    readonly refreshComplete$ = this.refreshSubject.asObservable();

    /** Check if user has a specific permission */
    hasPermission(resource: string, action: string): boolean {
        return this._permissions().has(`${resource}.${action}`);
    }

    /** Check if user has any permission for a resource (for nav visibility) */
    hasAnyPermission(resource: string): boolean {
        for (const p of this._permissions()) {
            if (p.startsWith(`${resource}.`)) return true;
        }
        return false;
    }

    /** Get all permissions as a readonly signal */
    readonly permissions = computed(() => this._permissions());

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
            // Read and store session_id cookie
            const sessionId = this.getCookie(this.SESSION_ID_KEY);
            if (sessionId) {
                localStorage.setItem(this.SESSION_ID_KEY, sessionId);
                this.deleteCookie(this.SESSION_ID_KEY);
            }
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
        localStorage.removeItem(this.ORIGINAL_TOKEN_KEY);
        localStorage.removeItem(this.SESSION_ID_KEY);
        this.deleteCookie(this.TOKEN_KEY);
        this.deleteCookie(this.SESSION_ID_KEY);
        this.user.set(null);
        this._permissions.set(new Set());
        this._isImpersonating.set(false);
    }

    checkAuthStatus(): Observable<boolean> {
        const token = this.getToken();
        if (!token) {
            this.user.set(null);
            return of(false);
        }

        return this.http.get<{ valid: boolean; user: User; permissions?: string[]; impersonatedBy?: number }>(`${environment.apiUrl}/auth/user/checkToken`, {
            headers: { Authorization: `Bearer ${token}` }
        }).pipe(
            map(response => {
                if (response.valid) {
                    this.user.set(response.user);
                    this._permissions.set(new Set(response.permissions || []));
                    this._isImpersonating.set(!!response.impersonatedBy || !!localStorage.getItem(this.ORIGINAL_TOKEN_KEY));
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
                    if (response.sessionId) {
                        localStorage.setItem(this.SESSION_ID_KEY, String(response.sessionId));
                    }
                    this.user.set(response.user);
                    this._permissions.set(new Set(response.permissions || []));
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

    startImpersonation(token: string, user: User, permissions: string[]): void {
        localStorage.setItem(this.ORIGINAL_TOKEN_KEY, localStorage.getItem(this.TOKEN_KEY)!);
        localStorage.setItem(this.TOKEN_KEY, token);
        this.user.set(user);
        this._permissions.set(new Set(permissions));
        this._isImpersonating.set(true);
        this.router.navigate(['/tasks']);
    }

    stopImpersonating(): void {
        const originalToken = localStorage.getItem(this.ORIGINAL_TOKEN_KEY);
        if (originalToken) {
            localStorage.setItem(this.TOKEN_KEY, originalToken);
        }
        localStorage.removeItem(this.ORIGINAL_TOKEN_KEY);
        this._isImpersonating.set(false);
        this.checkAuthStatus().subscribe();
        this.router.navigate(['/admin/users']);
    }

    getMyPermissionSources(): Observable<Record<string, string[]>> {
        return this.http.get<Record<string, string[]>>(`${environment.apiUrl}/auth/user/my-permissions`);
    }

    getApiKeys(): Observable<ApiKey[]> {
        return this.http.get<ApiKey[]>(`${environment.apiUrl}/auth/api-key`);
    }

    createApiKey(data: { name: string; permissionIds?: number[]; expiresAt?: string | null }): Observable<{ id: number; name: string; key: string; createdAt: string }> {
        return this.http.post<{ id: number; name: string; key: string; createdAt: string }>(
            `${environment.apiUrl}/auth/api-key`, data
        );
    }

    revokeApiKey(id: number): Observable<void> {
        return this.http.delete<void>(`${environment.apiUrl}/auth/api-key/${id}`);
    }

    getApiKeyPermissions(id: number): Observable<Permission[]> {
        return this.http.get<Permission[]>(`${environment.apiUrl}/auth/api-key/${id}/permissions`);
    }

    getCurrentSessionId(): number | null {
        const id = localStorage.getItem(this.SESSION_ID_KEY);
        return id ? parseInt(id, 10) : null;
    }

    getSessions(): Observable<Session[]> {
        return this.http.get<Session[]>(`${environment.apiUrl}/auth/user/sessions`);
    }

    revokeSession(id: number): Observable<void> {
        return this.http.delete<void>(`${environment.apiUrl}/auth/user/sessions/${id}`);
    }
}
