import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { AuthService } from 'src/app/services/common/auth.service';
import { ThemeService } from '../../../services/common/theme.service';

@Component({
  selector: 'app-navigation',
  templateUrl: './navigation.component.html',
  styleUrls: ['./navigation.component.scss']
})
export class NavigationComponent implements OnInit {
  isAuthenticated = false;
  user: any = null;

  constructor(
    public auth: AuthService,
    private dialog: MatDialog,
    private router: Router,
    public themeService: ThemeService
  ) {
    this.auth.isAuthenticated$.subscribe(
      isAuth => this.isAuthenticated = isAuth
    );
  }

  ngOnInit() {

  }

  login() {
    window.location.href = 'http://localhost:3000/api/auth/google';
  }

  logout() {
  }
}
