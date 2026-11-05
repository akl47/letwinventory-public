// REQ 991 — "does the server hold exactly the content this save sent?"
// Postgres JSONB reorders object keys, so compare key-order-insensitively.

export interface SavedContent {
  featureTree: unknown;
  sketchDoc: unknown;
  equations: unknown;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort()
      .map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function sameSavedContent(server: Partial<SavedContent>, sent: SavedContent): boolean {
  return canonical(server.featureTree) === canonical(sent.featureTree)
    && canonical(server.sketchDoc) === canonical(sent.sketchDoc)
    && canonical(server.equations) === canonical(sent.equations);
}
