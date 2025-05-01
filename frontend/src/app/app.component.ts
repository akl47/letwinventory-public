import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  title = 'Letwin.co';
  otherTheme = false;

  swapTheme() {
    this.otherTheme = !this.otherTheme;
  }
}
