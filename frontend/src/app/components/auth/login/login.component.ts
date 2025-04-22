import { Component } from '@angular/core';

@Component({
  selector: 'app-login',
  template: `
    <div class="login-container">
      <h1>Welcome to Letwinventory</h1>
      <a href="http://localhost:3000/api/auth/google" class="google-login-button">
        <img src="assets/google-logo.svg" alt="Google logo" class="google-logo">
        <span>Sign in with Google</span>
      </a>
    </div>
  `,
  styles: [`
    .login-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background-color: #f5f5f5;
    }
    .google-login-button {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px 24px;
      background-color: #fff;
      border: 1px solid #ddd;
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 0.3s;
      font-size: 16px;
      margin-top: 20px;
      text-decoration: none;
      color: inherit;
    }
    .google-login-button:hover {
      background-color: #f5f5f5;
    }
    .google-logo {
      width: 20px;
      height: 20px;
      margin-right: 12px;
    }
  `]
})
export class LoginComponent {} 