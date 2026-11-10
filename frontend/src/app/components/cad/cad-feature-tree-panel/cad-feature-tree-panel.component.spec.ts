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

// REQ 995 — minimized (compact) sidebar: icon-only rows, every feature group
// expanded so consumed sketches show, names in tooltips.
describe('CadFeatureTreePanelComponent — compact mode (REQ 995)', () => {
  let fixture: ComponentFixture<CadFeatureTreePanelComponent>;
  let component: CadFeatureTreePanelComponent;

  const features = [
    { id: 'f1', type: 'origin', createdAt: 0 },
    { id: 'e1', type: 'extrude', name: 'Extrude 1', sketchId: 's1', distance: 10, createdAt: 2 },
  ] as never;
  const doc = {
    nextSketchSeq: 2,
    sketches: {
      s1: {
        id: 's1', name: 'Sketch 1', hostId: 'datum:xy_plane', createdAt: 1, visible: false,
        plane: { origin: [0, 0, 0], normal: [0, 0, 1], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
        state: { entities: [], constraints: [] },
      },
    },
  } as never;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CadFeatureTreePanelComponent],
      providers: [provideNoopAnimations()],
    });
    fixture = TestBed.createComponent(CadFeatureTreePanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('features', features);
    fixture.componentRef.setInput('doc', doc);
    fixture.detectChanges();
  });

  const keys = () => component.nodes().map(n => n.key);

  it('compact mode lists a reused sketch once, before the first feature that uses it', () => {
    fixture.componentRef.setInput('features', [
      ...(features as unknown as object[]),
      { id: 'c1', type: 'cutExtrude', name: 'Cut 1', sketchId: 's1', distance: 2, createdAt: 3 },
    ] as never);
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    const ks = keys();
    expect(ks.filter(k => k === 'child:s1')).toHaveLength(1);
    expect(ks.indexOf('child:s1')).toBeLessThan(ks.indexOf('e1'));
    expect(ks.indexOf('e1')).toBeLessThan(ks.indexOf('c1'));
    expect(component.nodes().every(n => n.depth === 0)).toBe(true);
  });

  it('full mode keeps a consumed sketch folded under its feature', () => {
    expect(keys()).not.toContain('child:s1');
  });

  it('compact mode expands every feature so the sketch row shows, origin datums stay folded', () => {
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    const ks = keys();
    expect(ks).toContain('child:s1');
    expect(ks.indexOf('child:s1')).toBeLessThan(ks.indexOf('e1'));
    expect(component.nodes().some(n => n.kind === 'datum')).toBe(false);
  });

  it('compact rows render icons only, with the name as the tooltip', () => {
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.panel.compact')).not.toBeNull();
    const row = el.querySelector('[data-node-key="child:s1"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.querySelector('.label')).toBeNull();
    expect(row.querySelector('.kind-icon')).not.toBeNull();
    expect(row.getAttribute('aria-label')).toBe('Sketch 1');
  });
});

describe('CadFeatureTreePanelComponent — context visibility (REQ 997)', () => {
  let fixture: ComponentFixture<CadFeatureTreePanelComponent>;

  const ctxNode = (visible: boolean) => ({
    key: 'ctxasm:7', kind: 'feature', label: 'Context - Asm (active)', iconName: 'hub', iconClass: 'part',
    depth: 0, expandable: false, expanded: false, selectable: false, selected: true,
    visibilityToggleable: true, visible,
  }) as never;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CadFeatureTreePanelComponent],
      providers: [provideNoopAnimations()],
    });
    fixture = TestBed.createComponent(CadFeatureTreePanelComponent);
    fixture.componentRef.setInput('features', [{ id: 'f1', type: 'origin', createdAt: 0 }] as never);
    fixture.componentRef.setInput('contextNodes', [ctxNode(true)]);
    fixture.detectChanges();
  });

  it('the active context row has an eye that emits contextVisibilityToggled', () => {
    const emitted: string[] = [];
    fixture.componentInstance.contextVisibilityToggled.subscribe(k => emitted.push(k));
    const btn = fixture.nativeElement.querySelector('[data-node-key="ctxasm:7"] .visibility-toggle') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(emitted).toEqual(['ctxasm:7']);
  });

  it('shows the hidden icon when the context is hidden', () => {
    fixture.componentRef.setInput('contextNodes', [ctxNode(false)]);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-node-key="ctxasm:7"] .visibility-toggle') as HTMLElement;
    expect(btn.textContent).toContain('visibility_off');
  });
});

