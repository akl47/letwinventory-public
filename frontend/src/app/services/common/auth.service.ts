import {
  Injectable
} from '@angular/core';
import {
  Router
} from '@angular/router';
import {
  HttpClient
} from '@angular/common/http';
import {
  Observable,
  throwError
} from 'rxjs';
import {
  BASE_URL, NAME_KEY, TOKEN_KEY
} from '../../app.config';
import { catchError } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
@Injectable()

export class AuthService {

  constructor(
    private http: HttpClient,
    private router: Router,
    private snack: MatSnackBar
  ) { }

  get displayName() {
    return localStorage.getItem(NAME_KEY);
  }

  get isAuthenticated() {
    return !!localStorage.getItem(TOKEN_KEY);
  }

  get getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  login(loginData: any) {
    return this.http.post(BASE_URL + '/auth/user/login', loginData).pipe(catchError(this.handleError.bind(this)));
  }

  checkAuth(): Observable<boolean> {
    return this.http.get<boolean>(BASE_URL + '/auth/user/checkToken').pipe(catchError(this.handleError.bind(this)));
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(NAME_KEY);
    this.router.navigate(['/']);
  }

  authenticate(authResponse: any) {
    if (!authResponse.token) {
      return;
    }
    localStorage.setItem(TOKEN_KEY, authResponse.token);
    localStorage.setItem(NAME_KEY, authResponse.displayName);
    this.router.navigate(['/']);
  }

  handleError(error: any) {
    console.log(error.error.errorMessage)
    let message
    if (typeof error.error.errorMessage != 'undefined') {
      message = error.error.errorMessage
    } else {
      message = error.message
    }
    this.snack.open(message, '', {
      duration: 5000
    })
    console.error(error)
    return throwError(error)
  }

}
