/**
 * OCCT-backed CAD kernel adapter. Wraps opencascade.js v2-beta in a minimal
 * KernelAdapter surface so the rest of the codebase doesn't see OCCT types.
 *
 * Typed as `any` for the OCCT module — v2-beta's auto-generated `.d.ts` files
 * don't cross-import correctly (e.g., `MakeBox.Shape()` resolves through a
 * different module's typing). Treat the WASM bindings as duck-typed JS.
 *
 * Method overload suffixes (_1, _2, _3) come from
 * `node_modules/opencascade.js/dist/module.TK*.wasm.d.ts`. Don't guess from
 * the C++ docs.
 */
import type { KernelAdapter } from './featureTree';
import type { FaceMesh, ModelTopology, Plane3 } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OC = any;

function vecToTuple(v: any): [number, number, number] {
  return [v.X(), v.Y(), v.Z()];
}

function buildProfileWire(oc: OC, profile2D: Array<{ x: number; y: number }>, plane: Plane3): any {
  // Build a closed wire in 3D from the 2D profile points, lifted onto the plane.
  const polygon = new oc.BRepBuilderAPI_MakePolygon_1();
  for (const p of profile2D) {
    const x3 = plane.origin[0] + plane.xAxis[0] * p.x + plane.yAxis[0] * p.y;
    const y3 = plane.origin[1] + plane.xAxis[1] * p.x + plane.yAxis[1] * p.y;
    const z3 = plane.origin[2] + plane.xAxis[2] * p.x + plane.yAxis[2] * p.y;
    polygon.Add_1(new oc.gp_Pnt_3(x3, y3, z3));
  }
  polygon.Close();
  return polygon.Wire();
}

function makeFaceFromWire(oc: OC, wire: any): any {
  // BRepBuilderAPI_MakeFace_15 takes a wire + onlyPlane flag.
  return new oc.BRepBuilderAPI_MakeFace_15(wire, true).Face();
}

function extrudeShape(oc: OC, face: any, plane: Plane3, distance: number): any {
  const dir = new oc.gp_Vec_4(
    plane.normal[0] * distance,
    plane.normal[1] * distance,
    plane.normal[2] * distance,
  );
  return new oc.BRepPrimAPI_MakePrism_1(face, dir, false, true).Shape();
}

function tessellateShape(oc: OC, shape: any, faceIdPrefix: string): {
  faces: FaceMesh[]; topology: ModelTopology;
} {
  // Mesh the shape.
  new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);

  const faces: FaceMesh[] = [];
  const topology: ModelTopology = { vertices: [], edges: [] };

  // Iterate faces.
  const faceExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  let faceIndex = 0;
  while (faceExplorer.More()) {
    const face = oc.TopoDS.Face_1(faceExplorer.Current());
    const location = new oc.TopLoc_Location_1();
    const triHandle = oc.BRep_Tool.Triangulation(face, location);
    if (!triHandle.IsNull()) {
      const tri = triHandle.get();
      const xform = location.Transformation();
      const reversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;

      const nbNodes = tri.NbNodes();
      const positions = new Float32Array(nbNodes * 3);
      const normalsArr = new Float32Array(nbNodes * 3);
      for (let i = 1; i <= nbNodes; i++) {
        const node = tri.Node(i).Transformed(xform);
        const off = (i - 1) * 3;
        positions[off] = node.X();
        positions[off + 1] = node.Y();
        positions[off + 2] = node.Z();
      }

      const nbTri = tri.NbTriangles();
      const indices = new Uint32Array(nbTri * 3);
      for (let i = 1; i <= nbTri; i++) {
        const t = tri.Triangle(i);
        const a = t.Value(1) - 1;
        const b = t.Value(2) - 1;
        const c = t.Value(3) - 1;
        const off = (i - 1) * 3;
        if (reversed) {
          indices[off] = a; indices[off + 1] = c; indices[off + 2] = b;
        } else {
          indices[off] = a; indices[off + 1] = b; indices[off + 2] = c;
        }
      }

      // Flat normals per triangle, accumulated to vertices.
      for (let i = 0; i < nbTri; i++) {
        const ia = indices[i * 3]; const ib = indices[i * 3 + 1]; const ic = indices[i * 3 + 2];
        const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
        const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
        const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        for (const idx of [ia, ib, ic]) {
          normalsArr[idx * 3] += nx;
          normalsArr[idx * 3 + 1] += ny;
          normalsArr[idx * 3 + 2] += nz;
        }
      }
      // Normalize accumulated normals.
      for (let i = 0; i < nbNodes; i++) {
        const off = i * 3;
        const len = Math.hypot(normalsArr[off], normalsArr[off + 1], normalsArr[off + 2]) || 1;
        normalsArr[off] /= len;
        normalsArr[off + 1] /= len;
        normalsArr[off + 2] /= len;
      }

      faces.push({
        faceId: `${faceIdPrefix}:${faceIndex}`,
        positions,
        normals: normalsArr,
        indices,
      });
    }
    faceIndex++;
    faceExplorer.Next();
  }

  // Iterate vertices and edges for topology (used by sketch reference candidates).
  const vertexExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  const seenVertices = new Set<string>();
  let vertexIndex = 0;
  while (vertexExplorer.More()) {
    const v = oc.TopoDS.Vertex_1(vertexExplorer.Current());
    const pnt = oc.BRep_Tool.Pnt(v);
    const key = `${pnt.X().toFixed(4)},${pnt.Y().toFixed(4)},${pnt.Z().toFixed(4)}`;
    if (!seenVertices.has(key)) {
      seenVertices.add(key);
      topology.vertices.push({
        id: `${faceIdPrefix}:v${vertexIndex++}`,
        position: vecToTuple(pnt),
      });
    }
    vertexExplorer.Next();
  }

  const edgeExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  let edgeIndex = 0;
  while (edgeExplorer.More()) {
    const edge = oc.TopoDS.Edge_1(edgeExplorer.Current());
    // Sample endpoints via the curve.
    try {
      const firstLast = { first: 0, last: 0 };
      const curve = oc.BRep_Tool.Curve_2(edge, firstLast as any);
      if (!curve.IsNull()) {
        const c = curve.get();
        const p1 = c.Value((firstLast as any).first);
        const p2 = c.Value((firstLast as any).last);
        topology.edges.push({
          id: `${faceIdPrefix}:e${edgeIndex}`,
          isStraight: true, // best-effort flag; real check would inspect curve type
          endpoints: [vecToTuple(p1), vecToTuple(p2)],
        });
      }
    } catch {
      // ignore unparseable edges
    }
    edgeIndex++;
    edgeExplorer.Next();
  }

  return { faces, topology };
}

