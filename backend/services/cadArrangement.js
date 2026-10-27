// Server-side port of `frontend/src/app/cad/lib/arrangement.ts` (+ the
// `geometry.ts` helpers it depends on). KEEP IN SYNC with the frontend — the
// extrude region picker stores indices into the region list this produces, so
// the backend MUST extract the same regions in the same order as the frontend
// or the wrong regions get extruded.
//
// `splitAtIntersections` cuts every non-construction curve at every crossing
// (introducing intersection points); `extractArrangementFaces` then DCEL
// face-walks the result to enumerate bounded regions.

const EPS = 1e-9;
// Spatial-bucket tolerance for deduping intersection points / recognising a new
// intersection coincident with an existing endpoint.
const POINT_TOL = 1e-4;

function findPoint(state, id) {
  for (const e of state.entities) if (e.id === id && e.kind === 'point') return e;
  return null;
}

// ───────── geometry.ts helpers (ported) ─────────────────────────────────────

function lineLineIntersection(a1, a2, b1, b2) {
  const r = { x: a2.x - a1.x, y: a2.y - a1.y };
  const s = { x: b2.x - b1.x, y: b2.y - b1.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < EPS) return null;
  const dx = b1.x - a1.x, dy = b1.y - a1.y;
  const t1 = (dx * s.y - dy * s.x) / denom;
  const t2 = (dx * r.y - dy * r.x) / denom;
  return { p: { x: a1.x + t1 * r.x, y: a1.y + t1 * r.y }, t1, t2 };
}

function lineCircleIntersection(a1, a2, center, radius) {
  const dx = a2.x - a1.x, dy = a2.y - a1.y;
  const fx = a1.x - center.x, fy = a1.y - center.y;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || A < EPS) return [];
  const sq = Math.sqrt(disc);
  const t1 = (-B - sq) / (2 * A);
  const t2 = (-B + sq) / (2 * A);
  const pts = [{ x: a1.x + t1 * dx, y: a1.y + t1 * dy }];
  if (Math.abs(t2 - t1) > EPS) pts.push({ x: a1.x + t2 * dx, y: a1.y + t2 * dy });
  return pts;
}

