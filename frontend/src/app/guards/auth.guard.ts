import {
  Injectable
} from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot
} from '@angular/router';
import {
  Observable
} from 'rxjs';
import {
  AuthService
} from '../services/common/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {

  constructor(
    private authService: AuthService
  ) { }

  NAME_KEY = 'name';
  TOKEN_KEY = 'token';

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
    return new Promise((resolve, reject) => {
      this.authService.checkAuth().subscribe(
        data => {
          if (!data) {
            localStorage.removeItem(this.TOKEN_KEY);
            localStorage.removeItem(this.NAME_KEY);
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
