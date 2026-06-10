/**
 * Backend re-projection for SolidWorks-style Convert Entities.
 *
 * Sketch entities that were created via the Convert tool carry a
 * `projectedFrom: { featureId, edgeId }` field referencing a body edge.
 * At regen time, that edge's coordinates may have changed (the source
 * feature got edited, its body re-tessellated). We re-resolve each
 * projected entity against the CURRENT topology so downstream features
 * that consume this sketch see live-projected coords, not whatever was
 * persisted on disk.
 *
 * Mirror of the frontend's _reprojectAllSketches effect — same algorithm,
 * different surface (the backend operates on accumulated `bodies` from
 * the running regen, while the frontend reads the unified geometry()
 * signal). Both paths must stay in sync or the editor sees a different
 * sketch than the kernel does.
 */

/** Walk `sketchDoc.sketches[*].state.constraints`, re-projecting every
 * entity targeted by an `on-edge` SketchConstraint (SolidWorks-style
 * Convert Entities link). The constraint carries the source edge id
 * in its `externalRef`. Source topology is built by walking the
 * bodies array (each body has its own scoped topology).
 *
 * Mirror of the frontend's `_reprojectAllSketches`. Keep these two
 * paths in lockstep — if they diverge, the kernel sees a different
 * sketch than the user sees, manifesting as cut extrudes producing
 * wrong geometry and "converted edges randomly jumping" because the
 * frontend re-projects while the backend uses stale coords.
 *
 * Returns a NEW sketchDoc — never mutates the input. Sketches with no
 * on-edge constraints pass through by reference. */
