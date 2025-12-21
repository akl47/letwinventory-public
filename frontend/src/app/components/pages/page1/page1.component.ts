import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatSlideToggle } from '@angular/material/slide-toggle';

@Component({
  selector: 'app-page1',
  templateUrl: './page1.component.html',
  imports: [MatSlideToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Page1Component { }
