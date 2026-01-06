import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideAppInitializer, inject, Injectable } from '@angular/core';
import { provideRouter, withHashLocation, TitleStrategy, RouterStateSnapshot } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideNativeDateAdapter } from '@angular/material/core';
import { Title } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

import { routes } from './app.routes';
import { AuthService } from './services/auth.service';

@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  constructor(private readonly title: Title) {
    super();
  }

  override updateTitle(routerState: RouterStateSnapshot): void {
    const title = this.buildTitle(routerState);
    if (title) {
      this.title.setTitle(`${title} | Letwinventory`);
    } else {
      this.title.setTitle('Letwinventory');
    }
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withHashLocation()),
    provideHttpClient(),
    provideAnimations(),
    provideNativeDateAdapter(),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
    provideAppInitializer(() => firstValueFrom(inject(AuthService).checkAuthStatus()))
  ]
};
