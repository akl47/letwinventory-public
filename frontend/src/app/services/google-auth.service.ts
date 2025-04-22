import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class GoogleAuthService {
  private userSubject = new BehaviorSubject<any>(null);
  public user$ = this.userSubject.asObservable();

  constructor(private router: Router) {
    // Check for token in cookie on service initialization
    this.checkAuth();
  }

  private checkAuth() {
    // The token is handled by the backend via HTTP-only cookie
    // We just need to check if we're authenticated
    this.userSubject.next(this.isAuthenticated() ? {} : null);
  }

  logout() {
    // Clear the cookie by setting an expired date
    document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    this.userSubject.next(null);
    this.router.navigate(['/login']);
  }

  isAuthenticated(): boolean {
    // Check if the auth_token cookie exists
    return document.cookie.includes('auth_token=');
  }
} 