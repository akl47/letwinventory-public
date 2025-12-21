import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-page3',
  template: `
    <h1>Page 3</h1>
    <p>Welcome to Page 3!</p>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Page3Component { }
