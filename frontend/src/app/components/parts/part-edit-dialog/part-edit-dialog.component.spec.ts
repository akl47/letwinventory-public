import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PartEditDialogComponent } from './part-edit-dialog.component';

describe('PartEditDialogComponent', () => {
  let component: PartEditDialogComponent;
  let fixture: ComponentFixture<PartEditDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ PartEditDialogComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PartEditDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
