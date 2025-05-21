import { TestBed } from '@angular/core/testing';

import { PomodoroBarService } from './pomodoro-bar.service';

describe('PomodoroBarService', () => {
  let service: PomodoroBarService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PomodoroBarService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
