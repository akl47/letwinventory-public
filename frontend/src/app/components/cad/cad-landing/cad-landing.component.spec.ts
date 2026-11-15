import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { CadLandingComponent } from './cad-landing.component';
import { AuthService } from '../../../services/auth.service';
import { CadModelService } from '../../../services/cad-model.service';
import { AssemblyService } from '../../../services/assembly.service';
import { HarnessService } from '../../../services/harness.service';
import { ProjectService } from '../../../services/project.service';

// REQ 1071 — filters on the CAD models page.
describe('CadLandingComponent filters', () => {
  let component: CadLandingComponent;
  let fixture: ComponentFixture<CadLandingComponent>;

  const cadRow = (over: Record<string, unknown> = {}) => ({
    partID: 1, part: { id: 1, name: 'Bracket', revision: '01', description: null },
    revisionCount: 0, latestRevisionID: 10, latestRevision: '01', latestReleaseState: 'draft', latestUpdatedAt: null,
    hasReleased: false, releasedRevisionID: null, releasedRevision: null, isAssembly: false, commonPart: false, projectIDs: [],
    ...over,
  });
  const harness = { id: 7, name: 'Loom', partNumber: 'LET-0007', revision: '02', description: null, thumbnailBase64: null,
    activeFlag: true, createdBy: null, createdAt: '', updatedAt: '', releaseState: 'released', commonPart: false, projectIDs: [2] };
  const projects = [
    { id: 1, name: 'Alpha', shortName: 'ALP', tagColorHex: 'FF0000', activeFlag: true },
    { id: 2, name: 'Beta', shortName: 'BET', tagColorHex: '00FF00', activeFlag: true },
    { id: 3, name: 'Retired', shortName: 'RET', tagColorHex: '0000FF', activeFlag: false },
  ];

  const section = (key: string) => component.filterSections().find(s => s.key === key) as any;
  const row = (name: string) => component.rows().find(r => r.part?.name === name)!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CadLandingComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideAnimationsAsync(), provideRouter([])],
    }).compileComponents();

    vi.spyOn(TestBed.inject(AuthService), 'hasAnyPermission').mockReturnValue(true);
    vi.spyOn(TestBed.inject(CadModelService), 'listPartsWithCad').mockReturnValue(of([
      cadRow({ projectIDs: [1] }),
      cadRow({ partID: 2, part: { id: 2, name: 'Frame', revision: '01', description: null }, isAssembly: true, latestReleaseState: 'released' }),
      cadRow({ partID: 3, part: { id: 3, name: 'Screw', revision: '01', description: null }, commonPart: true }),
    ] as any));
    vi.spyOn(TestBed.inject(AssemblyService), 'eligibleParts').mockReturnValue(of([]));
    vi.spyOn(TestBed.inject(HarnessService), 'getAllHarnesses').mockReturnValue(of({ harnesses: [harness], pagination: {} } as any));
    vi.spyOn(TestBed.inject(ProjectService), 'getProjects').mockReturnValue(of(projects as any));

    fixture = TestBed.createComponent(CadLandingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('offers type, state and project filters', () => {
    expect(component.filterSections().map(s => s.key)).toEqual(['type', 'state', 'projects']);
    expect(section('projects').options.map((o: { label: string }) => o.label)).toEqual(['Alpha', 'Beta']);
  });

  it('classifies rows as part, assembly or harness', () => {
    const type = section('type').accessor;
    expect(type(row('Bracket'))).toBe('part');
    expect(type(row('Frame'))).toBe('assembly');
    expect(type(row('LET-0007'))).toBe('harness');
  });

  it('classifies rows as draft or released', () => {
    const state = section('state').accessor;
    expect(state(row('Bracket'))).toBe('draft');
    expect(state(row('Frame'))).toBe('released');
    expect(state(row('LET-0007'))).toBe('released');
  });

  it('shows a Projects column in place of the released and revision-count columns', () => {
    expect(component.columns.map(c => c.key)).toEqual(['part', 'type', 'latest', 'projects', 'updated', 'actions']);
    expect(component.rowProjects(row('Bracket')).map(p => p.name)).toEqual(['Alpha']);
    expect(component.rowProjects(row('Frame'))).toEqual([]);
    const cells = Array.from(fixture.nativeElement.querySelectorAll('.project-chip')).map((c: any) => c.textContent.trim());
    expect(cells).toEqual(expect.arrayContaining(['ALP', 'BET', 'Common']));
  });

  it('matches a row to its own projects, and a common part to every project', () => {
    const inProjects = section('projects').accessor;
    expect(inProjects(row('Bracket'))).toEqual([1]);
    expect(inProjects(row('LET-0007'))).toEqual([2]);
    expect(inProjects(row('Frame'))).toEqual([]);
    expect(inProjects(row('Screw'))).toEqual([1, 2]);
  });
});
