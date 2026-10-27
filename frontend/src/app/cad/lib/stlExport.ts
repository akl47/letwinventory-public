// Binary STL export. The CAD bodies are already tessellated on the frontend
// (per-face positions + indices, in millimetres), so STL export is a pure
// client-side serialize — no kernel round-trip. Binary STL is the de-facto
// format for 3D printing; mm is the conventional unit (STL itself is unitless).

export interface StlMesh {
  positions: ArrayLike<number>;  // flat [x,y,z, x,y,z, ...]
  indices: ArrayLike<number>;    // triangle vertex indices into positions/3
}

/** Serialize triangle meshes to a binary STL ArrayBuffer. Per-facet normals are
 * derived from the triangle winding (right-hand rule), matching how the kernel
 * orients outward-facing faces. Degenerate (zero-area) triangles are skipped. */
export function buildBinaryStl(meshes: StlMesh[]): ArrayBuffer {
  // Count valid triangles first so we can size the buffer exactly.
  let triCount = 0;
  for (const m of meshes) triCount += Math.floor(m.indices.length / 3);

  const HEADER = 80;
  const buf = new ArrayBuffer(HEADER + 4 + triCount * 50);
  const view = new DataView(buf);
  // Header (80 bytes) — leave a short ASCII tag; must NOT start with "solid".
  const tag = 'Letwinventory CAD binary STL';
  for (let i = 0; i < tag.length && i < HEADER; i++) view.setUint8(i, tag.charCodeAt(i));

  let written = 0;
  let offset = HEADER + 4;  // triangle count written at the end (final tally)
  for (const m of meshes) {
    const p = m.positions, idx = m.indices;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
      const ax = p[i0], ay = p[i0 + 1], az = p[i0 + 2];
      const bx = p[i1], by = p[i1 + 1], bz = p[i1 + 2];
      const cx = p[i2], cy = p[i2 + 1], cz = p[i2 + 2];
      // Normal = (b-a) × (c-a), normalized.
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-12) continue;  // degenerate triangle — skip
      nx /= len; ny /= len; nz /= len;
      view.setFloat32(offset, nx, true); offset += 4;
      view.setFloat32(offset, ny, true); offset += 4;
      view.setFloat32(offset, nz, true); offset += 4;
      view.setFloat32(offset, ax, true); offset += 4;
      view.setFloat32(offset, ay, true); offset += 4;
      view.setFloat32(offset, az, true); offset += 4;
      view.setFloat32(offset, bx, true); offset += 4;
      view.setFloat32(offset, by, true); offset += 4;
      view.setFloat32(offset, bz, true); offset += 4;
      view.setFloat32(offset, cx, true); offset += 4;
      view.setFloat32(offset, cy, true); offset += 4;
      view.setFloat32(offset, cz, true); offset += 4;
      view.setUint16(offset, 0, true); offset += 2;  // attribute byte count
      written++;
    }
  }
  view.setUint32(HEADER, written, true);
  // If degenerate triangles were skipped, `written` < triCount and the tail of
  // the buffer is unused zeros — trim so the file's triangle count matches.
  return written === triCount ? buf : buf.slice(0, HEADER + 4 + written * 50);
}
