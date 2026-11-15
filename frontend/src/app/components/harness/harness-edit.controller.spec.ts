import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { HarnessEditController } from './harness-edit.controller';
import { HarnessService } from '../../services/harness.service';
import { HarnessData, WireHarness } from '../../models/harness.model';

// REQ 1067 — harness-mode state and operations for the CAD editor.
describe('HarnessEditController', () => {
  let hx: HarnessEditController;
  let harnessService: HarnessService;

  const data = (label = 'J1'): HarnessData => ({
    name: 'Loom',
    connectors: [{ id: 'c1', label, type: 'male', pinCount: 1, pins: [{ id: 'p1', number: '1' }], position: { x: 0, y: 0 } }],
    cables: [],
    components: [],
    connections: [],
  });

  const row = (over: Partial<WireHarness> = {}): WireHarness => ({
    id: 5, name: 'Loom', partNumber: 'LET-0005', partID: 9, revision: '01', description: 'Engine bay',
    harnessData: data(), thumbnailBase64: null, activeFlag: true, createdBy: null, createdAt: '', updatedAt: '',
    releaseState: 'draft', branchName: 'draft/01', baseCommitHash: 'aaa', dirty: false,
    lastContentSavedAt: null, lockedByUserID: null, released: false,
    ...over,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [HarnessEditController, provideHttpClient(), provideHttpClientTesting(), provideAnimationsAsync(), provideRouter([])],
    });
    hx = TestBed.inject(HarnessEditController);
    harnessService = TestBed.inject(HarnessService);
  });

  afterEach(() => hx.ngOnDestroy());

  describe('loading', () => {
    it('loads the harness and merges the row identity into the document', () => {
      vi.spyOn(harnessService, 'getHarnessById').mockReturnValue(of(row()));
      hx.load(5);
      expect(hx.currentHarnessId()).toBe(5);
      expect(hx.harnessData()).toMatchObject({ name: 'Loom', partNumber: 'LET-0005', revision: '01', description: 'Engine bay' });
      expect(hx.harnessData()!.connectors[0].label).toBe('J1');
      expect(hx.hasUnsavedChanges()).toBe(false);
    });
  });

  // REQ 1068 — the address names the part and, optionally, a branch
  describe('opening from the address', () => {
    it('opens the harness of a part', () => {
      const byPart = vi.spyOn(harnessService, 'getActiveByPart').mockReturnValue(of(row()));
      hx.loadByPart(9);
      expect(byPart).toHaveBeenCalledWith(9);
      expect(hx.currentHarnessId()).toBe(5);
      expect(hx.loading()).toBe(false);
    });

    it('lands on the branch named in the address', () => {
      vi.spyOn(harnessService, 'getHarnessById').mockReturnValue(of(row()));
      const switchBranch = vi.spyOn(harnessService, 'switchBranch')
        .mockReturnValue(of(row({ branchName: 'main', harnessData: data('MAIN') }) as any));
      hx.load(5, 'main');
      expect(switchBranch).toHaveBeenCalledWith(5, 'main');
      expect(hx.harness()!.branchName).toBe('main');
      expect(hx.harnessData()!.connectors[0].label).toBe('MAIN');
    });

    it('does not switch when already on that branch, and stays put when the switch is refused', () => {
      vi.spyOn(harnessService, 'getHarnessById').mockReturnValue(of(row()));
      const switchBranch = vi.spyOn(harnessService, 'switchBranch').mockReturnValue(throwError(() => ({ status: 409 })));
      hx.load(5, 'draft/01');
      expect(switchBranch).not.toHaveBeenCalled();
      hx.load(5, 'gone');
      expect(switchBranch).toHaveBeenCalledWith(5, 'gone');
      expect(hx.harness()!.branchName).toBe('draft/01');
    });
  });

  describe('read-only gating', () => {
    beforeEach(() => hx.adopt(row(), true));

    it('is read-only until the editor says otherwise', () => {
      expect(hx.isLocked()).toBe(true);
      hx.readonly.set(false);
      expect(hx.isLocked()).toBe(false);
    });

    it('does not save or import while read-only', () => {
      const update = vi.spyOn(harnessService, 'updateHarness');
      const open = vi.spyOn(TestBed.inject(MatDialog), 'open');
      hx.onDataChanged(data('J2'));
      hx.onSave();
      hx.onImportJSON();
      expect(update).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    });

    it('has nothing to flush when read-only or unchanged', async () => {
      const update = vi.spyOn(harnessService, 'updateHarness');
      await hx.flushSave();
      hx.readonly.set(false);
      await hx.flushSave();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('saving the working copy', () => {
    beforeEach(() => {
      hx.adopt(row({ lockedByUserID: 1, lastContentSavedAt: '2026-01-01T00:00:00.000Z' }), true);
      hx.readonly.set(false);
    });

    it('sends the last synced save token and adopts the new one', () => {
      const saved = row({ lockedByUserID: 1, dirty: true, lastContentSavedAt: '2026-01-02T00:00:00.000Z' });
      const update = vi.spyOn(harnessService, 'updateHarness').mockReturnValue(of(saved));
      hx.onDataChanged({ ...hx.harnessData()!, connectors: data('J2').connectors });
      expect(hx.hasUnsavedChanges()).toBe(true);
      hx.onSave();

      const [id, body] = update.mock.calls[0];
      expect(id).toBe(5);
      expect(body.clientSavedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(body.harnessData!.connectors[0].label).toBe('J2');
      expect(hx.harness()).toMatchObject({ dirty: true, lastContentSavedAt: '2026-01-02T00:00:00.000Z' });
      expect(hx.hasUnsavedChanges()).toBe(false);
      // The server echo must not replace the document being edited
      expect(hx.harnessData()!.connectors[0].label).toBe('J2');
    });

    it('flushes a pending edit before a check-in', async () => {
      const update = vi.spyOn(harnessService, 'updateHarness').mockReturnValue(of(row({ lockedByUserID: 1, dirty: true })));
      hx.onDataChanged({ ...hx.harnessData()!, connectors: data('J3').connectors });
      await hx.flushSave();
      expect(update).toHaveBeenCalledTimes(1);
      expect(hx.hasUnsavedChanges()).toBe(false);
    });

    it('strips element images from what it saves', () => {
      const update = vi.spyOn(harnessService, 'updateHarness').mockReturnValue(of(row({ lockedByUserID: 1 })));
      const withImage = data('J2');
      withImage.connectors[0].connectorImage = 'data:image/png;base64,AAAA';
      hx.onDataChanged({ ...hx.harnessData()!, connectors: withImage.connectors });
      hx.onSave();
      expect(update.mock.calls[0][1].harnessData!.connectors[0].connectorImage).toBeUndefined();
    });
  });

  describe('adopting version-control updates', () => {
    beforeEach(() => {
      hx.adopt(row({ lockedByUserID: 1 }), true);
      hx.readonly.set(false);
      hx.onDataChanged({ ...hx.harnessData()!, connectors: data('LOCAL').connectors });
    });

    it('keeps local edits when only lock or commit state changes (check-in)', () => {
      hx.adopt(row({ lockedByUserID: null, baseCommitHash: 'bbb', harnessData: data('SERVER') }));
      expect(hx.harness()!.baseCommitHash).toBe('bbb');
      expect(hx.harnessData()!.connectors[0].label).toBe('LOCAL');
    });

    it('reloads the document when the working copy moves to another branch', () => {
      hx.adopt(row({ branchName: 'main', releaseState: 'released', harnessData: data('MAIN') }));
      expect(hx.harnessData()!.connectors[0].label).toBe('MAIN');
      expect(hx.harnessData()!.releaseState).toBe('released');
    });

    it('reloads the document when asked to (undo checkout)', () => {
      hx.adopt(row({ lockedByUserID: null, harnessData: data('BASE') }), true);
      expect(hx.harnessData()!.connectors[0].label).toBe('BASE');
      expect(hx.hasUnsavedChanges()).toBe(false);
    });

    it('reloads when a checkout fast-forwards a clean copy', () => {
      hx.adopt(row({ lockedByUserID: null, harnessData: data('OLD') }), true);
      hx.adopt(row({ lockedByUserID: 1, baseCommitHash: 'ccc', harnessData: data('HEAD') }));
      expect(hx.harnessData()!.connectors[0].label).toBe('HEAD');
    });
  });

  describe('editing a component in the properties rail', () => {
    const comp = (label = 'U1') => ({ id: 'comp-1', label, pinCount: 0, pinGroups: [], position: { x: 0, y: 0 } }) as any;

    beforeEach(() => {
      hx.adopt(row({ lockedByUserID: 1, harnessData: { ...data(), components: [comp()] } }), true);
      hx.readonly.set(false);
    });

    it('selects the component instead of opening a dialog', () => {
      const open = vi.spyOn(TestBed.inject(MatDialog), 'open');
      hx.onEditComponent(comp());
      expect(open).not.toHaveBeenCalled();
      expect(hx.currentSelection()).toMatchObject({ type: 'component', component: { id: 'comp-1' } });
    });

    it('applies a change to the document and keeps the selection on the edited component', () => {
      hx.onComponentPropertyChanged(comp('K1'));
      expect(hx.harnessData()!.components[0].label).toBe('K1');
      expect(hx.currentSelection()!.component!.label).toBe('K1');
      expect(hx.hasUnsavedChanges()).toBe(true);
      expect(hx.canUndo()).toBe(true);
    });

    it('ignores a change while read-only', () => {
      hx.readonly.set(true);
      hx.onComponentPropertyChanged(comp('K1'));
      expect(hx.harnessData()!.components[0].label).toBe('U1');
    });
  });

  describe('editing a connector or cable in the properties rail', () => {
    const cable = (label = 'W1') => ({ id: 'cable-1', label, wireCount: 1, wires: [{ id: 'w1', color: 'Red' }], position: { x: 0, y: 0 } }) as any;

    beforeEach(() => {
      hx.adopt(row({ lockedByUserID: 1, harnessData: { ...data(), cables: [cable()] } }), true);
      hx.readonly.set(false);
    });

    it('selects the element instead of opening a dialog', () => {
      const open = vi.spyOn(TestBed.inject(MatDialog), 'open');
      hx.onEditConnector(hx.harnessData()!.connectors[0]);
      expect(hx.currentSelection()).toMatchObject({ type: 'connector', connector: { id: 'c1' } });
      hx.onEditCable(cable());
      expect(hx.currentSelection()).toMatchObject({ type: 'cable', cable: { id: 'cable-1' } });
      expect(open).not.toHaveBeenCalled();
    });

    it('applies connector and cable changes and keeps the selection current', () => {
      hx.onConnectorEdited({ ...hx.harnessData()!.connectors[0], label: 'P7' });
      expect(hx.harnessData()!.connectors[0].label).toBe('P7');
      expect(hx.currentSelection()!.connector!.label).toBe('P7');
      hx.onCableEdited(cable('W9'));
      expect(hx.harnessData()!.cables[0].label).toBe('W9');
      expect(hx.currentSelection()!.cable!.label).toBe('W9');
      expect(hx.hasUnsavedChanges()).toBe(true);
    });

    it('ignores changes while read-only', () => {
      hx.readonly.set(true);
      hx.onConnectorEdited({ ...hx.harnessData()!.connectors[0], label: 'P7' });
      hx.onCableEdited(cable('W9'));
      expect(hx.harnessData()!.connectors[0].label).toBe('J1');
      expect(hx.harnessData()!.cables[0].label).toBe('W1');
    });
  });

  it('stops listening for keyboard shortcuts when the editor closes', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    hx.ngOnDestroy();
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
