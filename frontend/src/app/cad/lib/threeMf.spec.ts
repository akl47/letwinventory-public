import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { build3mf, build3mfFiles, groupObjects, weldMeshes, type ThreeMfBody } from './threeMf';

// REQ 1042 — 3MF export for slicers: a body group forms one object (one part
// per body), ungrouped bodies are separate objects, colors become
// base materials + Bambu/Orca filament slots.

/** Axis-aligned box as 6 separate face meshes (unwelded, like the viewer's). */
function box(x0: number, y0: number, z0: number, s: number) {
  const [x1, y1, z1] = [x0 + s, y0 + s, z0 + s];
  const quad = (a: number[], b: number[], c: number[], d: number[]) =>
    ({ positions: [...a, ...b, ...c, ...d], indices: [0, 1, 2, 0, 2, 3] });
  return [
    quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]),
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]),
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]),
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]),
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]),
  ];
}

const body = (id: string, color: string | null, meshes = box(0, 0, 0, 10)): ThreeMfBody =>
  ({ id, name: id.toUpperCase(), color, meshes });

describe('groupObjects (REQ 1042, 1045)', () => {
  it('one object per body group (exported members, body order), one per ungrouped body', () => {
    const groups = [{ name: 'Kit', bodyIds: ['d', 'a', 'zz'] }, { name: 'Unused', bodyIds: ['q'] }];
    expect(groupObjects(['a', 'b', 'c', 'd'], groups)).toEqual({
      objects: [['a', 'd'], ['b'], ['c']],
      names: ['Kit', undefined, undefined],
    });
  });

  it('ignores contact: ungrouped bodies always export separately', () => {
    expect(groupObjects(['a', 'b'], [])).toEqual({ objects: [['a'], ['b']], names: [undefined, undefined] });
  });
});

describe('weldMeshes', () => {
  it('shares vertices across face meshes so the body is one closed mesh', () => {
    const m = weldMeshes(box(0, 0, 0, 10));
    expect(m.vertices.length / 3).toBe(8);
    expect(m.triangles.length / 3).toBe(12);
  });

  it('drops triangles that collapse after welding', () => {
    const m = weldMeshes([{ positions: [0, 0, 0, 1, 0, 0, 1e-9, 0, 0], indices: [0, 1, 2] }]);
    expect(m.triangles.length).toBe(0);
  });
});

describe('build3mfFiles', () => {
  // Group 1: red base A + white inlay B (touching). Group 2: red C alone.
  const groups = [[body('a', 'ff0000'), body('b', 'FFFFFF', box(2, 2, 8, 4))], [body('c', 'ff0000', box(40, 0, 5, 10))]];
  const files = build3mfFiles(groups);
  const model = files['3D/3dmodel.model'];

  it('writes the OPC package parts', () => {
    expect(Object.keys(files).sort()).toEqual([
      '3D/3dmodel.model', 'Metadata/model_settings.config', 'Metadata/project_settings.config',
      '[Content_Types].xml', '_rels/.rels',
    ]);
    expect(files['_rels/.rels']).toContain('Target="/3D/3dmodel.model"');
  });

  it('one object per group, one component per body, one build item per group', () => {
    expect(model).toContain('unit="millimeter"');
    expect(model.match(/<object [^>]*type="model"/g)).toHaveLength(5);
    expect(model.match(/<mesh>/g)).toHaveLength(3);
    expect(model.match(/<components>/g)).toHaveLength(2);
    expect(model.match(/<component objectid=/g)).toHaveLength(3);
    expect(model.match(/<item objectid=/g)).toHaveLength(2);
  });

  it('records body colors as base materials', () => {
    expect(model).toContain('<base name="A" displaycolor="#FF0000FF"/>');
    expect(model).toContain('<base name="B" displaycolor="#FFFFFFFF"/>');
  });

  it('assigns one filament slot per distinct color', () => {
    const cfg = files['Metadata/model_settings.config'];
    expect(cfg.match(/<object id=/g)).toHaveLength(2);
    const parts = [...cfg.matchAll(/<part id="(\d+)"[\s\S]*?key="name" value="([^"]+)"[\s\S]*?key="extruder" value="(\d+)"/g)]
      .map(m => [m[2], m[3]]);
    expect(parts).toEqual([['A', '1'], ['B', '2'], ['C', '1']]);
    expect(JSON.parse(files['Metadata/project_settings.config']).filament_colour).toEqual(['#FF0000', '#FFFFFF']);
  });

  it('gives uncolored bodies the default color', () => {
    const f = build3mfFiles([[body('a', null)]]);
    expect(JSON.parse(f['Metadata/project_settings.config']).filament_colour).toEqual(['#8AA0C4']);
  });

  it('places every group on the bed (min z = 0) without moving parts within it', () => {
    const items = [...model.matchAll(/<item objectid="\d+" transform="([^"]+)"/g)].map(m => m[1].split(' ').map(Number));
    // Group 1 already sits at z=0; group 2 starts at z=5 → dropped by 5.
    expect(items[0][11]).toBeCloseTo(0);
    expect(items[1][11]).toBeCloseTo(-5);
    // Groups side by side, not overlapping in X.
    expect(items[1][9]).not.toBeCloseTo(items[0][9]);
    expect(model).not.toMatch(/<component [^>]*transform=/);
  });

  it('names an object after its body group when given', () => {
    const f = build3mfFiles([[body('a', null), body('b', null)], [body('c', null)]], ['Kit', undefined]);
    expect(f['3D/3dmodel.model']).toContain('name="Kit" type="model"><components>');
    expect(f['3D/3dmodel.model']).toContain('name="C" type="model"><components>');
    expect(f['Metadata/model_settings.config']).toContain('<metadata key="name" value="Kit"/>');
  });

  it('escapes names', () => {
    const f = build3mfFiles([[{ ...body('a', null), name: 'A & "B" <1>' }]]);
    expect(f['3D/3dmodel.model']).toContain('A &amp; &quot;B&quot; &lt;1&gt;');
  });
});

describe('build3mf', () => {
  it('zips the package', async () => {
    const blob = await build3mf([[body('a', 'ff0000')]]);
    const zip = await JSZip.loadAsync(blob);
    expect(Object.keys(zip.files)).toContain('3D/3dmodel.model');
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('3dmanufacturing-3dmodel+xml');
  });
});
