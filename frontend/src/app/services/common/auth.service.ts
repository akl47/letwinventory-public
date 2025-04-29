import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { BASE_URL, NAME_KEY, TOKEN_KEY } from '../../app.config';
import { catchError } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CookieService } from './cookie.service';

@Injectable()
export class AuthService {
  private displayNameSubject = new BehaviorSubject<string | null>(
    this.cookieService.getCookie(NAME_KEY) ?
      decodeURIComponent(this.cookieService.getCookie(NAME_KEY)!) :
      null
  );
  displayName$ = this.displayNameSubject.asObservable();

  private isAuthenticatedSubject = new BehaviorSubject<boolean>(!!this.cookieService.getCookie(TOKEN_KEY));
  isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  constructor(
    private http: HttpClient,
    private router: Router,
    private snack: MatSnackBar,
    private cookieService: CookieService
  ) { }

  get displayName() {
    return this.displayNameSubject.value;
  }

  get isAuthenticated() {
    return this.isAuthenticatedSubject.value;
  }

  get getToken() {
    return this.cookieService.getCookie(TOKEN_KEY);
  }

  googleLogin(loginData: any) {
    return this.http
      // .get(BASE_URL + '/auth/google', loginData)
      .get(BASE_URL + '/')
      .pipe(catchError(this.handleError.bind(this)));
  }

  checkAuth(): Observable<boolean> {
    return this.http
      .get<boolean>(BASE_URL + '/auth/user/checkToken')
      .pipe(catchError(this.handleError.bind(this)));
  }

  logout() {
    this.cookieService.deleteCookie(TOKEN_KEY);
    this.cookieService.deleteCookie(NAME_KEY);
    this.displayNameSubject.next(null);
    this.isAuthenticatedSubject.next(false);
    this.router.navigate(['/']);
  }

  authenticate(authResponse: any) {
    if (!authResponse.token) {
      return;
    }
    this.cookieService.setCookie(TOKEN_KEY, authResponse.token);
    this.cookieService.setCookie(NAME_KEY, authResponse.displayName);
    this.displayNameSubject.next(decodeURIComponent(authResponse.displayName));
    this.isAuthenticatedSubject.next(true);
    this.router.navigate(['/']);
  }

  private handleError(error: any) {
    let errorMessage = '';
    if (error.error instanceof ErrorEvent) {
      errorMessage = error.error.message;
    } else {
      errorMessage = `Error Code: ${error.status}\nMessage: ${error.message}`;
    }
    this.snack.open(errorMessage, 'Close', {
      duration: 5000,
    });
    return throwError(() => {
      return errorMessage;
    });
  }
}