export function makeOccKernel(oc: OC): KernelAdapter {
  return {
    buildOriginGeometry() {
      // The origin feature contributes only datums; the regenerator builds them
      // from the datum module. Return empty topology/faces.
      return {
        datums: [],
        faces: [],
        topology: { vertices: [], edges: [] },
      };
    },
    buildExtrude(profile2D, plane, distance) {
      const wire = buildProfileWire(oc, profile2D, plane);
      const face = makeFaceFromWire(oc, wire);
      const solid = extrudeShape(oc, face, plane, distance);
      // Tag the prefix with a counter so face IDs stay unique within a regen.
      const prefix = `f${Math.floor(Math.random() * 100000)}`;
      return tessellateShape(oc, solid, prefix);
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Pure-JS fallback kernel (used for SSR / unit tests / when WASM hasn't loaded
// yet). Produces a simple prism geometry via ear-clipping cap triangulation
// plus quad sides. Works for any closed polygon, convex or simple concave.
// ───────────────────────────────────────────────────────────────────────────

export function makePureJsKernel(): KernelAdapter {
  return {
    buildOriginGeometry() {
      return { datums: [], faces: [], topology: { vertices: [], edges: [] } };
    },
    buildExtrude(profile2D, plane, distance) {
      const prefix = `pj${Math.floor(Math.random() * 100000)}`;
      return extrudePureJs(profile2D, plane, distance, prefix);
    },
  };
}

function project3(plane: Plane3, x: number, y: number, t: number): [number, number, number] {
  return [
    plane.origin[0] + plane.xAxis[0] * x + plane.yAxis[0] * y + plane.normal[0] * t,
    plane.origin[1] + plane.xAxis[1] * x + plane.yAxis[1] * y + plane.normal[1] * t,
    plane.origin[2] + plane.xAxis[2] * x + plane.yAxis[2] * y + plane.normal[2] * t,
  ];
}

function earClip2D(pts: Array<{ x: number; y: number }>): Array<[number, number, number]> {
  // Returns triangle indices into pts. Robust enough for simple, non-self-intersecting polygons.
  const indices: Array<[number, number, number]> = [];
  const v = pts.map((_, i) => i);
  // Determine orientation; ensure CCW.
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  const ccw = area > 0;
  const list = ccw ? v.slice() : v.slice().reverse();

  function isConvex(prev: number, curr: number, next: number): boolean {
    const a = pts[prev], b = pts[curr], c = pts[next];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return cross > 0;
  }
  function pointInTri(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): boolean {
    const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
    const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
    const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
  }

  let guard = 0;
  while (list.length > 3 && guard++ < list.length * list.length) {
    let earFound = false;
    for (let i = 0; i < list.length; i++) {
      const prev = list[(i - 1 + list.length) % list.length];
      const curr = list[i];
      const next = list[(i + 1) % list.length];
      if (!isConvex(prev, curr, next)) continue;
      let blocked = false;
      for (let j = 0; j < list.length; j++) {
        const idx = list[j];
        if (idx === prev || idx === curr || idx === next) continue;
        if (pointInTri(pts[idx], pts[prev], pts[curr], pts[next])) { blocked = true; break; }
      }
      if (blocked) continue;
      indices.push([prev, curr, next]);
      list.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) break;
  }
  if (list.length === 3) indices.push([list[0], list[1], list[2]]);
  return indices;
}

function extrudePureJs(
  profile2D: Array<{ x: number; y: number }>,
  plane: Plane3,
  distance: number,
  prefix: string,
): { faces: FaceMesh[]; topology: ModelTopology } {
  const n = profile2D.length;
  const faces: FaceMesh[] = [];
  const topology: ModelTopology = { vertices: [], edges: [] };

  // Build vertex grid: 2*n positions (bottom + top).
  const bottom = profile2D.map(p => project3(plane, p.x, p.y, 0));
  const top = profile2D.map(p => project3(plane, p.x, p.y, distance));

  // Topology: vertices + edges (bottom ring, top ring, vertical connectors).
  for (let i = 0; i < n; i++) {
    topology.vertices.push({ id: `${prefix}:vb${i}`, position: bottom[i] });
    topology.vertices.push({ id: `${prefix}:vt${i}`, position: top[i] });
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    topology.edges.push({ id: `${prefix}:eb${i}`, isStraight: true, endpoints: [bottom[i], bottom[j]] });
    topology.edges.push({ id: `${prefix}:et${i}`, isStraight: true, endpoints: [top[i], top[j]] });
    topology.edges.push({ id: `${prefix}:ev${i}`, isStraight: true, endpoints: [bottom[i], top[i]] });
  }

  // Caps via ear-clipping.
  const tris = earClip2D(profile2D);

  // Bottom cap (reverse winding so normal points -normal).
  {
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = bottom[i][0];
      positions[i * 3 + 1] = bottom[i][1];
      positions[i * 3 + 2] = bottom[i][2];
    }
    const indices = new Uint32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
      // Reverse for bottom face.
      indices[i * 3] = tris[i][0];
      indices[i * 3 + 1] = tris[i][2];
      indices[i * 3 + 2] = tris[i][1];
    }
    const normals = computeNormals(positions, indices);
    faces.push({ faceId: `${prefix}:0`, positions, normals, indices });
  }

  // Top cap.
  {
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = top[i][0];
      positions[i * 3 + 1] = top[i][1];
      positions[i * 3 + 2] = top[i][2];
    }
    const indices = new Uint32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
      indices[i * 3] = tris[i][0];
      indices[i * 3 + 1] = tris[i][1];
      indices[i * 3 + 2] = tris[i][2];
    }
    const normals = computeNormals(positions, indices);
    faces.push({ faceId: `${prefix}:1`, positions, normals, indices });
  }

  // Side faces — one quad per profile edge, as its own face.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const positions = new Float32Array(12);
    const verts = [bottom[i], bottom[j], top[j], top[i]];
    for (let k = 0; k < 4; k++) {
      positions[k * 3] = verts[k][0];
      positions[k * 3 + 1] = verts[k][1];
      positions[k * 3 + 2] = verts[k][2];
    }
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const normals = computeNormals(positions, indices);
    faces.push({ faceId: `${prefix}:${2 + i}`, positions, normals, indices });
  }

  return { faces, topology };
}

function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const n = positions.length / 3;
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t]; const ib = indices[t + 1]; const ic = indices[t + 2];
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const idx of [ia, ib, ic]) {
      normals[idx * 3] += nx;
      normals[idx * 3 + 1] += ny;
      normals[idx * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < n; i++) {
    const off = i * 3;
    const len = Math.hypot(normals[off], normals[off + 1], normals[off + 2]) || 1;
    normals[off] /= len;
    normals[off + 1] /= len;
    normals[off + 2] /= len;
  }
  return normals;
}
