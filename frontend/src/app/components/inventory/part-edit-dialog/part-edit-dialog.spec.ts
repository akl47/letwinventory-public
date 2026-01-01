import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PartEditDialog } from './part-edit-dialog';

describe('PartEditDialog', () => {
  let component: PartEditDialog;
  let fixture: ComponentFixture<PartEditDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PartEditDialog]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PartEditDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
