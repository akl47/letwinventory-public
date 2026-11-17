// Shell that rebuilds the hollowed body's topology instead of assuming it
// matches the original (REQ 1084).
//
// OCCT's MakeThickSolid offsets every face and re-intersects only faces that
// were already neighbours, so it returns an invalid solid whenever the offset
// changes the topology: a hole tube running into a side wall, a boss merging
// with a fillet, a fillet tighter than the wall. This builds the wall from
// pieces OCCT offsets reliably and lets the boolean engine find every new
// intersection:
//
//   patches = kept faces grouped across smooth edges and across edges where
//             the offsets pull apart (OCCT joins those); cut at edges where
//             the offsets overlap
//   T_k     = patch k thickened into a solid          (BRepOffset_MakeOffset)
//   inward:  result = body − (body − ∪ T_k)
//   outward: result = ∪ T_k
//
// Faces whose offset would shrink to nothing (curvature radius on the offset
// side ≤ the wall, e.g. a fillet tighter than the wall) are removed from the
// body before offsetting; the hollow is the same, with the sharp inner corner
// SolidWorks/Parasolid produce.
#pragma once

#include <TopoDS_Shape.hxx>
#include <TopTools_ListOfShape.hxx>

/// Returns the shelled body, or a null shape when any step fails (the caller
/// keeps its own error). Negative `thickness` = inward.
TopoDS_Shape shell_by_patches(const TopoDS_Shape& body,
                              const TopTools_ListOfShape& closing_faces,
                              double thickness, double tolerance);
