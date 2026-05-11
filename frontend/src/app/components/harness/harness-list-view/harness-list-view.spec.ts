import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { HarnessListView } from './harness-list-view';
import { HarnessService } from '../../../services/harness.service';
import { WireHarnessSummary } from '../../../models/harness.model';

const mockHarnesses: WireHarnessSummary[] = [
  {
    id: 1, name: 'Harness Alpha', partNumber: 'HRN-001', revision: 'A',
    description: 'First harness', activeFlag: true, releaseState: 'draft',
    updatedAt: '2026-01-15T10:00:00Z', createdAt: '2026-01-01T10:00:00Z',
  } as WireHarnessSummary,
];

describe('HarnessListView', () => {
  let component: HarnessListView;
  let fixture: ComponentFixture<HarnessListView>;
  let harnessService: HarnessService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HarnessListView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} }, queryParams: of({}) } },
      ],
    }).compileComponents();

    harnessService = TestBed.inject(HarnessService);
    vi.spyOn(harnessService, 'getAllHarnesses').mockReturnValue(of({
      harnesses: mockHarnesses,
      pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
    }));

    fixture = TestBed.createComponent(HarnessListView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads harnesses on init', () => {
    expect(harnessService.getAllHarnesses).toHaveBeenCalled();
    expect(component.allHarnesses().length).toBe(1);
    expect(component.isLoading()).toBe(false);
  });

  it('renders via <app-data-table>', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-data-table')).toBeTruthy();
  });

  it('rowHref returns the editor URL', () => {
    expect(component.rowHref(mockHarnesses[0])).toBe('/harness/editor/1');
  });

  it('formatDate formats valid dates', () => {
    const formatted = component.formatDate('2026-01-15T10:00:00Z');
    expect(formatted).toContain('2026');
  });
});