function applyProjectionToSketchDoc(sketchDoc, bodies, opts = {}) {
  if (!sketchDoc || !sketchDoc.sketches) return sketchDoc;
  const debug = opts.debug || process.env.CAD_DEBUG === '1';
  // Build edgeId → { isStraight, endpoints, polyline } index from
  // every body's topology. Edge ids are globally unique after the
  // per-body topology scoping done in cadRegenService.
  const edgeIndex = new Map();
  for (const body of (bodies || [])) {
    const edges = (body.topology && body.topology.edges) || [];
    for (const e of edges) {
      edgeIndex.set(e.id, e);
    }
  }
  // Cross-part in-context references (REQ 770/775): each cross-part on-edge
  // constraint's SOURCE edge — already transformed into THIS part's frame by the
  // resolver (or a cached snapshot) — is supplied via `opts.externalEdges`, keyed
  // by constraint id. They join the edge index under a `cp:<constraintId>` key so
  // the projection below is byte-identical to the intra-part path.
  const externalEdges = _normalizeExternalEdges(opts.externalEdges);
  for (const [cid, geo] of externalEdges) edgeIndex.set(`cp:${cid}`, geo);
  if (edgeIndex.size === 0) return sketchDoc;

  let docChanged = false;
  const nextSketches = {};
  for (const [sid, sketch] of Object.entries(sketchDoc.sketches)) {
    if (!sketch || !sketch.state) { nextSketches[sid] = sketch; continue; }
    // Build [entity, edgeId] pairs from on-edge constraints. Each
    // pair is independent — multiple entities can be linked to the
    // same source edge (rare but possible when point-sharing has
    // unified vertices across converts).
    //
    // Legacy fallback: a doc that hasn't been re-saved after the
    // frontend migration may still carry the OLD `projectedFrom`
    // field on entities. Treat those as on-edge equivalents so the
    // backend keeps working until the doc gets re-saved.
    const entitiesById = new Map((sketch.state.entities || []).map(e => [e.id, e]));
    const projectedPairs = [];
    const seenTargets = new Set();
    for (const c of (sketch.state.constraints || [])) {
      if (c.type !== 'on-edge' || !c.externalRef) continue;
      // Cross-part refs project against the resolver-supplied edge (keyed by
      // constraint id); intra-part refs project against a source body edge by id.
      const key = c.externalRef.scope === 'cross-part' ? `cp:${c.id}` : c.externalRef.edgeId;
      // Unresolved cross-part ref (no resolver + no snapshot, or matcher missed)
      // → leave the entity at its last coords; the editor surfaces it as broken.
      if (c.externalRef.scope === 'cross-part' && !edgeIndex.has(key)) continue;
      for (const t of (c.targets || [])) {
        const e = entitiesById.get(t.entityId);
        if (e) {
          projectedPairs.push({ entity: e, edgeId: key });
          seenTargets.add(e.id);
        }
      }
    }
    for (const e of (sketch.state.entities || [])) {
      if (!e.projectedFrom || seenTargets.has(e.id)) continue;
      if (debug) console.log(`[cad-projection] sketch=${sid} entity=${e.id} legacy projectedFrom — treating as on-edge`);
      projectedPairs.push({ entity: e, edgeId: e.projectedFrom.edgeId });
    }
    if (projectedPairs.length === 0) {
      nextSketches[sid] = sketch;
      continue;
    }
    const newEntities = (sketch.state.entities || []).map(e => e);
    let sketchChanged = false;
    // "Pinned" = a non-on-edge constraint that determines position
    // (coincident / fixed / midpoint). Re-projection MUST skip those
    // points — the user-applied trim / sketched coincident wins over
    // the source-edge projection. Mirrors the frontend's check.
    const isPointPinned = (pointId) => {
      for (const c of (sketch.state.constraints || [])) {
        if (c.type !== 'coincident' && c.type !== 'fixed' && c.type !== 'midpoint') continue;
        for (const t of (c.targets || [])) {
          if (t.entityId === pointId) return true;
        }
      }
      return false;
    };
    const updatePoint = (pid, x, y) => {
      if (isPointPinned(pid)) return;
      const idx = newEntities.findIndex(en => en.id === pid && en.kind === 'point');
      if (idx < 0) return;
      const cur = newEntities[idx];
      if (Math.abs(cur.x - x) < 1e-9 && Math.abs(cur.y - y) < 1e-9) return;
      if (debug) {
        // eslint-disable-next-line no-console
        console.log(`[cad-projection] sketch=${sid} point=${pid} ${cur.x.toFixed(4)},${cur.y.toFixed(4)} -> ${x.toFixed(4)},${y.toFixed(4)}`);
      }
      newEntities[idx] = { ...cur, x, y };
      sketchChanged = true;
    };
    for (const { entity: pe, edgeId } of projectedPairs) {
      const src = edgeIndex.get(edgeId);
      if (!src) {
        if (debug) console.log(`[cad-projection] sketch=${sid} entity=${pe.id} source edge ${edgeId} not in topology — skipped`);
        continue;
      }
      if (pe.kind === 'line' && src.isStraight) {
        const p1 = _projectFrom3D(sketch.plane, src.endpoints[0]);
        const p2 = _projectFrom3D(sketch.plane, src.endpoints[1]);
        // Proximity-based assignment: pick start↔p1/end↔p2 (direct)
        // or swap, whichever minimises total point-to-source distance.
        // Mirrors the frontend swap-detection so backend & frontend
        // pick the same assignment when kernel reorders endpoints.
        const sPt = newEntities.find(en => en.id === pe.startId && en.kind === 'point');
        const ePt = newEntities.find(en => en.id === pe.endId && en.kind === 'point');
        if (sPt && ePt) {
          const d2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
          const direct = d2(sPt, p1) + d2(ePt, p2);
          const swap   = d2(sPt, p2) + d2(ePt, p1);
          const useSwap = swap < direct;
          updatePoint(pe.startId, useSwap ? p2.x : p1.x, useSwap ? p2.y : p1.y);
          updatePoint(pe.endId,   useSwap ? p1.x : p2.x, useSwap ? p1.y : p2.y);
        } else {
          updatePoint(pe.startId, p1.x, p1.y);
          updatePoint(pe.endId, p2.x, p2.y);
        }
      } else if (pe.kind === 'circle' && Array.isArray(src.polyline)) {
        const proj = _circleFromPolyline(src.polyline, sketch.plane);
        if (!proj) continue;
        updatePoint(pe.centerId, proj.cx, proj.cy);
        if (Math.abs(pe.radius - proj.radius) > 1e-9) {
          const idx = newEntities.findIndex(en => en.id === pe.id);
          newEntities[idx] = { ...pe, radius: proj.radius };
          sketchChanged = true;
        }
      } else if (pe.kind === 'arc' && Array.isArray(src.polyline) && !src.isStraight) {
        const proj = _arcFromPolyline(src.polyline, sketch.plane);
        if (!proj) continue;
        updatePoint(pe.centerId, proj.cx, proj.cy);
        // Swap detection — same idea as the line case. The polyline
        // can be iterated in EITHER direction (the kernel's choice),
        // so the entity's startId may correspond to either proj.start
        // OR proj.end. Pick the assignment minimising total point-
        // to-source-endpoint distance. Without this, the start/end
        // get wired to the wrong source endpoints and the arc
        // collapses to a tiny / wrong sub-arc.
        const sPt = newEntities.find(en => en.id === pe.startId && en.kind === 'point');
        const ePt = newEntities.find(en => en.id === pe.endId && en.kind === 'point');
        if (sPt && ePt) {
          const sx = proj.startX, sy = proj.startY;
          const ex = proj.endX, ey = proj.endY;
          const d2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
          const direct = d2(sPt.x, sPt.y, sx, sy) + d2(ePt.x, ePt.y, ex, ey);
          const swap   = d2(sPt.x, sPt.y, ex, ey) + d2(ePt.x, ePt.y, sx, sy);
          const useSwap = swap < direct;
          updatePoint(pe.startId, useSwap ? ex : sx, useSwap ? ey : sy);
          updatePoint(pe.endId,   useSwap ? sx : ex, useSwap ? sy : ey);
          // If we swapped the endpoint assignment, the arc's
          // rotational sense is now reversed too. Flip ccw on the
          // stored entity so renderers / picker / solver see a
          // consistent arc.
          const effectiveCcw = useSwap ? !proj.ccw : proj.ccw;
          if (Math.abs(pe.radius - proj.radius) > 1e-9 || pe.ccw !== effectiveCcw) {
            const idx = newEntities.findIndex(en => en.id === pe.id);
            newEntities[idx] = { ...pe, radius: proj.radius, ccw: effectiveCcw };
            sketchChanged = true;
          }
        } else {
          updatePoint(pe.startId, proj.startX, proj.startY);
          updatePoint(pe.endId, proj.endX, proj.endY);
          if (Math.abs(pe.radius - proj.radius) > 1e-9 || pe.ccw !== proj.ccw) {
            const idx = newEntities.findIndex(en => en.id === pe.id);
            newEntities[idx] = { ...pe, radius: proj.radius, ccw: proj.ccw };
            sketchChanged = true;
          }
        }
      }
    }
    if (debug && sketchChanged) {
      console.log(`[cad-projection] sketch=${sid} updated ${projectedPairs.length} projected entity link(s)`);
    }
    nextSketches[sid] = sketchChanged
      ? { ...sketch, state: { ...sketch.state, entities: newEntities } }
      : sketch;
    if (sketchChanged) docChanged = true;
  }
  return docChanged
    ? { ...sketchDoc, sketches: nextSketches }
    : sketchDoc;
}

