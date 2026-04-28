import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { MasterListView } from './master-list-view';
import { ManufacturingService } from '../../../services/manufacturing.service';

const mockMasters = [
  { id: 1, name: 'PCB Assembly', description: 'PCB process', revision: 'A', releaseState: 'released', stepCount: 3, createdAt: '2026-04-07T10:00:00Z' },
  { id: 2, name: 'Cable Build', description: 'Cable process', revision: 'A', releaseState: 'draft', stepCount: 2, createdAt: '2026-04-07T11:00:00Z' },
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
      ],
    }).compileComponents();

    manufacturingService = TestBed.inject(ManufacturingService);
    vi.spyOn(manufacturingService, 'getMasters').mockReturnValue(of(mockMasters));

    fixture = TestBed.createComponent(MasterListView);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load masters on init', () => {
    expect(manufacturingService.getMasters).toHaveBeenCalled();
    expect(component.masters().length).toBe(2);
    expect(component.isLoading()).toBe(false);
  });

  it('should display all masters when no search', () => {
    expect(component.displayedMasters().length).toBe(2);
  });

  it('should filter masters by name', () => {
    component.onSearchChange('pcb');
    expect(component.displayedMasters().length).toBe(1);
    expect(component.displayedMasters()[0].name).toBe('PCB Assembly');
  });

  it('should show release state badges', () => {
    const released = component.masters().find(m => m.releaseState === 'released');
    expect(released).toBeTruthy();
    const draft = component.masters().find(m => m.releaseState === 'draft');
    expect(draft).toBeTruthy();
  });
});
