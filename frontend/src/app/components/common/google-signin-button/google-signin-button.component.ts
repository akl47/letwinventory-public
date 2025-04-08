import { Component } from '@angular/core';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-google-signin-button',
  template: `
    <button (click)="signInWithGoogle()" class="google-signin-button">
      <img src="assets/google-logo.svg" alt="Google logo" class="google-logo">
      <span>Sign in with Google</span>
    </button>
  `,
  styles: [`
    .google-signin-button {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px 20px;
      background-color: #fff;
      border: 1px solid #ddd;
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 0.3s;
    }
    .google-signin-button:hover {
      background-color: #f5f5f5;
    }
    .google-logo {
      width: 18px;
      height: 18px;
      margin-right: 10px;
    }
  `]
})
export class GoogleSigninButtonComponent {
  signInWithGoogle() {
    window.location.href = `${environment.apiUrl}/auth/google`;
  }
} 