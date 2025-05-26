import {
  Injectable
} from '@angular/core';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import {
  Observable
} from 'rxjs';
import {
  AuthService
} from '../services/common/auth.service';
import { CookieService } from '../services/common/cookie.service';
import { BASE_URL, NAME_KEY, TOKEN_KEY } from '../../app/app.config'

@Injectable({
  providedIn: 'root'
})
export class AuthGuard  {

  constructor(
    private authService: AuthService,
    private cookieService: CookieService
  ) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
    return new Promise((resolve, reject) => {
      this.authService.checkAuth().subscribe(
        data => {
          if (!data) {
            this.cookieService.deleteCookie(TOKEN_KEY);
            this.cookieService.deleteCookie(NAME_KEY);
          }
          resolve(data);
        },
        error => {
          resolve(false);
        }
      );
    });
  }
}
