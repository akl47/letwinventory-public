'use strict';

// Render a commit's tessellated geometry to a static isometric, flat-shaded SVG
// thumbnail using a painter's algorithm. Pure string output — no canvas / raster
// library. Mirrors the client `cad-mini-preview` render so backfilled thumbnails
// match the look of the live ones. Input `geo` is the shape returned by
// cadRegenService.regenerateModel / cadDiffService.regenCommitGeometry:
//   { features: [{ faces: [{ positions, normals, indices }] }] }.

function renderGeometrySvg(geo, w = 240, h = 180) {
  const tris = [];
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const f of (geo && geo.features) || []) {
    for (const face of f.faces || []) {
      const pos = face.positions || [], idx = face.indices || [], nrm = face.normals || [];
      const vert = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2];
        const a = vert(ia), b = vert(ib), c = vert(ic);
        for (const v of [a, b, c]) for (let k = 0; k < 3; k++) { if (v[k] < min[k]) min[k] = v[k]; if (v[k] > max[k]) max[k] = v[k]; }
        let n = [0, 0, 0];
        if (nrm.length >= (Math.max(ia, ib, ic) + 1) * 3) {
          for (const ii of [ia, ib, ic]) for (let k = 0; k < 3; k++) n[k] += nrm[ii * 3 + k];
        } else {
          const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], wv = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          n = [u[1] * wv[2] - u[2] * wv[1], u[2] * wv[0] - u[0] * wv[2], u[0] * wv[1] - u[1] * wv[0]];
        }
        const len = Math.hypot(n[0], n[1], n[2]) || 1;
        tris.push({ v: [a, b, c], n: [n[0] / len, n[1] / len, n[2] / len] });
      }
    }
  }
  if (!tris.length) return null;

  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  // Isometric-ish view: yaw about Y then pitch about X (look down at the part).
  const yaw = Math.PI / 5, pitch = -Math.PI / 7;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const rot = (p) => {
    const x = p[0] - center[0], y = p[1] - center[1], z = p[2] - center[2];
    const rx = x * cy + z * sy, rz = -x * sy + z * cy;
    return [rx, y * cp - rz * sp, y * sp + rz * cp];
  };
  const scale = (Math.min(w, h) * 0.82) / size;
  const proj = (p) => { const r = rot(p); return [w / 2 + r[0] * scale, h / 2 - r[1] * scale, r[2]]; };

  const ptris = tris.map((tr) => {
    const pp = tr.v.map(proj);
    return { pp, n: tr.n, depth: (pp[0][2] + pp[1][2] + pp[2][2]) / 3 };
  }).sort((a, b) => a.depth - b.depth); // far → near (painter's)

  const L = (() => { const l = [0.45, 0.75, 0.5]; const m = Math.hypot(l[0], l[1], l[2]); return [l[0] / m, l[1] / m, l[2] / m]; })();
  let polys = '';
  for (const tr of ptris) {
    const d = Math.max(0.18, Math.abs(tr.n[0] * L[0] + tr.n[1] * L[1] + tr.n[2] * L[2]));
    const s = Math.round(64 + d * 150);
    const pts = tr.pp.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    polys += `<polygon points="${pts}" fill="rgb(${s - 6},${s + 4},${s + 22})" stroke="rgba(15,15,25,0.45)" stroke-width="0.4"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#1c1c2a"/>${polys}</svg>`;
}

module.exports = { renderGeometrySvg };