function circleCircleIntersection(c1, r1, c2, r2) {
  const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  if (d < EPS || d > r1 + r2 + EPS || d + EPS < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  if (h2 < -EPS) return [];
  const h = Math.sqrt(Math.max(0, h2));
  const mx = c1.x + a * (c2.x - c1.x) / d;
  const my = c1.y + a * (c2.y - c1.y) / d;
  const rx = -(c2.y - c1.y) * (h / d);
  const ry = (c2.x - c1.x) * (h / d);
  if (h < EPS) return [{ x: mx, y: my }];
  return [{ x: mx + rx, y: my + ry }, { x: mx - rx, y: my - ry }];
}

function angleInArcSweep(pointAngle, startAngle, endAngle, ccw) {
  const TAU = Math.PI * 2;
  const norm = (a) => { const m = a % TAU; return m < 0 ? m + TAU : m; };
  if (ccw) {
    const sweep = norm(endAngle - startAngle);
    const off = norm(pointAngle - startAngle);
    return off <= sweep + EPS;
  }
  const sweep = norm(startAngle - endAngle);
  const off = norm(startAngle - pointAngle);
  return off <= sweep + EPS;
}

// ───────── splitAtIntersections ─────────────────────────────────────────────

function splitAtIntersections(state) {
  state = canonicalizePoints(state);
  const curves = gatherCurves(state);

  const KEY_RES = Math.round(1 / POINT_TOL);
  const keyFor = (p) => `${Math.round(p.x * KEY_RES)}/${Math.round(p.y * KEY_RES)}`;
  const pointMap = new Map();
  for (const e of state.entities) {
    if (e.kind === 'point') pointMap.set(keyFor(e), e.id);
  }

  const newPoints = [];
  let pointSeq = 1;
  const acquirePoint = (p) => {
    const k = keyFor(p);
    const existing = pointMap.get(k);
    if (existing) return existing;
    const id = `arr_pt_${pointSeq++}`;
    pointMap.set(k, id);
    newPoints.push({ kind: 'point', id, x: p.x, y: p.y });
    return id;
  };

  const hits = new Map();
  for (const c of curves) hits.set(c.id, []);

  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const a = curves[i], b = curves[j];
      const pts = intersectCurves(a, b);
      for (const p of pts) {
        if (!isInteriorHit(a, p) || !isInteriorHit(b, p)) continue;
        const pid = acquirePoint(p);
        hits.get(a.id).push({ pointId: pid, param: paramOnCurve(a, p) });
        hits.get(b.id).push({ pointId: pid, param: paramOnCurve(b, p) });
      }
    }
  }

  // Vertex-on-curve (T-junction) splits. A planar arrangement must also split
  // a curve wherever another edge's ENDPOINT lands on its interior — not only
  // at curve↔curve crossings. Otherwise a face boundary that both traces the
  // curve AND has a vertex sitting on it is pinched (self-touching), which
  // OCCT BRepMesh rejects. Real case: a rectangle corner constrained
  // coincident onto an arc. We reuse the curve's EXISTING endpoint id (no new
  // arr_pt_), so the split piece shares the vertex and the graph is connected.
  const vertexIds = new Set();
  for (const c of curves) {
    if (c.kind === 'line' || c.kind === 'arc') { vertexIds.add(c.startId); vertexIds.add(c.endId); }
  }
  for (const c of curves) {
    const ownIds = c.kind === 'circle' ? new Set() : new Set([c.startId, c.endId]);
    for (const vid of vertexIds) {
      if (ownIds.has(vid)) continue;
      const v = findPoint(state, vid);
      if (!v || !pointLiesOnCurveInterior(c, v)) continue;
      hits.get(c.id).push({ pointId: vid, param: paramOnCurve(c, v) });
    }
  }

  const out = [];
  for (const e of state.entities) if (e.kind === 'point') out.push(e);
  for (const np of newPoints) out.push(np);
  for (const e of state.entities) {
    if (e.kind === 'point') continue;
    if (e.construction) out.push(e);
  }

  let entSeq = 1;
  const origById = new Map(state.entities.map(e => [e.id, e]));

  for (const c of curves) {
    const h = hits.get(c.id);
    if (h.length === 0) {
      const orig = origById.get(c.id);
      if (orig) out.push(orig);
      continue;
    }

    if (c.kind === 'line') {
      h.sort((x, y) => x.param - y.param);
      let prev = c.startId;
      for (const hit of h) {
        if (hit.pointId === prev) continue;
        out.push({ kind: 'line', id: `arr_ln_${entSeq++}`, startId: prev, endId: hit.pointId });
        prev = hit.pointId;
      }
      if (prev !== c.endId) {
        out.push({ kind: 'line', id: `arr_ln_${entSeq++}`, startId: prev, endId: c.endId });
      }
    } else if (c.kind === 'circle') {
      const uniqueByPoint = new Map();
      for (const hit of h) uniqueByPoint.set(hit.pointId, hit);
      const uniq = [...uniqueByPoint.values()].sort((a, b) => a.param - b.param);
      if (uniq.length < 2) {
        const orig = origById.get(c.id);
        if (orig) out.push(orig);
        continue;
      }
      for (let k = 0; k < uniq.length; k++) {
        const aHit = uniq[k];
        const bHit = uniq[(k + 1) % uniq.length];
        out.push({
          kind: 'arc',
          id: `arr_ar_${entSeq++}`,
          centerId: c.centerId,
          startId: aHit.pointId,
          endId: bHit.pointId,
          radius: c.radius,
          ccw: true,
        });
      }
    } else {
      const alongSweep = (angle) => {
        const TAU = Math.PI * 2;
        const norm = (a) => { const m = a % TAU; return m < 0 ? m + TAU : m; };
        return c.ccw ? norm(angle - c.startAngle) : norm(c.startAngle - angle);
      };
      const sorted = h
        .filter(hit => hit.pointId !== c.startId && hit.pointId !== c.endId)
        .sort((x, y) => alongSweep(x.param) - alongSweep(y.param));
      const dedup = [];
      for (const hit of sorted) {
        if (dedup.length > 0 && dedup[dedup.length - 1].pointId === hit.pointId) continue;
        dedup.push(hit);
      }
      let prev = c.startId;
      for (const hit of dedup) {
        out.push({
          kind: 'arc',
          id: `arr_ar_${entSeq++}`,
          centerId: c.centerId,
          startId: prev,
          endId: hit.pointId,
          radius: c.radius,
          ccw: c.ccw,
        });
        prev = hit.pointId;
      }
      if (prev !== c.endId) {
        out.push({
          kind: 'arc',
          id: `arr_ar_${entSeq++}`,
          centerId: c.centerId,
          startId: prev,
          endId: c.endId,
          radius: c.radius,
          ccw: c.ccw,
        });
      }
    }
  }

  return { entities: out, constraints: [] };
}

