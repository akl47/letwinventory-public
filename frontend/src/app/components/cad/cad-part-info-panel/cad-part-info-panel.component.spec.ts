import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { CadPartInfoPanelComponent } from './cad-part-info-panel.component';
import { InventoryService } from '../../../services/inventory.service';
import { ProjectService } from '../../../services/project.service';
import { AuthService } from '../../../services/auth.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';

// REQ 1073 — Part info sidebar of the CAD editor.
describe('CadPartInfoPanelComponent', () => {
  let component: CadPartInfoPanelComponent;
  let fixture: ComponentFixture<CadPartInfoPanelComponent>;
  let inventory: InventoryService;
  let auth: AuthService;

  const alpha = { id: 1, name: 'Alpha', shortName: 'ALP', tagColorHex: 'FF0000', activeFlag: true };
  const beta = { id: 2, name: 'Beta', shortName: 'BET', tagColorHex: '00FF00', activeFlag: true };
  const part = (over: Record<string, unknown> = {}) => ({
    id: 5, name: '000005', description: 'Bracket', internalPart: true, vendor: 'Letwin', sku: null, link: null,
    minimumOrderQuantity: 1, minimumStockQuantity: null, partCategoryID: 3, activeFlag: true,
    serialNumberRequired: false, lotNumberRequired: false, defaultUnitOfMeasureID: 1, manufacturer: null, manufacturerPN: null,
    revision: '02', revisionLocked: false, commonPart: false, projects: [alpha],
    PartCategory: { id: 3, name: 'Part', tagColorHex: '808080' }, createdAt: '', updatedAt: '',
    ...over,
  }) as any;

  const tid = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  function create(loaded = part(), partID: number | null = 5, canWrite = true) {
    vi.spyOn(auth, 'hasPermission').mockReturnValue(canWrite);
    vi.spyOn(inventory, 'getPartById').mockReturnValue(of(loaded));
    fixture = TestBed.createComponent(CadPartInfoPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('partID', partID);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CadPartInfoPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideAnimationsAsync(), provideRouter([])],
    }).compileComponents();
    inventory = TestBed.inject(InventoryService);
    auth = TestBed.inject(AuthService);
    vi.spyOn(TestBed.inject(ProjectService), 'getProjects').mockReturnValue(of([alpha, beta] as any));
    vi.spyOn(TestBed.inject(ErrorNotificationService), 'showSuccess').mockImplementation(() => {});
  });

  it('shows the part number, revision, description, category, projects and common mark, locked', () => {
    create();
    expect(tid('part-info-number')!.textContent).toContain('000005');
    expect(tid('part-info-description')!.textContent).toContain('Bracket');
    expect(tid('part-info-projects')!.textContent).toContain('Alpha');
    expect(tid('part-info-common')!.textContent).toContain('No');
    expect(fixture.nativeElement.textContent).toContain('02');
    expect(fixture.nativeElement.textContent).toContain('Part');
    expect(component.editing()).toBe(false);
    expect(tid('part-info-save')).toBeNull();
  });

  it('unlocks for editing only with parts write permission', () => {
    create(part(), 5, false);
    expect((tid('part-info-lock') as HTMLButtonElement).disabled).toBe(true);
    component.toggleEdit();
    expect(component.editing()).toBe(false);

    create();
    tid('part-info-lock')!.click();
    fixture.detectChanges();
    expect(component.editing()).toBe(true);
    expect(tid('part-info-save')).toBeTruthy();
    expect(tid('part-info-projects-edit')!.textContent).toContain('Beta');
  });

  it('saves the description and the projects, then locks again', () => {
    create();
    const update = vi.spyOn(inventory, 'updatePart').mockReturnValue(of({}));
    const setProjects = vi.spyOn(inventory, 'setPartProjects').mockReturnValue(of({ id: 5, commonPart: true, projects: [] }));
    const saved = vi.spyOn(component.partSaved, 'emit');
    component.toggleEdit();
    component.description.set('Bracket, left');
    component.toggleProject(2);
    component.common.set(true);
    (inventory.getPartById as any).mockReturnValue(of(part({ description: 'Bracket, left', commonPart: true, projects: [alpha, beta] })));
    component.save();

    expect(update).toHaveBeenCalledWith(5, expect.objectContaining({ name: '000005', description: 'Bracket, left', partCategoryID: 3 }));
    expect(setProjects).toHaveBeenCalledWith(5, { projectIDs: [1, 2], commonPart: true });
    expect(component.editing()).toBe(false);
    expect(component.part()!.description).toBe('Bracket, left');
    expect(saved).toHaveBeenCalled();
  });

  it('sends only what changed', () => {
    create();
    const update = vi.spyOn(inventory, 'updatePart').mockReturnValue(of({}));
    const setProjects = vi.spyOn(inventory, 'setPartProjects').mockReturnValue(of({ id: 5, commonPart: false, projects: [] }));
    component.toggleEdit();
    expect(component.changed()).toBe(false);
    component.toggleProject(1);
    component.save();
    expect(update).not.toHaveBeenCalled();
    expect(setProjects).toHaveBeenCalledWith(5, { projectIDs: [], commonPart: false });
  });

  it('keeps the description fixed on a locked revision but still saves projects', async () => {
    create(part({ revisionLocked: true }));
    const update = vi.spyOn(inventory, 'updatePart');
    const setProjects = vi.spyOn(inventory, 'setPartProjects').mockReturnValue(of({ id: 5, commonPart: true, projects: [] }));
    component.toggleEdit();
    fixture.detectChanges();
    // ngModel applies its disabled state a tick later
    await fixture.whenStable();
    fixture.detectChanges();
    expect((tid('part-info-description') as HTMLTextAreaElement).disabled).toBe(true);
    component.common.set(true);
    component.save();
    expect(update).not.toHaveBeenCalled();
    expect(setProjects).toHaveBeenCalled();
  });

  it('cancel restores the saved values and locks', () => {
    create();
    component.toggleEdit();
    component.description.set('Changed');
    component.toggleProject(2);
    component.cancel();
    expect(component.editing()).toBe(false);
    expect(component.description()).toBe('Bracket');
    expect(component.projectIDs()).toEqual([1]);
  });

  it('says so when the document has no part', () => {
    create(part(), null);
    expect(tid('part-info-none')).toBeTruthy();
    expect(inventory.getPartById).not.toHaveBeenCalled();
  });

  it('emits closed from the close button', () => {
    create();
    const closed = vi.spyOn(component.closed, 'emit');
    tid('part-info-close')!.click();
    expect(closed).toHaveBeenCalled();
  });
});
