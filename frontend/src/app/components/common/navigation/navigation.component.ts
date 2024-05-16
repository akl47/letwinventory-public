import { Component } from '@angular/core';
import { AuthService } from 'src/app/services/common/auth.service';
import { MatDialog } from '@angular/material/dialog'
import { MoveBarcodeDialogComponent } from '../move-barcode-dialog/move-barcode-dialog.component';
import { LogInDialogComponent } from '../../common/log-in-dialog/log-in-dialog.component'
import { GoogleLoginProvider, SocialAuthService } from '@abacritt/angularx-social-login';

@Component({
  selector: 'app-navigation',
  templateUrl: './navigation.component.html',
  styleUrls: ['./navigation.component.scss']
})
export class NavigationComponent {
  private accessToken = '';

  constructor(
    public auth: AuthService,
    private authService: SocialAuthService,
    public dialog: MatDialog,
  ) {


  }
  ngOnInit() {
    this.authService.authState.subscribe((user) => {
      this.auth.googleLogin(user).subscribe(
        (data) => {
          const { user } = data;
          console.log(user)
          this.auth.authenticate(user);
        },
        (error) => {
          console.log(error);
        }
      );
    });
  }
  getAccessToken(): void {
    this.authService
      .getAccessToken(GoogleLoginProvider.PROVIDER_ID)
      .then((accessToken) => (this.accessToken = accessToken));
  }

  moveBarcode(): void {
    const dialogRef = this.dialog.open(MoveBarcodeDialogComponent, {
      autoFocus: false,
      data: {}
    });
  }
}