function canonicalizePoints(state, spatialTol = 1e-4) {
  const parent = new Map();
  const find = (id) => {
    let p = parent.get(id) ?? id;
    while (parent.has(p) && parent.get(p) !== p) p = parent.get(p);
    parent.set(id, p);
    return p;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  const pointIds = new Set();
  for (const e of state.entities) {
    if (e.kind === 'point') { parent.set(e.id, e.id); pointIds.add(e.id); }
  }

  for (const c of state.constraints) {
    if (c.type !== 'coincident' || c.targets.length !== 2) continue;
    const a = c.targets[0] && c.targets[0].entityId;
    const b = c.targets[1] && c.targets[1].entityId;
    if (a && b && pointIds.has(a) && pointIds.has(b)) union(a, b);
  }

  const KEY = Math.round(1 / spatialTol);
  const bucketRep = new Map();
  for (const e of state.entities) {
    if (e.kind !== 'point') continue;
    const key = `${Math.round(e.x * KEY)}/${Math.round(e.y * KEY)}`;
    const existing = bucketRep.get(key);
    if (existing) union(existing, e.id);
    else bucketRep.set(key, e.id);
  }

  let anyMerged = false;
  for (const id of pointIds) {
    if (find(id) !== id) { anyMerged = true; break; }
  }
  if (!anyMerged) return state;

  const rewrite = (id) => pointIds.has(id) ? find(id) : id;
  const rewritten = state.entities.map(e => {
    if (e.kind === 'line') return { ...e, startId: rewrite(e.startId), endId: rewrite(e.endId) };
    if (e.kind === 'circle') return { ...e, centerId: rewrite(e.centerId) };
    if (e.kind === 'arc') return { ...e, centerId: rewrite(e.centerId), startId: rewrite(e.startId), endId: rewrite(e.endId) };
    return e;
  });
  return { entities: rewritten, constraints: state.constraints };
}

function gatherCurves(state) {
  const out = [];
  for (const e of state.entities) {
    if (e.kind === 'point' || e.construction) continue;
    if (e.kind === 'line') {
      const a = findPoint(state, e.startId);
      const b = findPoint(state, e.endId);
      if (a && b) out.push({ kind: 'line', id: e.id, startId: e.startId, endId: e.endId, a, b });
    } else if (e.kind === 'circle') {
      const ce = findPoint(state, e.centerId);
      if (ce) out.push({ kind: 'circle', id: e.id, centerId: e.centerId, center: ce, radius: e.radius });
    } else if (e.kind === 'arc') {
      const ce = findPoint(state, e.centerId);
      const sp = findPoint(state, e.startId);
      const fp = findPoint(state, e.endId);
      if (ce && sp && fp) {
        out.push({
          kind: 'arc', id: e.id, centerId: e.centerId,
          startId: e.startId, endId: e.endId,
          center: ce, startPt: sp, endPt: fp,
          radius: e.radius, ccw: e.ccw,
          startAngle: Math.atan2(sp.y - ce.y, sp.x - ce.x),
          endAngle: Math.atan2(fp.y - ce.y, fp.x - ce.x),
        });
      }
    }
  }
  return out;
}

function intersectCurves(a, b) {
  if (a.kind === 'line' && b.kind === 'line') {
    const r = lineLineIntersection(a.a, a.b, b.a, b.b);
    if (!r) return [];
    if (r.t1 > -EPS && r.t1 < 1 + EPS && r.t2 > -EPS && r.t2 < 1 + EPS) return [r.p];
    return [];
  }
  if (a.kind === 'line' && b.kind !== 'line') {
    return lineCircleIntersection(a.a, a.b, b.center, b.radius).filter(p => {
      const dx = a.b.x - a.a.x, dy = a.b.y - a.a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < EPS) return false;
      const t = ((p.x - a.a.x) * dx + (p.y - a.a.y) * dy) / len2;
      if (t < -EPS || t > 1 + EPS) return false;
      if (b.kind === 'arc') {
        const angle = Math.atan2(p.y - b.center.y, p.x - b.center.x);
        return angleInArcSweep(angle, b.startAngle, b.endAngle, b.ccw);
      }
      return true;
    });
  }
  if (a.kind !== 'line' && b.kind === 'line') return intersectCurves(b, a);
  if (a.kind === 'line' || b.kind === 'line') return [];
  const ca = a, cb = b;
  return circleCircleIntersection(ca.center, ca.radius, cb.center, cb.radius).filter(p => {
    if (ca.kind === 'arc') {
      const angle = Math.atan2(p.y - ca.center.y, p.x - ca.center.x);
      if (!angleInArcSweep(angle, ca.startAngle, ca.endAngle, ca.ccw)) return false;
    }
    if (cb.kind === 'arc') {
      const angle = Math.atan2(p.y - cb.center.y, p.x - cb.center.x);
      if (!angleInArcSweep(angle, cb.startAngle, cb.endAngle, cb.ccw)) return false;
    }
    return true;
  });
}

