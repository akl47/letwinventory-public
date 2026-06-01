import { Injectable, signal } from '@angular/core';

// Cross-component UI state for the CAD module. Mirrors how isMobileRoute
// drives nav-rail visibility in NavComponent: cad-editor sets the flag
// when entering/exiting full-screen mode, nav reads it to collapse its
// sidebar and toolbar so the CAD canvas truly fills the viewport.
@Injectable({ providedIn: 'root' })
export class CadUiStateService {
  readonly fullscreen = signal<boolean>(false);
}
