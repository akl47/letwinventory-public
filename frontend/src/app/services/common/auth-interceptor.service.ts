import {
  Injectable
} from '@angular/core';
import { HttpInterceptor, HttpHandler, HttpEvent, HttpRequest } from '@angular/common/http';
import {
  AuthService
} from './auth.service';
import {
  Observable
} from 'rxjs';

@Injectable()
export class AuthInterceptorService implements HttpInterceptor {
  constructor(private auth: AuthService) { }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (this.auth.isAuthenticated) {
      // console.log("Authenticated:", this.auth.getToken)
      const authReq = req.clone({
        headers: req.headers.set('Authorization', this.auth.getToken || '')
      });
      return next.handle(authReq);
    } else {
      return next.handle(req);
    }
  }

}
