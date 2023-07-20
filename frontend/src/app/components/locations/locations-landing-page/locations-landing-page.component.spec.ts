import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LocationsLandingPageComponent } from './locations-landing-page.component';

describe('LocationsLandingPageComponent', () => {
  let component: LocationsLandingPageComponent;
  let fixture: ComponentFixture<LocationsLandingPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ LocationsLandingPageComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LocationsLandingPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
