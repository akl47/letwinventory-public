import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GoogleAuthService } from '../../../services/google-auth.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-auth-callback',
  template: `
    <div class="callback-container">
      <mat-spinner></mat-spinner>
      <p>Processing authentication...</p>
    </div>
  `,
  styles: [`
    .callback-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background-color: #f5f5f5;
    }
    mat-spinner {
      margin-bottom: 20px;
    }
  `]
})
export class AuthCallbackComponent implements OnInit {
  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private googleAuth: GoogleAuthService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      const code = params['code'];
      const token = params['token'];
      
      if (token) {
        this.googleAuth.validateToken(token).subscribe(
          () => {
            this.router.navigate(['/']);
          },
          error => {
            this.snackBar.open('Authentication failed', 'Close', {
              duration: 5000,
            });
            console.error('Token validation error:', error);
            this.router.navigate(['/login']);
          }
        );
      } else if (code) {
        this.googleAuth.handleCallback(code).subscribe(
          () => {
            this.router.navigate(['/']);
          },
          error => {
            this.snackBar.open('Authentication failed', 'Close', {
              duration: 5000,
            });
            console.error('Callback error:', error);
            this.router.navigate(['/login']);
          }
        );
      } else {
        this.snackBar.open('Invalid authentication response', 'Close', {
          duration: 5000,
        });
        this.router.navigate(['/login']);
      }
    });
  }
} 