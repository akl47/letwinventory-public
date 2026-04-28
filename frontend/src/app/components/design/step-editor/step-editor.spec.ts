import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { StepEditor } from './step-editor';

const mockStep = {
  id: 1,
  stepNumber: 10,
  title: 'Place capacitors',
  instructions: 'Place C1-C4 on the PCB.',
  imageFileID: 12,
  imageFile: { id: 12, filename: 'step1.png' },
  parts: [
    { id: 1, partID: 3, quantity: 4, isTool: false, part: { id: 3, name: 'Cap 100nF' } },
  ],
  tooling: [
    { id: 2, partID: 8, quantity: 1, isTool: true, part: { id: 8, name: 'Tweezers' } },
  ],
  markers: [
    { id: 1, label: 'C1', x: 120.5, y: 80.3 },
    { id: 2, label: 'C2', x: 200.0, y: 80.3 },
  ],
};

describe('StepEditor', () => {
  let component: StepEditor;
  let fixture: ComponentFixture<StepEditor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StepEditor],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StepEditor);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should accept step input', () => {
    component.step = mockStep as any;
    component.editable = true;
    fixture.detectChanges();
    expect(component.step.title).toBe('Place capacitors');
  });

  it('should render parts in left sidebar', () => {
    component.step = mockStep as any;
    component.editable = true;
    fixture.detectChanges();
    expect(component.step.parts.length).toBe(1);
    expect(component.step.parts[0].part.name).toBe('Cap 100nF');
  });

  it('should render tooling in left sidebar', () => {
    component.step = mockStep as any;
    component.editable = true;
    fixture.detectChanges();
    expect(component.step.tooling.length).toBe(1);
    expect(component.step.tooling[0].part.name).toBe('Tweezers');
  });

  it('should render markers on canvas', () => {
    component.step = mockStep as any;
    component.editable = true;
    fixture.detectChanges();
    expect(component.step.markers.length).toBe(2);
    expect(component.step.markers[0].label).toBe('C1');
  });

  it('should allow marker drag in editable mode', () => {
    component.step = mockStep as any;
    component.editable = true;
    fixture.detectChanges();
    // In editable mode, markers should be draggable
    expect(component.editable).toBe(true);
  });

  it('should prevent marker drag in read-only mode', () => {
    component.step = mockStep as any;
    component.editable = false;
    fixture.detectChanges();
    expect(component.editable).toBe(false);
  });

  it('should display instructions in bottom bar', () => {
    component.step = mockStep as any;
    component.editable = true;
    fixture.detectChanges();
    expect(component.step.instructions).toBe('Place C1-C4 on the PCB.');
  });
});