function _projectFrom3D(plane, world) {
  const rx = world[0] - plane.origin[0];
  const ry = world[1] - plane.origin[1];
  const rz = world[2] - plane.origin[2];
  return {
    x: rx * plane.xAxis[0] + ry * plane.xAxis[1] + rz * plane.xAxis[2],
    y: rx * plane.yAxis[0] + ry * plane.yAxis[1] + rz * plane.yAxis[2],
  };
}

/** Closed circular polyline → center + radius. Returns null when the
 * samples don't form a circle. */
function _circleFromPolyline(polyline, plane) {
  if (polyline.length < 8) return null;
  const pts2d = polyline.map(p => _projectFrom3D(plane, p));
  const first = pts2d[0], last = pts2d[pts2d.length - 1];
  const closed = Math.hypot(last.x - first.x, last.y - first.y) < 1e-4;
  if (!closed) return null;
  let cx = 0, cy = 0;
  for (let i = 0; i < pts2d.length - 1; i++) { cx += pts2d[i].x; cy += pts2d[i].y; }
  cx /= (pts2d.length - 1); cy /= (pts2d.length - 1);
  const radius = Math.hypot(pts2d[0].x - cx, pts2d[0].y - cy);
  if (radius < 1e-6) return null;
  const ok = pts2d.every(p => Math.abs(Math.hypot(p.x - cx, p.y - cy) - radius) < radius * 0.01 + 1e-3);
  if (!ok) return null;
  return { cx, cy, radius };
}

