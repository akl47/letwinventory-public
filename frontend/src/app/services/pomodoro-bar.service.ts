import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class PomodoroBarService {
  private isCompactSubject = new BehaviorSubject<boolean>(false);
  isCompact$ = this.isCompactSubject.asObservable();

  toggleCompact() {
    this.isCompactSubject.next(!this.isCompactSubject.value);
  }
}
