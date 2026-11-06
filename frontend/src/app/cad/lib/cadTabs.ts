/** REQ 1002 — the CAD editor's open-parts tab strip. Pure list operations;
 * persistence and navigation live in CadTabsService / the editor. */
export interface CadTab {
  partID: number;
  assembly: boolean;
  /** Part-CAD model id (the editor's `revisionID` query param). */
  revisionID?: number;
  name: string;
  /** Revision shown after the name (e.g. "02*" for a draft). */
  rev?: string;
}

export function tabLabel(tab: CadTab): string {
  return tab.rev ? `${tab.name} rev ${tab.rev}` : tab.name;
}

/** Add a tab, or refresh an existing one in place. */
export function openTab(tabs: CadTab[], tab: CadTab): CadTab[] {
  const i = tabs.findIndex((t) => t.partID === tab.partID);
  if (i < 0) return [...tabs, tab];
  const next = tabs.slice();
  next[i] = tab;
  return next;
}

/** Remove a tab. When it was the active one, `next` is the tab to switch to
 * (right neighbour, else left) — null when nothing remains or no switch is needed. */
export function closeTab(tabs: CadTab[], partID: number, activePartID: number | null): { tabs: CadTab[]; next: CadTab | null } {
  const i = tabs.findIndex((t) => t.partID === partID);
  if (i < 0) return { tabs, next: null };
  const rest = tabs.filter((t) => t.partID !== partID);
  const next = partID === activePartID ? (rest[i] ?? rest[i - 1] ?? null) : null;
  return { tabs: rest, next };
}

export function tabLink(tab: CadTab): { commands: unknown[]; queryParams: Record<string, number> } {
  return tab.assembly
    ? { commands: ['/parts', tab.partID, 'assembly', 'editor'], queryParams: {} }
    : { commands: ['/parts', tab.partID, 'cad', 'editor'], queryParams: tab.revisionID ? { revisionID: tab.revisionID } : {} };
}

export function parseTabs(raw: string | null): CadTab[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t) => t && Number.isFinite(t.partID) && typeof t.name === 'string') : [];
  } catch {
    return [];
  }
}
