import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { BASE_URL } from '../../app.config';
import { catchError, map } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '../../models/common/user.model';

interface UserResponse {
  valid: boolean;
  user: User;
}

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private userSubject = new BehaviorSubject<User | null>(null);
  user$ = this.userSubject.asObservable();

  constructor(
    private http: HttpClient,
    private snack: MatSnackBar
  ) { }

  get user(): User | null {
    return this.userSubject.value;
  }

  set user(user: User | null) {
    this.userSubject.next(user);
  }

  fetchUser(): Observable<User> {
    return this.http.get<UserResponse>(BASE_URL + '/api/auth/user/checkToken')
      .pipe(
        map(response => {
          if (!response.valid) {
            throw new Error('Invalid user response');
          }
          return response.user;
        }),
        catchError(error => {
          this.snack.open('Error fetching user info', 'Close', {
            duration: 5000,
          });
          throw error;
        })
      );
  }

  updateUser(userData: User): Observable<User> {
    return this.http.put<User>(BASE_URL + '/api/auth/user', userData)
      .pipe(
        catchError(error => {
          this.snack.open('Error updating user info', 'Close', {
            duration: 5000,
          });
          throw error;
        })
      );
  }
}
