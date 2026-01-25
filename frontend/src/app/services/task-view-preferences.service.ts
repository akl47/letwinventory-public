import { Injectable } from '@angular/core';

export interface TaskViewPreferences {
  projects: string;
  noProject: string;
  subtasks: string;
}

const COOKIE_NAME = 'taskViewDefaults';
const COOKIE_EXPIRY_DAYS = 365;

@Injectable({
  providedIn: 'root'
})
export class TaskViewPreferencesService {

  getDefaultView(): TaskViewPreferences | null {
    const cookieValue = this.getCookie(COOKIE_NAME);
    if (!cookieValue) {
      return null;
    }
    try {
      return JSON.parse(decodeURIComponent(cookieValue));
    } catch {
      return null;
    }
  }

  saveDefaultView(preferences: TaskViewPreferences): void {
    const value = encodeURIComponent(JSON.stringify(preferences));
    const expires = new Date();
    expires.setDate(expires.getDate() + COOKIE_EXPIRY_DAYS);
    document.cookie = `${COOKIE_NAME}=${value};expires=${expires.toUTCString()};path=/`;
  }

  hasDefaultView(): boolean {
    return this.getDefaultView() !== null;
  }

  getDefaultViewQueryParams(): { [key: string]: string } | null {
    const defaults = this.getDefaultView();
    if (!defaults) {
      return null;
    }
    return {
      projects: defaults.projects,
      noProject: defaults.noProject,
      subtasks: defaults.subtasks
    };
  }

  isCurrentViewDefault(currentProjects: string, currentNoProject: string, currentSubtasks: string): boolean {
    const defaults = this.getDefaultView();
    if (!defaults) {
      return false;
    }
    return defaults.projects === currentProjects &&
           defaults.noProject === currentNoProject &&
           defaults.subtasks === currentSubtasks;
  }

  private getCookie(name: string): string | null {
    const nameEQ = name + '=';
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      cookie = cookie.trim();
      if (cookie.indexOf(nameEQ) === 0) {
        return cookie.substring(nameEQ.length);
      }
    }
    return null;
  }
}