function paramOnCurve(c, p) {
  if (c.kind === 'line') {
    const dx = c.b.x - c.a.x, dy = c.b.y - c.a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) return 0;
    return ((p.x - c.a.x) * dx + (p.y - c.a.y) * dy) / len2;
  }
  return Math.atan2(p.y - c.center.y, p.x - c.center.x);
}

// True iff vertex `v` lies ON curve `c`'s interior (not at an endpoint).
// Used for T-junction splitting. Unlike isInteriorHit (which assumes the
// point is already on the curve and only checks parametric interior-ness),
// this verifies the point is GEOMETRICALLY on the curve first.
function pointLiesOnCurveInterior(c, v) {
  if (c.kind === 'line') {
    const dx = c.b.x - c.a.x, dy = c.b.y - c.a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) return false;
    const t = ((v.x - c.a.x) * dx + (v.y - c.a.y) * dy) / len2;
    if (t <= EPS || t >= 1 - EPS) return false;
    const px = c.a.x + t * dx, py = c.a.y + t * dy;
    return Math.hypot(v.x - px, v.y - py) < POINT_TOL * 10;
  }
  const dr = Math.abs(Math.hypot(v.x - c.center.x, v.y - c.center.y) - c.radius);
  if (dr >= POINT_TOL * 10) return false;
  if (c.kind === 'arc') {
    const ang = Math.atan2(v.y - c.center.y, v.x - c.center.x);
    if (!angleInArcSweep(ang, c.startAngle, c.endAngle, c.ccw)) return false;
    if (Math.hypot(v.x - c.startPt.x, v.y - c.startPt.y) < POINT_TOL) return false;
    if (Math.hypot(v.x - c.endPt.x, v.y - c.endPt.y) < POINT_TOL) return false;
  }
  return true;
}