/** Open circular polyline (arc) → center + radius + endpoints + ccw.
 * Three-point circumcircle from first / middle / last sample, verified
 * against the rest. Returns null when not arc-like. */
function _arcFromPolyline(polyline, plane) {
  if (polyline.length < 3) return null;
  const pts2d = polyline.map(p => _projectFrom3D(plane, p));
  const first = pts2d[0], last = pts2d[pts2d.length - 1];
  const closed = Math.hypot(last.x - first.x, last.y - first.y) < 1e-4;
  if (closed) return null;
  const mid = pts2d[Math.floor(pts2d.length / 2)];
  const c = _circumcircle(first, mid, last);
  if (!c) return null;
  const ok = pts2d.every(p =>
    Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.radius) < c.radius * 0.01 + 1e-3,
  );
  if (!ok) return null;
  // CCW from start to end iff the polyline's midpoint sample is
  // encountered along the CCW arc (i.e. angle-from-start to mid is
  // smaller than angle-from-start to end, both measured CCW). The
  // earlier chord-cross test picked the long way for short arcs.
  const angA = Math.atan2(first.y - c.cy, first.x - c.cx);
  const angM = Math.atan2(mid.y - c.cy, mid.x - c.cx);
  const angB = Math.atan2(last.y - c.cy, last.x - c.cx);
  const norm = (x) => { let v = x; while (v < 0) v += 2 * Math.PI; while (v >= 2 * Math.PI) v -= 2 * Math.PI; return v; };
  const ccw = norm(angM - angA) < norm(angB - angA);
  return {
    cx: c.cx, cy: c.cy, radius: c.radius,
    startX: first.x, startY: first.y,
    endX: last.x, endY: last.y,
    ccw,
  };
}

/** Circumcircle of three 2D points. Returns null when collinear. */
function _circumcircle(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const radius = Math.hypot(a.x - cx, a.y - cy);
  return { cx, cy, radius };
}

/** Normalize `opts.externalEdges` (Map or plain object, keyed by constraint id)
 * into a Map<constraintId, { isStraight, endpoints, polyline }>. Each value is a
 * source edge already expressed in THIS part's local 3D frame; missing fields are
 * derived from the polyline (endpoints = first/last, isStraight = 2-point). */
function _normalizeExternalEdges(x) {
  const out = new Map();
  if (!x) return out;
  const entries = x instanceof Map ? Array.from(x.entries()) : Object.entries(x);
  for (const [cid, raw] of entries) {
    if (!raw) continue;
    const poly = Array.isArray(raw.polyline) && raw.polyline.length >= 2 ? raw.polyline : null;
    const endpoints = Array.isArray(raw.endpoints) && raw.endpoints.length === 2
      ? raw.endpoints
      : (poly ? [poly[0], poly[poly.length - 1]] : null);
    if (!poly && !endpoints) continue;
    const isStraight = raw.isStraight != null ? raw.isStraight : (poly ? poly.length === 2 : true);
    out.set(String(cid), { isStraight, endpoints, polyline: poly || endpoints });
  }
  return out;
}

module.exports = {
  applyProjectionToSketchDoc,
};
