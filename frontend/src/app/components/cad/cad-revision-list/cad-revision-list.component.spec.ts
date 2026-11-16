import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { CadRevisionListComponent } from './cad-revision-list.component';
import { CadMiniPreviewComponent } from '../cad-mini-preview/cad-mini-preview.component';
import { CadPreview3dComponent } from '../cad-preview-3d/cad-preview-3d.component';
import { AuthService } from '../../../services/auth.service';
import { CadModelService } from '../../../services/cad-model.service';

// REQ 1075 — the version-history page serves assemblies as well as parts.
describe('CadRevisionListComponent editor links', () => {
  let fixture: ComponentFixture<CadRevisionListComponent>;
  let navigate: ReturnType<typeof vi.fn>;

  const node = { hash: 'h1', shortHash: 'h1', parents: [], message: 'initial', timestamp: '2026-01-01T00:00:00Z',
    branch: 'draft/01', lane: 'main', tags: [], isHead: true, author: null, state: 'draft' };

  async function open(isAssembly: boolean) {
    TestBed.overrideComponent(CadRevisionListComponent, {
      remove: { imports: [CadMiniPreviewComponent, CadPreview3dComponent] },
      add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    await TestBed.configureTestingModule({
      imports: [CadRevisionListComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideAnimationsAsync(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { parent: null, paramMap: of({ get: () => '5' }) } },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(AuthService), 'hasPermission').mockReturnValue(true);
    const api = TestBed.inject(CadModelService);
    vi.spyOn(api, 'getActiveByPart').mockReturnValue(of({ id: 9, partID: 5, branchName: 'draft/01', isAssembly } as any));
    vi.spyOn(api, 'getGraph').mockReturnValue(of({ head: 'h1', branches: [{ name: 'draft/01', head: 'h1' }], nodes: [node] } as any));
    vi.spyOn(api, 'switchBranch').mockReturnValue(of({} as any));
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as any;
    fixture = TestBed.createComponent(CadRevisionListComponent);
    fixture.detectChanges();
  }

  const openVersionButtons = () =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].filter(b => b.textContent?.includes('Open version'));

  it('opens a part in the part editor on its revision and branch', async () => {
    await open(false);
    fixture.componentInstance.openEditor();
    expect(navigate).toHaveBeenCalledWith(['/parts', 5, 'cad', 'editor'], { queryParams: { revisionID: 9, branch: 'draft/01' } });
    expect(openVersionButtons().length).toBe(1);
  });

  it('opens an assembly in the assembly editor', async () => {
    await open(true);
    fixture.componentInstance.openEditor();
    expect(navigate).toHaveBeenCalledWith(['/parts', 5, 'assembly', 'editor']);
  });

  it('switching branch on an assembly also lands in the assembly editor', async () => {
    await open(true);
    fixture.componentInstance.switchToBranch('draft/02');
    expect(navigate).toHaveBeenCalledWith(['/parts', 5, 'assembly', 'editor']);
  });

  it('does not offer Open version for an assembly', async () => {
    await open(true);
    expect(openVersionButtons().length).toBe(0);
  });
});
