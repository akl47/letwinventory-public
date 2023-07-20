import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PartsLandingPageComponent } from './parts-landing-page.component';

describe('PartsLandingPageComponent', () => {
  let component: PartsLandingPageComponent;
  let fixture: ComponentFixture<PartsLandingPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ PartsLandingPageComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PartsLandingPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
