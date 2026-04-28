import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { MasterEditor } from './master-editor';
import { ManufacturingService } from '../../../services/manufacturing.service';

const mockMaster = {
  id: 1,
  name: 'PCB Assembly',
  description: 'PCB assembly process',
  revision: 'A',
  releaseState: 'draft',
  previousRevisionID: null,
  createdByUserID: 1,
  releasedByUserID: null,
  releasedAt: null,
  outputParts: [{ id: 1, partID: 5, quantity: 1, part: { id: 5, name: 'PCB Assy' } }],
  steps: [
    {
      id: 1, stepNumber: 10, title: 'Place caps', instructions: 'Place C1-C4',
      imageFileID: null, imageFile: null,
      parts: [{ id: 1, partID: 3, quantity: 4, isTool: false, part: { name: 'Cap 100nF' } }],
      tooling: [{ id: 2, partID: 8, quantity: 1, isTool: true, part: { name: 'Tweezers' } }],
      markers: [{ id: 1, label: 'C1', x: 120, y: 80 }],
    },
  ],
};

describe('MasterEditor', () => {
  let component: MasterEditor;
  let fixture: ComponentFixture<MasterEditor>;
  let manufacturingService: ManufacturingService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MasterEditor],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { params: of({ id: '1' }) },
        },
      ],
    }).compileComponents();

    manufacturingService = TestBed.inject(ManufacturingService);
    vi.spyOn(manufacturingService, 'getMaster').mockReturnValue(of(mockMaster as any));
    vi.spyOn(manufacturingService, 'getHistory').mockReturnValue(of([]));

    fixture = TestBed.createComponent(MasterEditor);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load master data on init', () => {
    expect(manufacturingService.getMaster).toHaveBeenCalledWith(1);
    expect(component.master()).toBeTruthy();
    expect(component.master()!.name).toBe('PCB Assembly');
  });

  it('should display output parts', () => {
    expect(component.master()!.outputParts.length).toBe(1);
  });

  it('should display steps', () => {
    expect(component.master()!.steps.length).toBe(1);
    expect(component.master()!.steps[0].title).toBe('Place caps');
  });

  it('should show revision badge', () => {
    expect(component.master()!.revision).toBe('A');
  });

  it('should show draft release state', () => {
    expect(component.master()!.releaseState).toBe('draft');
  });

  it('should identify editable state for draft masters', () => {
    expect(component.isEditable()).toBe(true);
  });

  it('should identify non-editable state for released masters', () => {
    vi.spyOn(manufacturingService, 'getMaster').mockReturnValue(
      of({ ...mockMaster, releaseState: 'released' } as any)
    );
    component.loadMaster();
    expect(component.isEditable()).toBe(false);
  });
});
