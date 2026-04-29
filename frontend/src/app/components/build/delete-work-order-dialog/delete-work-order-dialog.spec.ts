import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { vi } from 'vitest';

import { DeleteWorkOrderDialog, DeleteWorkOrderDialogData } from './delete-work-order-dialog';

describe('DeleteWorkOrderDialog', () => {
  let component: DeleteWorkOrderDialog;
  let fixture: ComponentFixture<DeleteWorkOrderDialog>;
  let dialogRef: MatDialogRef<DeleteWorkOrderDialog>;

  function setup(data: DeleteWorkOrderDialogData) {
    dialogRef = { close: vi.fn() } as any;
    TestBed.configureTestingModule({
      imports: [DeleteWorkOrderDialog],
      providers: [
        provideAnimationsAsync(),
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });
    fixture = TestBed.createComponent(DeleteWorkOrderDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('renders kitted-traces warning when kittedCount > 0', () => {
    setup({ workOrderId: 1, workOrderName: 'WO-1', kittedCount: 3, completedSteps: 0 });

    expect(component.hasKittedWarning()).toBe(true);
    const html = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(html.toLowerCase()).toContain('kitted');
  });

  it('renders completed-steps warning when completedSteps > 0', () => {
    setup({ workOrderId: 1, workOrderName: 'WO-1', kittedCount: 0, completedSteps: 2 });

    expect(component.hasCompletedStepsWarning()).toBe(true);
    const html = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(html.toLowerCase()).toContain('step');
  });

  it('renders no warnings when WO is clean', () => {
    setup({ workOrderId: 1, workOrderName: 'WO-1', kittedCount: 0, completedSteps: 0 });

    expect(component.hasKittedWarning()).toBe(false);
    expect(component.hasCompletedStepsWarning()).toBe(false);
  });

  it('disables submit when reason is empty or whitespace', () => {
    setup({ workOrderId: 1, workOrderName: 'WO-1', kittedCount: 0, completedSteps: 0 });

    component.reason.set('');
    expect(component.canSubmit()).toBe(false);

    component.reason.set('   ');
    expect(component.canSubmit()).toBe(false);

    component.reason.set('Created in error');
    expect(component.canSubmit()).toBe(true);
  });

  it('emits the trimmed reason on confirm', () => {
    setup({ workOrderId: 1, workOrderName: 'WO-1', kittedCount: 0, completedSteps: 0 });
    component.reason.set('  Wrong master  ');

    component.confirm();

    expect(dialogRef.close).toHaveBeenCalledWith({ deletionReason: 'Wrong master' });
  });

  it('closes with no result on cancel', () => {
    setup({ workOrderId: 1, workOrderName: 'WO-1', kittedCount: 0, completedSteps: 0 });

    component.cancel();

    expect(dialogRef.close).toHaveBeenCalledWith();
  });
});
