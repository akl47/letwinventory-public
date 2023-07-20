import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ViewTraceDialogComponent } from './view-trace-dialog.component';

describe('ViewTraceDialogComponent', () => {
  let component: ViewTraceDialogComponent;
  let fixture: ComponentFixture<ViewTraceDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ViewTraceDialogComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ViewTraceDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
