import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LocationEditDialogComponent } from './location-edit-dialog.component';

describe('LocationEditDialogComponent', () => {
  let component: LocationEditDialogComponent;
  let fixture: ComponentFixture<LocationEditDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ LocationEditDialogComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LocationEditDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
