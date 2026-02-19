import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

const manifest = document.createElement('link');
manifest.rel = 'manifest';
manifest.href = environment.production ? 'manifest.webmanifest' : 'manifest.dev.webmanifest';
document.head.appendChild(manifest);

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (favicon) {
    favicon.href = environment.production ? '/assets/logo-192.png' : '/assets/logo-dev-192.png';
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(reg => console.log('[SW] Registered, scope:', reg.scope))
    .catch(err => console.error('[SW] Registration failed:', err));
}