function isInteriorHit(c, p) {
  if (c.kind === 'line') {
    const t = paramOnCurve(c, p);
    return t > EPS && t < 1 - EPS;
  }
  if (c.kind === 'circle') {
    return Math.abs(Math.hypot(p.x - c.center.x, p.y - c.center.y) - c.radius) < POINT_TOL * 10;
  }
  const a = paramOnCurve(c, p);
  if (!angleInArcSweep(a, c.startAngle, c.endAngle, c.ccw)) return false;
  if (Math.hypot(p.x - c.startPt.x, p.y - c.startPt.y) < POINT_TOL) return false;
  if (Math.hypot(p.x - c.endPt.x, p.y - c.endPt.y) < POINT_TOL) return false;
  return true;
}

// ───────── DCEL face walker ─────────────────────────────────────────────────

function buildHalfEdges(state) {
  const edges = [];
  let id = 1;
  for (const e of state.entities) {
    if (e.kind === 'point' || e.construction) continue;
    if (e.kind === 'line') {
      const a = findPoint(state, e.startId);
      const b = findPoint(state, e.endId);
      if (!a || !b) continue;
      const fwd = {
        id: `he_${id++}`, fromId: e.startId, toId: e.endId,
        twinId: '', kind: 'line', from: a, to: b,
        exitAngle: Math.atan2(b.y - a.y, b.x - a.x),
      };
      const bwd = {
        id: `he_${id++}`, fromId: e.endId, toId: e.startId,
        twinId: '', kind: 'line', from: b, to: a,
        exitAngle: Math.atan2(a.y - b.y, a.x - b.x),
      };
      fwd.twinId = bwd.id;
      bwd.twinId = fwd.id;
      edges.push(fwd, bwd);
    } else if (e.kind === 'arc') {
      const c = findPoint(state, e.centerId);
      const a = findPoint(state, e.startId);
      const b = findPoint(state, e.endId);
      if (!c || !a || !b) continue;
      const startAngle = Math.atan2(a.y - c.y, a.x - c.x);
      const endAngle = Math.atan2(b.y - c.y, b.x - c.x);
      const fwdTangent = e.ccw
        ? Math.atan2(Math.cos(startAngle), -Math.sin(startAngle))
        : Math.atan2(-Math.cos(startAngle), Math.sin(startAngle));
      const bwdTangent = e.ccw
        ? Math.atan2(-Math.cos(endAngle), Math.sin(endAngle))
        : Math.atan2(Math.cos(endAngle), -Math.sin(endAngle));
      const fwd = {
        id: `he_${id++}`, fromId: e.startId, toId: e.endId,
        twinId: '', kind: 'arc',
        arcCenter: c, arcRadius: e.radius, arcCcw: e.ccw,
        arcStartAngle: startAngle, arcEndAngle: endAngle,
        exitAngle: fwdTangent,
      };
      const bwd = {
        id: `he_${id++}`, fromId: e.endId, toId: e.startId,
        twinId: '', kind: 'arc',
        arcCenter: c, arcRadius: e.radius, arcCcw: !e.ccw,
        arcStartAngle: endAngle, arcEndAngle: startAngle,
        exitAngle: bwdTangent,
      };
      fwd.twinId = bwd.id;
      bwd.twinId = fwd.id;
      edges.push(fwd, bwd);
    }
  }
  return edges;
}

