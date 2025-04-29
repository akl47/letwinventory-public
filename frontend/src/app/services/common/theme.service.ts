import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class ThemeService {
    private isDarkTheme = new BehaviorSubject<boolean>(false);
    isDarkTheme$ = this.isDarkTheme.asObservable();

    constructor() {
        // Check for saved theme preference
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            this.isDarkTheme.next(savedTheme === 'dark');
            this.setTheme(savedTheme === 'dark');
        }
    }

    toggleTheme() {
        const newTheme = !this.isDarkTheme.value;
        this.isDarkTheme.next(newTheme);
        this.setTheme(newTheme);
        localStorage.setItem('theme', newTheme ? 'dark' : 'light');
    }

    private setTheme(isDark: boolean) {
        const themeClass = isDark ? 'dark-theme' : 'light-theme';
        document.body.classList.remove('dark-theme', 'light-theme');
        document.body.classList.add(themeClass);
    }
} 