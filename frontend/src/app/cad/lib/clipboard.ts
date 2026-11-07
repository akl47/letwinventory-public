import type { FeatureTree, SketchDocument } from './types';
import type { EquationDoc } from './equations';

/** REQ 1011 — copy/paste bundle. Travels as JSON text on the OS clipboard
 * (or in a .lwcad file) so it can move between deployments (prod ↔ dev). */
export interface ClipboardBundle {
  kind: 'letwinventory-cad';
  schema: 1;
  scope: 'part';
  /** Server NAMING_VERSION at copy time; null if not yet known. */
  namingVersion: number | null;
  source: {
    origin: string;
    modelId: number;
    partName: string;
    partRev: string;
    description: string | null;
  };
  /** scope 'part': the whole current model (no history). */
  model?: { featureTree: FeatureTree; sketchDoc: SketchDocument; equations: EquationDoc | null };
}

export type ParsedBundle = { bundle: ClipboardBundle; warning?: string } | { error: string };

const KIND = 'letwinventory-cad';
const SCHEMA = 1;

interface SourceModel {
  id: number;
  featureTree: FeatureTree;
  sketchDoc: SketchDocument;
  equations?: EquationDoc | null;
  part?: { name: string; description?: string | null } | null;
}

/** REQ 1012 — whole-part bundle of the model's current state. */
export function buildPartBundle(
  m: SourceModel, opts: { origin: string; namingVersion: number | null; rev: string },
): ClipboardBundle {
  return {
    kind: KIND, schema: SCHEMA, scope: 'part', namingVersion: opts.namingVersion,
    source: {
      origin: opts.origin, modelId: m.id,
      partName: m.part?.name ?? '', partRev: opts.rev, description: m.part?.description ?? null,
    },
    model: structuredClone({ featureTree: m.featureTree, sketchDoc: m.sketchDoc, equations: m.equations ?? null }),
  };
}

export function serializeBundle(b: ClipboardBundle): string {
  return JSON.stringify(b);
}

/** Parse pasted text / file contents. Null = not a CAD bundle (ignore it). */
export function parseBundle(text: string, localNamingVersion: number | null): ParsedBundle | null {
  let o: any;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object' || o.kind !== KIND) return null;
  if (o.schema !== SCHEMA) return { error: 'This copy was made by a newer version of the CAD editor — update this environment first' };
  if (o.scope === 'assembly') return { error: 'Assemblies cannot be copied yet' };
  if (o.scope !== 'part' || !o.model?.featureTree || !o.model?.sketchDoc || !o.source) {
    return { error: 'The copied CAD data is incomplete' };
  }
  const bundle = o as ClipboardBundle;
  if (localNamingVersion !== null && bundle.namingVersion !== null && bundle.namingVersion !== localNamingVersion) {
    return { bundle, warning: 'Copied from a different CAD kernel version — some face/edge references may need re-picking' };
  }
  return { bundle };
}

/** Model ids collide across environments, so "same part" needs the origin too. */
export function sameModel(b: ClipboardBundle, origin: string, modelId: number): boolean {
  return b.source.origin === origin && b.source.modelId === modelId;
}

export function partFileName(b: ClipboardBundle): string {
  const { partName, partRev } = b.source;
  return `${partRev ? `${partName}-${partRev}` : partName}.lwcad`;
}
