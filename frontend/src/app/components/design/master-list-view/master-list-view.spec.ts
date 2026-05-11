import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { MasterListView } from './master-list-view';
import { ManufacturingService } from '../../../services/manufacturing.service';
import { EngineeringMaster } from '../../../models/engineering-master.model';

const baseFields = {
  previousRevisionID: null,
  createdByUserID: 1,
  releasedByUserID: null,
  releasedAt: null,
  activeFlag: true,
  outputParts: [],
  bomItems: [],
  steps: [],
  updatedAt: '2026-04-07T11:00:00Z',
};

const mockMasters: EngineeringMaster[] = [
  { id: 1, name: 'PCB Assembly', description: 'PCB process', revision: '01', releaseState: 'released', stepCount: 3, createdAt: '2026-04-07T10:00:00Z', ...baseFields },
  { id: 2, name: 'Cable Build', description: 'Cable process', revision: '01', releaseState: 'draft', stepCount: 2, createdAt: '2026-04-07T11:00:00Z', ...baseFields },
];

describe('MasterListView', () => {
  let component: MasterListView;
  let fixture: ComponentFixture<MasterListView>;
  let manufacturingService: ManufacturingService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MasterListView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
      ],
    }).compileComponents();

    manufacturingService = TestBed.inject(ManufacturingService);
    vi.spyOn(manufacturingService, 'getMasters').mockReturnValue(of(mockMasters));

    fixture = TestBed.createComponent(MasterListView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads masters on init', () => {
    expect(manufacturingService.getMasters).toHaveBeenCalled();
    expect(component.masters().length).toBe(2);
    expect(component.isLoading()).toBe(false);
  });

  it('renders via <app-data-table>', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-data-table')).toBeTruthy();
  });

  it('rowHref returns the edit route', () => {
    expect(component.rowHref(mockMasters[0])).toBe('/design/masters/1/edit');
  });

  it('getStateColor returns expected colors', () => {
    expect(component.getStateColor('draft')).toBe('#9e9e9e');
    expect(component.getStateColor('review')).toBe('#ff9800');
    expect(component.getStateColor('released')).toBe('#4caf50');
    expect(component.getStateColor('unknown')).toBe('#9e9e9e');
  });
});
