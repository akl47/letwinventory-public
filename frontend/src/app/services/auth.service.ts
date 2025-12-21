import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { catchError, of, tap } from 'rxjs';

export interface User {
    id: number;
    displayName: string;
    email: string;
}

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private readonly http = inject(HttpClient);
    private readonly document = inject(DOCUMENT);
    private readonly user = signal<User | null>(null);
    private readonly TOKEN_KEY = 'auth_token';

    readonly isAuthenticated = computed(() => this.user() !== null);
    readonly currentUser = computed(() => this.user());

    constructor() {
        // Check for token in cookie first (from OAuth callback), then localStorage
        this.checkForOAuthCallback();
        this.checkAuthStatus();
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

    checkAuthStatus(): void {
        const token = this.getToken();
        if (!token) {
            this.user.set(null);
            return;
        }

        this.http.get<{ valid: boolean; user: User }>('http://localhost:3000/api/auth/user/checkToken', {
            headers: { Authorization: `Bearer ${token}` }
        }).pipe(
            tap(response => {
                if (response.valid) {
                    this.user.set(response.user);
                } else {
                    this.clearToken();
                }
            }),
            catchError(() => {
                this.clearToken();
                return of(null);
            })
        ).subscribe();
    }

    logout(): void {
        this.clearToken();
    }
}
