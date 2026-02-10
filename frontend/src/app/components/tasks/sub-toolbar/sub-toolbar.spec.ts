import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { SubToolbarComponent } from './sub-toolbar';

describe('SubToolbar', () => {
  let component: SubToolbarComponent;
  let fixture: ComponentFixture<SubToolbarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubToolbarComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    })
      .compileComponents();

    fixture = TestBed.createComponent(SubToolbarComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
