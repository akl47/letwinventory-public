import { Component, signal, inject, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { NavComponent } from './components/common/nav/nav.component';

@Component({
  selector: 'app-root',
  imports: [NavComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private router = inject(Router);
  protected readonly title = signal('Letwinventory');
  private hashChangeHandler = () => this.onHashChange();

  ngOnInit() {
    // Listen for manual hash changes in URL bar
    window.addEventListener('hashchange', this.hashChangeHandler);
  }

  ngOnDestroy() {
    window.removeEventListener('hashchange', this.hashChangeHandler);
  }

  private onHashChange() {
    const hash = window.location.hash;
    if (hash.startsWith('#/')) {
      const path = hash.substring(1); // Remove the '#'
      this.router.navigateByUrl(path);
    }
  }
}