// REQs 1044/1045 — body multi-select (click / Ctrl / Shift) with bulk actions,
// and body groups shown as a parent row.
describe('CadFeatureTreePanelComponent — body selection and groups (REQ 1044, 1045)', () => {
  let fixture: ComponentFixture<CadFeatureTreePanelComponent>;
  let component: CadFeatureTreePanelComponent;
  const bodies = [
    { id: 'b1', name: 'Base', color: undefined },
    { id: 'b2', name: null },
    { id: 'b3', name: null },
    { id: 'b4', name: null },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CadFeatureTreePanelComponent], providers: [provideNoopAnimations()] });
    fixture = TestBed.createComponent(CadFeatureTreePanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('bodyList', bodies);
    fixture.detectChanges();
  });

  const click = (id: string, mods: MouseEventInit = {}) =>
    component.onBodyRowClick(new MouseEvent('click', mods), { id });

  it('click selects one, Ctrl toggles, Shift selects a range', () => {
    click('b1');
    expect([...component.selectedBodyIds()]).toEqual(['b1']);
    click('b3', { ctrlKey: true });
    expect([...component.selectedBodyIds()].sort()).toEqual(['b1', 'b3']);
    click('b1', { ctrlKey: true });
    expect([...component.selectedBodyIds()]).toEqual(['b3']);
    click('b2');
    click('b4', { shiftKey: true });
    expect([...component.selectedBodyIds()].sort()).toEqual(['b2', 'b3', 'b4']);
  });

  it('a context-menu action applies to the whole selection', () => {
    const colors: Array<{ bodyIds: string[]; color: string | null }> = [];
    component.bodyColorChanged.subscribe(e => colors.push(e));
    click('b1');
    click('b2', { ctrlKey: true });
    component.onBodyContextMenu(new MouseEvent('contextmenu'), { id: 'b2' });
    component.setBodyColor('e53935');
    expect(colors).toEqual([{ bodyIds: ['b1', 'b2'], color: 'e53935' }]);
  });

  it('right-clicking outside the selection selects just that body', () => {
    click('b1');
    click('b2', { ctrlKey: true });
    component.onBodyContextMenu(new MouseEvent('contextmenu'), { id: 'b4' });
    expect([...component.selectedBodyIds()]).toEqual(['b4']);
    expect(component.contextBodyIds()).toEqual(['b4']);
  });

  it('shows a group as a parent row with its members under it', () => {
    fixture.componentRef.setInput('bodyGroups', [{ id: 'g1', name: 'Kit', bodyIds: ['b3', 'b1', 'gone'] }]);
    fixture.detectChanges();
    expect(component.bodyRows().map(r => `${r.kind}:${r.id}:${r.depth}`)).toEqual([
      'group:g1:0', 'body:b1:1', 'body:b3:1', 'body:b2:0', 'body:b4:0',
    ]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="body-group-g1"]')?.textContent).toContain('Kit');
  });

  // REQ 1047 — drag bodies onto a group row / the Bodies header.
  const dragEvent = () => ({ preventDefault: () => {}, dataTransfer: null }) as unknown as DragEvent;

  it('dragging the selection onto a group adds every selected body to it', () => {
    fixture.componentRef.setInput('bodyGroups', [{ id: 'g1', name: 'Kit', bodyIds: ['b1'] }]);
    fixture.detectChanges();
    const acts: unknown[] = [];
    component.bodyGroupAction.subscribe(a => acts.push(a));
    click('b3');
    click('b4', { ctrlKey: true });
    component.onBodyDragStart(dragEvent(), { id: 'b4' });
    component.onBodyDragOver(dragEvent(), 'g1');
    expect(component.bodyDropGroupId()).toBe('g1');
    component.onBodyDrop(dragEvent(), 'g1');
    expect(acts).toEqual([{ action: 'add', groupId: 'g1', bodyIds: ['b3', 'b4'] }]);
    expect(component.bodyDropGroupId()).toBeNull();
  });

  it('dropping a grouped body on the Bodies header ungroups it; an unselected drag moves just that body', () => {
    fixture.componentRef.setInput('bodyGroups', [{ id: 'g1', name: 'Kit', bodyIds: ['b1', 'b2'] }]);
    fixture.detectChanges();
    const acts: unknown[] = [];
    component.bodyGroupAction.subscribe(a => acts.push(a));
    click('b3');
    component.onBodyDragStart(dragEvent(), { id: 'b2' });
    component.onBodyDrop(dragEvent(), '');
    expect(acts).toEqual([{ action: 'remove', bodyIds: ['b2'] }]);
  });

  it('lists the groups the context bodies can join', () => {
    fixture.componentRef.setInput('bodyGroups', [
      { id: 'g1', name: 'A', bodyIds: ['b1'] }, { id: 'g2', name: 'B', bodyIds: ['b2'] },
    ]);
    fixture.detectChanges();
    component.onBodyContextMenu(new MouseEvent('contextmenu'), { id: 'b1' });
    expect(component.groupsToJoin().map(g => g.id)).toEqual(['g2']);
  });

  it('group asks for the selected bodies', () => {
    const acts: unknown[] = [];
    component.bodyGroupAction.subscribe(a => acts.push(a));
    click('b2');
    click('b4', { ctrlKey: true });
    component.onBodyContextMenu(new MouseEvent('contextmenu'), { id: 'b4' });
    component.groupSelectedBodies();
    expect(acts).toEqual([{ action: 'group', bodyIds: ['b2', 'b4'] }]);
  });
});

