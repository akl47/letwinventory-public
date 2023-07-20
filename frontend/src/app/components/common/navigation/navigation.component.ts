import { Component } from '@angular/core';
import { AuthService } from 'src/app/services/common/auth.service';
import { MatDialog } from '@angular/material/dialog'
import { MoveBarcodeDialogComponent } from '../move-barcode-dialog/move-barcode-dialog.component';
import { LogInDialogComponent } from '../../common/log-in-dialog/log-in-dialog.component'

@Component({
  selector: 'app-navigation',
  templateUrl: './navigation.component.html',
  styleUrls: ['./navigation.component.scss']
})
export class NavigationComponent {

  constructor(
    public auth: AuthService,
    public dialog: MatDialog
  ) {

  }
  goToGoogleAuthURL() {
    const dialogRef = this.dialog.open(LogInDialogComponent, {
      width: '15.625em',
      data: {}
    });
  }

  moveBarcode(): void {
    const dialogRef = this.dialog.open(MoveBarcodeDialogComponent, {
      autoFocus: false,
      data: {}
    });
  }
}
