import { Component, OnInit } from '@angular/core';
import { GoogleAuthService } from '../../../services/google-auth.service';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';

@Component({
  selector: 'app-navigation',
  templateUrl: './navigation.component.html',
  styleUrls: ['./navigation.component.scss']
})
export class NavigationComponent implements OnInit {
  isAuthenticated = false;
  user: any = null;

  constructor(
    private googleAuth: GoogleAuthService,
    private dialog: MatDialog,
    private router: Router
  ) {}

  ngOnInit() {
    this.googleAuth.user$.subscribe(user => {
      this.user = user;
      this.isAuthenticated = !!user;
    });
  }

  login() {
    window.location.href = 'http://localhost:3000/api/auth/google';
  }

  logout() {
    this.googleAuth.logout();
  }
}
