'use strict';

// REQ 915/916 — assembly SKELETON geometry evaluation. Pure math over the
// assembly's sketchDoc: each skeleton sketch entity becomes a 3D polyline in
// the ASSEMBLY WORLD frame via the sketch's stored plane basis. No kernel.
//
// Keys (also the overlay stableIds and externalEdges lookup keys):
//   edge entities:  asketch:<sketchId>/<entityId>
//   vertices:       asketchv:<sketchId>/<entityId>/<start|end|center|self>
//
// HIDDEN sketches are included — a skeleton is routinely hidden once children
// reference it; visibility is render-only (mirrors part sketch semantics).

const ARC_SAMPLES = 32;

function to3D(plane, x, y) {
  const o = plane.origin, ax = plane.xAxis, ay = plane.yAxis;
  return [
    o[0] + ax[0] * x + ay[0] * y,
    o[1] + ax[1] * x + ay[1] * y,
    o[2] + ax[2] * x + ay[2] * y,
  ];
}

function pointById(state, id) {
  for (const e of state.entities || []) {
    if (e.kind === 'point' && e.id === id) return e;
  }
  return null;
}

/** Every skeleton entity as { sketchId, entityId, key, polyline, isStraight,
 * kind } in the assembly world frame. Points are 1-sample polylines. */
function skeletonEdges(sketchDoc) {
  const out = [];
  const sketches = (sketchDoc && sketchDoc.sketches) || {};
  for (const sid of Object.keys(sketches)) {
    const sketch = sketches[sid];
    const plane = sketch && sketch.plane;
    const state = sketch && sketch.state;
    if (!plane || !state) continue;
    const P = (x, y) => to3D(plane, x, y);
    for (const e of state.entities || []) {
      if (e.construction) continue;  // reference-only geometry stays sketch-local
      const key = `asketch:${sid}/${e.id}`;
      if (e.kind === 'line') {
        const a = pointById(state, e.startId);
        const b = pointById(state, e.endId);
        if (!a || !b) continue;
        out.push({ sketchId: sid, entityId: e.id, key, kind: 'line', isStraight: true, polyline: [P(a.x, a.y), P(b.x, b.y)] });
      } else if (e.kind === 'circle') {
        const c = pointById(state, e.centerId);
        if (!c) continue;
        const poly = [];
        for (let i = 0; i <= ARC_SAMPLES; i++) {
          const t = (i / ARC_SAMPLES) * 2 * Math.PI;
          poly.push(P(c.x + e.radius * Math.cos(t), c.y + e.radius * Math.sin(t)));
        }
        out.push({ sketchId: sid, entityId: e.id, key, kind: 'circle', isStraight: false, polyline: poly });
      } else if (e.kind === 'arc') {
        const c = pointById(state, e.centerId);
        const s = pointById(state, e.startId);
        const en = pointById(state, e.endId);
        if (!c || !s || !en) continue;
        const a0 = Math.atan2(s.y - c.y, s.x - c.x);
        let a1 = Math.atan2(en.y - c.y, en.x - c.x);
        if (e.ccw && a1 <= a0) a1 += 2 * Math.PI;
        if (!e.ccw && a1 >= a0) a1 -= 2 * Math.PI;
        const poly = [];
        for (let i = 0; i <= ARC_SAMPLES; i++) {
          const t = a0 + ((a1 - a0) * i) / ARC_SAMPLES;
          poly.push(P(c.x + e.radius * Math.cos(t), c.y + e.radius * Math.sin(t)));
        }
        out.push({ sketchId: sid, entityId: e.id, key, kind: 'arc', isStraight: false, polyline: poly });
      } else if (e.kind === 'point') {
        if (e.id === 'origin') continue;  // every sketch's implicit origin — noise as a ref
        out.push({ sketchId: sid, entityId: e.id, key, kind: 'point', isStraight: true, polyline: [P(e.x, e.y)] });
      }
    }
  }
  return out;
}

/** Lookup map for the cross-part resolver: every edge key plus the vertex
 * keys (line start/end, curve center, standalone point). Values are
 * { polyline, isStraight } in the assembly world frame. */
function skeletonGeoMap(sketchDoc) {
  const map = new Map();
  const sketches = (sketchDoc && sketchDoc.sketches) || {};
  for (const edge of skeletonEdges(sketchDoc)) {
    map.set(edge.key, { polyline: edge.polyline, isStraight: edge.isStraight });
  }
  for (const sid of Object.keys(sketches)) {
    const sketch = sketches[sid];
    const plane = sketch && sketch.plane;
    const state = sketch && sketch.state;
    if (!plane || !state) continue;
    const P = (x, y) => to3D(plane, x, y);
    const vertex = (entityId, sub, x, y) => {
      const p = P(x, y);
      map.set(`asketchv:${sid}/${entityId}/${sub}`, { polyline: [p, p], isStraight: true });
    };
    for (const e of state.entities || []) {
      if (e.construction) continue;
      if (e.kind === 'line') {
        const a = pointById(state, e.startId);
        const b = pointById(state, e.endId);
        if (a) vertex(e.id, 'start', a.x, a.y);
        if (b) vertex(e.id, 'end', b.x, b.y);
      } else if (e.kind === 'circle' || e.kind === 'arc') {
        const c = pointById(state, e.centerId);
        if (c) vertex(e.id, 'center', c.x, c.y);
      } else if (e.kind === 'point' && e.id !== 'origin') {
        vertex(e.id, 'self', e.x, e.y);
      }
    }
  }
  return map;
}

/** Geometric fallback for a deleted/renamed skeleton entity: nearest entry by
 * endpoint distance against the ref's stored fallback (assembly-world). */
function matchSkeletonFallback(geoMap, fallback) {
  if (!fallback) return null;
  const target = fallback.kind === 'vertex'
    ? [fallback.position, fallback.position]
    : (fallback.kind === 'edge' ? [fallback.start, fallback.end] : null);
  if (!target || !target[0] || !target[1]) return null;
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  let best = null, bestScore = Infinity;
  for (const entry of geoMap.values()) {
    const poly = entry.polyline;
    if (!poly.length) continue;
    const p0 = poly[0], p1 = poly[poly.length - 1];
    const score = Math.min(
      d2(p0, target[0]) + d2(p1, target[1]),
      d2(p0, target[1]) + d2(p1, target[0]),
    );
    if (score < bestScore) { bestScore = score; best = entry; }
  }
  // Same spirit as cadExternalRef's geometric match: accept only a CLOSE
  // candidate (1 mm² per endpoint) so a deleted entity doesn't silently
  // rebind to unrelated geometry.
  return bestScore <= 2 ? best : null;
}

module.exports = { skeletonEdges, skeletonGeoMap, matchSkeletonFallback };
