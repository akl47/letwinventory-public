import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { CadFeatureTreePanelComponent } from './cad-feature-tree-panel.component';

// REQ 899 — feature-tree rows with an error/warning offer a right-click
// "Copy error text" item that puts the full message on the clipboard.
describe('CadFeatureTreePanelComponent — copy error text (REQ 899)', () => {
  let fixture: ComponentFixture<CadFeatureTreePanelComponent>;
  let component: CadFeatureTreePanelComponent;
  let writeText: ReturnType<typeof vi.fn>;

  const featureNode = {
    kind: 'feature', key: 'f:x1', label: 'Sweep 1', depth: 0, selectable: true,
    feature: { id: 'x1', type: 'sweep' }, featureIndex: 0,
  } as never;
  const sketchNode = {
    kind: 'sketch', key: 's:s1', label: 'Sketch 1', depth: 0, selectable: false,
    sketchId: 's1',
  } as never;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CadFeatureTreePanelComponent],
      providers: [provideNoopAnimations()],
    });
    fixture = TestBed.createComponent(CadFeatureTreePanelComponent);
    component = fixture.componentInstance;
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openContextMenu(node: never): Promise<void> {
    component.onRowContextMenu(new MouseEvent('contextmenu', { clientX: 20, clientY: 20 }), node);
    await Promise.resolve();  // queueMicrotask(openMenu)
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function menuButton(testId: string): HTMLButtonElement | null {
    return document.querySelector(`[data-testid="${testId}"]`);
  }

  it('offers Copy error text on a feature with a regen error and copies it', async () => {
    const msg = 'buildShell: the body has a swept elbow that pinches to a point…';
    fixture.componentRef.setInput('featureErrors', new Map([['x1', msg]]));
    fixture.detectChanges();
    await openContextMenu(featureNode);
    const btn = menuButton('ctx-copy-feature-error');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(writeText).toHaveBeenCalledWith(msg);
  });

  it('hides Copy error text on a healthy feature', async () => {
    await openContextMenu(featureNode);
    expect(menuButton('ctx-edit-feature')).not.toBeNull();  // menu did open
    expect(menuButton('ctx-copy-feature-error')).toBeNull();
  });

  it('offers Copy error text on a sketch with a missing reference face', async () => {
    fixture.componentRef.setInput('danglingSketchIds', new Set(['s1']));
    fixture.detectChanges();
    await openContextMenu(sketchNode);
    const btn = menuButton('ctx-copy-sketch-error');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(writeText).toHaveBeenCalledWith(component.sketchWarningText('s1'));
  });

  it('hides Copy error text on a healthy sketch', async () => {
    await openContextMenu(sketchNode);
    expect(menuButton('ctx-edit-sketch')).not.toBeNull();  // menu did open
    expect(menuButton('ctx-copy-sketch-error')).toBeNull();
  });

  it('sketchWarningText mirrors the dangling-host indicator', () => {
    expect(component.sketchWarningText('s1')).toBeNull();
    fixture.componentRef.setInput('danglingSketchIds', new Set(['s1']));
    fixture.detectChanges();
    expect(component.sketchWarningText('s1')).toContain('Reference face missing');
  });
});
