import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideAppInitializer, inject, Injectable } from '@angular/core';
import { provideRouter, withHashLocation, TitleStrategy, RouterStateSnapshot, Router, NavigationError, NavigationEnd } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideNativeDateAdapter } from '@angular/material/core';
import { Title } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

import { routes } from './app.routes';
import { AuthService } from './services/auth.service';
import { authInterceptor } from './interceptors/auth.interceptor';

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
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimations(),
    provideNativeDateAdapter(),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
    provideAppInitializer(() => firstValueFrom(inject(AuthService).checkAuthStatus())),
    provideAppInitializer(() => {
      // Stale tabs left open across a deploy reference lazy chunks that no
      // longer exist. Detect the chunk-load error from a router navigation
      // and reload once to pull the current bundle. sessionStorage guards
      // against reload loops when the failure is not deploy-related.
      const router = inject(Router);
      const RELOAD_FLAG = 'chunkReloadAttempted';
      router.events.subscribe((event) => {
        if (event instanceof NavigationError) {
          const message = String((event.error as { message?: string })?.message ?? event.error ?? '');
          if (/dynamically imported module|ChunkLoadError|Loading chunk \d+ failed/i.test(message)) {
            if (!sessionStorage.getItem(RELOAD_FLAG)) {
              sessionStorage.setItem(RELOAD_FLAG, '1');
              window.location.reload();
            }
          }
        } else if (event instanceof NavigationEnd) {
          sessionStorage.removeItem(RELOAD_FLAG);
        }
      });
    })
  ]
};
