// REQ 1042 — 3MF export for 3D-printing slicers. Built on the client from the
// viewer's per-face meshes (mm), like STL export. Each body group forms one
// object whose parts are its bodies, kept in place; every ungrouped body is its
// own object. Colors go
// out twice: core-3MF base materials (any slicer) and Bambu Studio / OrcaSlicer
// filament slots (Metadata/*.config), one slot per distinct color.
import JSZip from 'jszip';
import type { StlMesh } from './stlExport';

/** Viewer face color — what an uncolored body looks like (hex, no '#'). */
export const DEFAULT_BODY_COLOR = '8aa0c4';

export interface ThreeMfBody {
  id: string;
  name: string;
  /** 'rrggbb' (no '#'), or null for the default color. */
  color: string | null;
  meshes: StlMesh[];
}

/** REQ 1042/1045 — 3MF objects for the exported bodies: each body group's
 * exported members form one object (named after the group, placed where its
 * first member is); every ungrouped body is its own object. */
export function groupObjects(
  bodyIds: string[], groups: Array<{ name: string; bodyIds: string[] }>,
): { objects: string[][]; names: Array<string | undefined> } {
  const groupOf = new Map<string, { name: string; bodyIds: string[] }>();
  for (const g of groups) for (const id of g.bodyIds) groupOf.set(id, g);
  const objects: string[][] = [];
  const names: Array<string | undefined> = [];
  const placed = new Set<object>();
  for (const id of bodyIds) {
    const g = groupOf.get(id);
    if (!g) { objects.push([id]); names.push(undefined); continue; }
    if (placed.has(g)) continue;
    placed.add(g);
    objects.push(bodyIds.filter(b => groupOf.get(b) === g));
    names.push(g.name);
  }
  return { objects, names };
}

/** One indexed mesh from separate face meshes: vertices at the same position
 * (to 1e-6 mm) are shared, so a closed body stays manifold across face seams.
 * Triangles that collapse onto a repeated vertex are dropped. */
export function weldMeshes(meshes: StlMesh[]): { vertices: number[]; triangles: number[] } {
  const vertices: number[] = [];
  const triangles: number[] = [];
  const index = new Map<string, number>();
  const q = (v: number) => Math.round(v * 1e6);
  for (const m of meshes) {
    const local: number[] = [];
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2];
      const key = `${q(x)},${q(y)},${q(z)}`;
      let n = index.get(key);
      if (n === undefined) {
        n = vertices.length / 3;
        vertices.push(x, y, z);
        index.set(key, n);
      }
      local.push(n);
    }
    for (let t = 0; t + 2 < m.indices.length; t += 3) {
      const a = local[m.indices[t]], b = local[m.indices[t + 1]], c = local[m.indices[t + 2]];
      if (a === b || b === c || a === c) continue;
      triangles.push(a, b, c);
    }
  }
  return { vertices, triangles };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => String(Math.round(v * 1e6) / 1e6);
const hex = (c: string | null) => `#${(c || DEFAULT_BODY_COLOR).toUpperCase()}`;

/** Gap between objects laid out on the bed, and the bed center they gather
 * around (256 mm Bambu beds; the slicer re-arranges on demand). */
const BED_GAP = 10;
const BED_CENTER = 128;

/** The 3MF package as path → file text. `objectNames[i]` names object i
 * (a body group's name); unnamed objects join their body names. */
export function build3mfFiles(groups: ThreeMfBody[][], objectNames: Array<string | undefined> = []): Record<string, string> {
  const bodies = groups.flat();
  const slots: string[] = [];
  const slotOf = (b: ThreeMfBody) => {
    const c = hex(b.color);
    if (!slots.includes(c)) slots.push(c);
    return slots.indexOf(c) + 1;
  };

  // Ids: 1 = base materials; then one mesh object per body; then one parent
  // object per group.
  let nextId = 2;
  const meshIds = new Map(bodies.map(b => [b.id, nextId++]));
  const objects: string[] = [];
  const items: string[] = [];
  const settings: string[] = [];

  bodies.forEach((b, i) => {
    const { vertices, triangles } = weldMeshes(b.meshes);
    const vs: string[] = [];
    for (let k = 0; k < vertices.length; k += 3) {
      vs.push(`<vertex x="${num(vertices[k])}" y="${num(vertices[k + 1])}" z="${num(vertices[k + 2])}"/>`);
    }
    const ts: string[] = [];
    for (let k = 0; k < triangles.length; k += 3) {
      ts.push(`<triangle v1="${triangles[k]}" v2="${triangles[k + 1]}" v3="${triangles[k + 2]}"/>`);
    }
    objects.push(
      `<object id="${meshIds.get(b.id)}" name="${esc(b.name)}" type="model" pid="1" pindex="${i}">` +
      `<mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>`);
  });

  // Lay the groups out in a row across the bed, each resting on z = 0.
  const boxes = groups.map(g => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const b of g) for (const m of b.meshes) {
      for (let k = 0; k < m.positions.length; k++) {
        lo[k % 3] = Math.min(lo[k % 3], m.positions[k]);
        hi[k % 3] = Math.max(hi[k % 3], m.positions[k]);
      }
    }
    return { lo, hi };
  });
  const rowWidth = boxes.reduce((w, bx) => w + (bx.hi[0] - bx.lo[0]), 0) + BED_GAP * (groups.length - 1);
  let cursor = BED_CENTER - rowWidth / 2;

  groups.forEach((g, gi) => {
    const id = nextId++;
    const { lo, hi } = boxes[gi];
    const tx = cursor - lo[0];
    const ty = BED_CENTER - (lo[1] + hi[1]) / 2;
    const tz = -lo[2];
    cursor += hi[0] - lo[0] + BED_GAP;
    const name = objectNames[gi] || g.map(b => b.name).join(' + ');
    objects.push(
      `<object id="${id}" name="${esc(name)}" type="model"><components>` +
      g.map(b => `<component objectid="${meshIds.get(b.id)}"/>`).join('') +
      `</components></object>`);
    items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(tx)} ${num(ty)} ${num(tz)}" printable="1"/>`);
    settings.push(
      `  <object id="${id}">\n    <metadata key="name" value="${esc(name)}"/>\n    <metadata key="extruder" value="${slotOf(g[0])}"/>\n` +
      g.map(b =>
        `    <part id="${meshIds.get(b.id)}" subtype="normal_part">\n` +
        `      <metadata key="name" value="${esc(b.name)}"/>\n` +
        `      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n` +
        `      <metadata key="extruder" value="${slotOf(b)}"/>\n    </part>\n`).join('') +
      `  </object>\n`);
  });

  const materials = `<basematerials id="1">` +
    bodies.map(b => `<base name="${esc(b.name)}" displaycolor="${hex(b.color)}FF"/>`).join('') + `</basematerials>`;

  return {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
      '<Default Extension="config" ContentType="text/xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
      '</Relationships>',
    '3D/3dmodel.model':
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
      '<metadata name="Application">Letwinventory CAD</metadata>' +
      `<resources>${materials}${objects.join('')}</resources>` +
      `<build>${items.join('')}</build></model>`,
    'Metadata/model_settings.config':
      `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${settings.join('')}</config>\n`,
    'Metadata/project_settings.config': JSON.stringify({ filament_colour: slots }, null, 2),
  };
}

export async function build3mf(groups: ThreeMfBody[][], objectNames: Array<string | undefined> = []): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(build3mfFiles(groups, objectNames))) zip.file(path, text);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'model/3mf' });
}