function extractArrangementFaces(state) {
  const edges = buildHalfEdges(state);
  if (edges.length === 0) return [];
  const edgeById = new Map(edges.map(e => [e.id, e]));

  const outgoing = new Map();
  for (const e of edges) {
    let arr = outgoing.get(e.fromId);
    if (!arr) { arr = []; outgoing.set(e.fromId, arr); }
    arr.push(e);
  }
  for (const arr of outgoing.values()) arr.sort((a, b) => a.exitAngle - b.exitAngle);
  const indexInRing = new Map();
  for (const arr of outgoing.values()) arr.forEach((e, i) => indexInRing.set(e.id, i));

  const nextOf = (e) => {
    const twin = edgeById.get(e.twinId);
    const ring = outgoing.get(twin.fromId);
    const idx = indexInRing.get(twin.id);
    const N = ring.length;
    return ring[(idx - 1 + N) % N];
  };

  const visited = new Set();
  const faces = [];
  for (const start of edges) {
    if (visited.has(start.id)) continue;
    const cycle = [];
    let curr = start;
    let guard = edges.length + 2;
    while (guard-- > 0) {
      if (visited.has(curr.id)) break;
      visited.add(curr.id);
      cycle.push(curr);
      const nxt = nextOf(curr);
      if (nxt.id === start.id) break;
      curr = nxt;
    }
    if (cycle.length === 0) continue;
    faces.push({ edges: cycle, signedArea: computeSignedArea(cycle) });
  }
  return faces;
}

function computeSignedArea(edges) {
  const pts = [];
  const TAU = Math.PI * 2;
  const norm = (a) => { const m = a % TAU; return m < 0 ? m + TAU : m; };
  for (const e of edges) {
    if (e.kind === 'line' && e.from) {
      pts.push(e.from);
    } else if (e.kind === 'arc' && e.arcCenter && e.arcRadius !== undefined
               && e.arcStartAngle !== undefined && e.arcEndAngle !== undefined
               && e.arcCcw !== undefined) {
      const N = 24;
      const sweep = e.arcCcw
        ? norm(e.arcEndAngle - e.arcStartAngle)
        : -norm(e.arcStartAngle - e.arcEndAngle);
      for (let i = 0; i < N; i++) {
        const t = i / N;
        const angle = e.arcStartAngle + sweep * t;
        pts.push({
          x: e.arcCenter.x + e.arcRadius * Math.cos(angle),
          y: e.arcCenter.y + e.arcRadius * Math.sin(angle),
        });
      }
    }
  }
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return area / 2;
}

// Merge a set of arrangement faces into their combined boundary loop(s).
// A half-edge whose TWIN also belongs to a selected face is an INTERNAL edge
// shared between two selected regions — drop it. The surviving half-edges
// (the outer boundary of the union, plus any enclosed-hole boundaries) are
// chained head-to-tail (fromId → toId) into closed loops. Each selected face
// keeps the interior on its left, so the chained survivors trace the merged
// region's boundary with consistent orientation, ready for faceToProfileLoop.
//
// Assumes the union is manifold (each boundary vertex has one in/one out
// boundary half-edge) — true for unions of arrangement tiles after the
// vertex-on-curve split. A self-touching union would need angle-based
// next-edge selection; not handled here.
function mergeFaces(faces) {
  const selected = new Set();
  for (const f of faces) for (const e of f.edges) selected.add(e.id);
  const boundary = [];
  for (const f of faces) for (const e of f.edges) {
    if (!selected.has(e.twinId)) boundary.push(e);
  }
  const byFrom = new Map();
  for (const e of boundary) {
    let arr = byFrom.get(e.fromId);
    if (!arr) { arr = []; byFrom.set(e.fromId, arr); }
    arr.push(e);
  }
  const used = new Set();
  const loops = [];
  for (const start of boundary) {
    if (used.has(start.id)) continue;
    const cycle = [];
    let cur = start;
    let guard = boundary.length + 2;
    while (cur && !used.has(cur.id) && guard-- > 0) {
      used.add(cur.id);
      cycle.push(cur);
      const nexts = (byFrom.get(cur.toId) || []).filter(e => !used.has(e.id));
      cur = nexts[0] || null;
    }
    if (cycle.length > 0) loops.push({ edges: cycle });
  }
  return loops;
}

module.exports = { splitAtIntersections, extractArrangementFaces, buildHalfEdges, mergeFaces };
