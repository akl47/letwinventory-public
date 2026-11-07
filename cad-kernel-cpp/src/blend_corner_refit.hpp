// Re-tangent fillet corner patches that OCCT leaves creased.
//
// When a fillet radius exceeds the radius of a corner it wraps around (e.g. a
// 5 mm round on a 3 mm rounded corner), BRepFilletAPI_MakeFillet approximates
// the corner with a B-spline patch that meets its neighbours with a crease of a
// few degrees instead of tangentially. The crease is invisible on its own but
// any later offset (shell, thicken) splits it into a gap of thickness·sin θ,
// which OCCT then covers with loose tolerances that defeat meshing.
//
// For each such patch this fits a replacement surface through the patch's own
// boundary edges with tangency (G1) to every smoothly-joined neighbour
// (BRepOffsetAPI_MakeFilling) and swaps it in on the same edges, so topology
// and face order (hence persistent face naming) are unchanged.
#pragma once

#include <TopoDS_Shape.hxx>

/// Returns `shape` with creased corner patches replaced, or `shape` unchanged
/// when nothing needs fixing or the replacement would not be a valid solid.
TopoDS_Shape refit_creased_blend_corners(const TopoDS_Shape& shape);
