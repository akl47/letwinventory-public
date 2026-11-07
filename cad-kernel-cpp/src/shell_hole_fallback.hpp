// Shell fallback for bodies whose holes defeat OCCT's MakeThickSolid.
//
// An inward shell of a body with holes turns every hole wall into a tube.
// When those tubes run close to other offset walls, MakeThickSolidByJoin
// returns an invalid solid (faces inside out). This builds the same result
// from operations OCCT handles reliably:
//
//   F      = body with its holes filled          (BRepAlgoAPI_Defeaturing)
//   cavity = F − shell(F)                        (the hollow, incl. opening)
//   D_i    = hole i grown by the wall thickness  (revolved 2D offset:
//            sharp corners like SolidWorks, rounded if sharp won't mesh)
//   result = body − (cavity − ∪ D_i)
//
// Holes are coaxial runs of concave cylinders/cones plus the planar floors
// between them (plain, counterbore, countersink, blind or through).
#pragma once

#include <TopoDS_Shape.hxx>
#include <TopTools_ListOfShape.hxx>

/// Returns the shelled body, or a null shape when the body has no
/// recognisable holes or any step fails (the caller keeps its own error).
/// `thickness` must be negative (inward).
TopoDS_Shape shell_with_hole_tubes(const TopoDS_Shape& body,
                                   const TopTools_ListOfShape& closing_faces,
                                   double thickness, double tolerance);
