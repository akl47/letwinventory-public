import { describe, it, expect } from 'vitest';
import { CadTab, closeTab, moveTab, openTab, parseTabs, tabKey, tabLabel, tabLink } from './cadTabs';

const a: CadTab = { partID: 1, assembly: false, revisionID: 10, name: 'Bracket' };
const b: CadTab = { partID: 2, assembly: true, name: 'Frame' };
const c: CadTab = { partID: 3, assembly: false, revisionID: 30, name: 'Pin' };

describe('CAD editor tab strip (REQ 1002)', () => {
  it('appends a newly opened part', () => {
    expect(openTab([a], b)).toEqual([a, b]);
  });

  it('re-opening a part keeps its position and refreshes its details', () => {
    const renamed = { ...a, name: 'Bracket v2', revisionID: 11 };
    expect(openTab([a, b], renamed)).toEqual([renamed, b]);
  });

  it('closing a background tab leaves the active part alone', () => {
    expect(closeTab([a, b, c], 'p1', 'p2')).toEqual({ tabs: [b, c], next: null });
  });

  it('closing the active tab moves to the tab on its right, else its left', () => {
    expect(closeTab([a, b, c], 'p2', 'p2')).toEqual({ tabs: [a, c], next: c });
    expect(closeTab([a, b, c], 'p3', 'p3')).toEqual({ tabs: [a, b], next: b });
  });

  it('closing the last tab has nowhere to go', () => {
    expect(closeTab([a], 'p1', 'p1')).toEqual({ tabs: [], next: null });
  });

  it('builds the editor link for parts and assemblies', () => {
    expect(tabLink(a)).toEqual({ commands: ['/parts', 1, 'cad', 'editor'], queryParams: { revisionID: 10 } });
    expect(tabLink(b)).toEqual({ commands: ['/parts', 2, 'assembly', 'editor'], queryParams: {} });
  });

  // REQ 1068
  it('keeps harness tabs apart from part tabs and links them to the harness editor', () => {
    const h: CadTab = { partID: 0, assembly: false, harnessID: 1, name: 'Loom' };
    expect(tabKey(h)).toBe('h1');
    expect(tabKey(a)).toBe('p1');
    expect(openTab([a], h)).toEqual([a, h]);
    expect(openTab([a, h], { ...h, rev: '02*' })).toEqual([a, { ...h, rev: '02*' }]);
    expect(closeTab([a, h], 'h1', 'h1')).toEqual({ tabs: [a], next: a });
    expect(tabLink(h)).toEqual({ commands: ['/harness', 'editor', 1], queryParams: {} });
    // With a part, the address takes the CAD form
    expect(tabLink({ ...h, partID: 9 })).toEqual({ commands: ['/parts', 9, 'harness', 'editor'], queryParams: { revisionID: 1 } });
    expect(tabKey({ ...h, partID: 9 })).toBe('h1');
  });

  it('labels tabs PN-rev', () => {
    expect(tabLabel({ ...a, rev: '02*' })).toBe('Bracket-02*');
    expect(tabLabel(a)).toBe('Bracket');
  });

  it('drag-reorders tabs', () => {
    expect(moveTab([a, b, c], 0, 2)).toEqual([b, c, a]);
    expect(moveTab([a, b, c], 2, 0)).toEqual([c, a, b]);
    expect(moveTab([a, b, c], 1, 1)).toEqual([a, b, c]);
  });

  it('restores persisted tabs and ignores corrupt storage', () => {
    expect(parseTabs(JSON.stringify([a, b]))).toEqual([a, b]);
    expect(parseTabs(null)).toEqual([]);
    expect(parseTabs('not json')).toEqual([]);
    expect(parseTabs(JSON.stringify([{ name: 'no id' }, a]))).toEqual([a]);
  });
});
