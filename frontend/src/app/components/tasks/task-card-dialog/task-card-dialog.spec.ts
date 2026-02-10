import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { TaskCardDialog } from './task-card-dialog';

describe('TaskCardDialog', () => {
  let component: TaskCardDialog;
  let fixture: ComponentFixture<TaskCardDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskCardDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideNativeDateAdapter(),
        { provide: MAT_DIALOG_DATA, useValue: { task: { id: 1, name: 'Test', doneFlag: false, taskListID: 1 } } },
        { provide: MatDialogRef, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskCardDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