// REQ 1046 — folders in the part feature tree.
describe('CadFeatureTreePanelComponent — feature folders (REQ 1046)', () => {
  let fixture: ComponentFixture<CadFeatureTreePanelComponent>;
  let component: CadFeatureTreePanelComponent;
  const features = [
    { id: 'f0', type: 'origin', createdAt: 0 },
    { id: 'f1', type: 'datumPlane', name: 'P1', createdAt: 1 },
    { id: 'f2', type: 'datumPlane', name: 'P2', createdAt: 2 },
    { id: 'f3', type: 'datumPlane', name: 'P3', createdAt: 3 },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CadFeatureTreePanelComponent], providers: [provideNoopAnimations()] });
    fixture = TestBed.createComponent(CadFeatureTreePanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('features', features);
    fixture.componentRef.setInput('folders', [{ id: 'a', name: 'Planes', memberKeys: ['f1', 'f2'] }]);
    fixture.detectChanges();
  });

  const top = () => component.nodes().filter(n => n.depth === 0).map(n => n.key);

  it('shows a folder row over its consecutive members and collapses it on click', () => {
    expect(top()).toEqual(['f0', 'folder:a', 'f3']);
    expect(component.nodes().find(n => n.key === 'f1')?.depth).toBe(1);
    component.onRowClick(component.nodes().find(n => n.key === 'folder:a')!, new MouseEvent('click'));
    expect(component.nodes().some(n => n.key === 'f1')).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="folder-row-a"]')).toBeTruthy();
  });

  it('offers only folder actions that keep the run consecutive', () => {
    const f3 = component.nodes().find(n => n.key === 'f3')!;
    component.onRowContextMenu(new MouseEvent('contextmenu'), f3);
    expect(component.ctxKeys()).toEqual(['f3']);
    expect(component.foldersAccepting(['f3']).map(f => f.id)).toEqual(['a']);
    expect(component.canFolderKeys(['f1', 'f3'])).toBe(false);
    expect(component.inAnyFolder(['f3'])).toBe(false);
  });
});
