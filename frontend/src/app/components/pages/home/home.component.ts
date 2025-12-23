import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatSlideToggle } from '@angular/material/slide-toggle';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  imports: [MatSlideToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent { }
