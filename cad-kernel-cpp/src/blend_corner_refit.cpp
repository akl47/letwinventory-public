#include "blend_corner_refit.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepLib.hxx>
#include <BRepOffsetAPI_MakeFilling.hxx>
#include <BRepTools.hxx>
#include <BRepTools_ReShape.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <ShapeFix_Edge.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>

#include <algorithm>
#include <cmath>
#include <optional>

namespace {

// A crease this small is ordinary approximation noise; past MAX it is a real
// edge between faces that were never meant to be tangent.
constexpr double MIN_CREASE = 0.05 * M_PI / 180.0;
constexpr double MAX_CREASE = 10.0 * M_PI / 180.0;
constexpr int SAMPLES = 8;
// A refit may only smooth the crease, not reshape the corner: reject one that
// strays more than this fraction of the patch's size from the original. Good
// refits stay near 1% (0.06-0.12 mm on a 12 mm patch); a corner OCCT built
// irregularly refit 0.44 mm off and left a body the shell could not offset
// (model 935).
constexpr double MAX_DEVIATION_FRACTION = 0.02;

std::optional<gp_Dir> outward_normal(const TopoDS_Face& f, const gp_Pnt& p) {
  TopLoc_Location loc;
  Handle(Geom_Surface) s = BRep_Tool::Surface(f, loc);
  if (s.IsNull()) return {};
  GeomAPI_ProjectPointOnSurf proj(p.Transformed(loc.Transformation().Inverted()), s);
  if (!proj.NbPoints()) return {};
  double u, v;
  proj.LowerDistanceParameters(u, v);
  gp_Pnt q;
  gp_Vec du, dv;
  s->D1(u, v, q, du, dv);
  gp_Vec n = du.Crossed(dv);
  if (n.Magnitude() < 1e-12) return {};
  n.Transform(loc.Transformation());
  if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
  return gp_Dir(n);
}

// Largest angle between the two faces' normals along the edge.
double crease(const TopoDS_Edge& e, const TopoDS_Face& a, const TopoDS_Face& b) {
  BRepAdaptor_Curve c(e);
  double worst = 0.0;
  for (int k = 0; k <= SAMPLES; ++k) {
    const double t = c.FirstParameter() + (c.LastParameter() - c.FirstParameter()) * k / SAMPLES;
    const gp_Pnt p = c.Value(t);
    auto na = outward_normal(a, p), nb = outward_normal(b, p);
    if (na && nb) worst = std::max(worst, na->Angle(*nb));
  }
  return worst;
}

TopoDS_Face neighbour(const TopTools_IndexedDataMapOfShapeListOfShape& edge_faces,
                      const TopoDS_Edge& e, const TopoDS_Face& f) {
  const TopTools_ListOfShape& faces = edge_faces.FindFromKey(e);
  if (faces.Extent() != 2) return {};
  return TopoDS::Face(faces.First().IsSame(f) ? faces.Last() : faces.First());
}

// Worst crease of `eval` (`f` or its replacement) against the neighbours `f`
// is meant to be tangent to.
double worst_crease(const TopTools_IndexedDataMapOfShapeListOfShape& edge_faces,
                    const TopoDS_Face& f, const TopoDS_Face& eval) {
  double worst = 0.0;
  for (TopExp_Explorer ex(f, TopAbs_EDGE); ex.More(); ex.Next()) {
    const TopoDS_Edge e = TopoDS::Edge(ex.Current());
    if (BRep_Tool::Degenerated(e)) continue;
    const TopoDS_Face n = neighbour(edge_faces, e, f);
    if (n.IsNull()) continue;
    const double a = crease(e, eval, n);
    if (a < MAX_CREASE) worst = std::max(worst, a);
  }
  return worst;
}

// Surface through `f`'s boundary, tangent to its smooth neighbours, rebuilt on
// the same edges. Degenerated edges (a fillet patch's pole) are dropped — the
// fitted surface is regular there.
TopoDS_Face refit(const TopTools_IndexedDataMapOfShapeListOfShape& edge_faces,
                  const TopoDS_Face& f) {
  // Edges as the face itself sees them (not composed with its orientation in
  // the shell), so the new face's wire runs the way the surface expects.
  const TopoDS_Face fwd = TopoDS::Face(f.Oriented(TopAbs_FORWARD));
  const TopoDS_Wire outer = BRepTools::OuterWire(fwd);
  int nwires = 0;
  for (TopExp_Explorer ex(f, TopAbs_WIRE); ex.More(); ex.Next()) ++nwires;
  if (outer.IsNull() || nwires != 1) return {};

  BRepOffsetAPI_MakeFilling fill(3, 20, 3, false, 1e-6, 1e-6, 1e-5, 0.1, 10, 20);
  for (TopExp_Explorer ex(outer, TopAbs_EDGE); ex.More(); ex.Next()) {
    const TopoDS_Edge e = TopoDS::Edge(ex.Current());
    if (BRep_Tool::Degenerated(e)) continue;
    const TopoDS_Face n = neighbour(edge_faces, e, f);
    if (!n.IsNull() && crease(e, f, n) < MAX_CREASE) fill.Add(e, n, GeomAbs_G1, true);
    else fill.Add(e, GeomAbs_C0, true);
  }
  fill.Build();
  if (!fill.IsDone() || fill.G0Error() > 1e-5) return {};
  TopLoc_Location loc;
  Handle(Geom_Surface) surf = BRep_Tool::Surface(TopoDS::Face(fill.Shape()), loc);
  if (surf.IsNull()) return {};

  BRep_Builder bb;
  TopoDS_Wire wire;
  bb.MakeWire(wire);
  for (TopExp_Explorer ex(outer, TopAbs_EDGE); ex.More(); ex.Next()) {
    if (!BRep_Tool::Degenerated(TopoDS::Edge(ex.Current()))) bb.Add(wire, ex.Current());
  }
  // The wire keeps the old face's edge orientations, so the new surface must
  // face the same way as the old one.
  auto make = [&](const Handle(Geom_Surface)& s) {
    TopoDS_Face nf;
    bb.MakeFace(nf, s, loc, 1e-7);
    bb.Add(nf, wire);
    return nf;
  };
  BRepAdaptor_Curve c(TopoDS::Edge(TopExp_Explorer(wire, TopAbs_EDGE).Current()));
  const gp_Pnt p = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
  auto n_old = outward_normal(fwd, p);
  auto n_new = outward_normal(make(surf), p);
  if (!n_old || !n_new) return {};
  if (n_old->Angle(*n_new) > M_PI / 2) surf = surf->UReversed();
  TopoDS_Face nf = make(surf);
  ShapeFix_Edge sfe;
  for (TopExp_Explorer ex(nf, TopAbs_EDGE); ex.More(); ex.Next()) {
    sfe.FixAddPCurve(TopoDS::Edge(ex.Current()), nf, false, 1e-7);
  }
  BRepLib::SameParameter(nf, 1e-7);
  return TopoDS::Face(nf.Oriented(f.Orientation()));
}

// Largest distance from interior samples of the original patch to the refit
// surface, as a fraction of the original patch's diagonal.
double relative_deviation(const TopoDS_Face& f, const TopoDS_Face& nf) {
  Bnd_Box box;
  BRepBndLib::AddOptimal(f, box, false, false);
  const double diag = std::sqrt(box.SquareExtent());
  if (diag < 1e-9) return 0.0;
  TopLoc_Location loc;
  const Handle(Geom_Surface) s = BRep_Tool::Surface(nf, loc);
  if (s.IsNull()) return 1.0;
  BRepAdaptor_Surface orig(f);
  double u0, u1, v0, v1;
  BRepTools::UVBounds(f, u0, u1, v0, v1);
  double worst = 0.0;
  for (int i = 1; i < SAMPLES; ++i) {
    for (int j = 1; j < SAMPLES; ++j) {
      gp_Pnt p = orig.Value(u0 + (u1 - u0) * i / SAMPLES, v0 + (v1 - v0) * j / SAMPLES);
      p.Transform(loc.Transformation().Inverted());
      GeomAPI_ProjectPointOnSurf proj(p, s);
      if (!proj.NbPoints()) return 1.0;
      worst = std::max(worst, proj.LowerDistance());
    }
  }
  return worst / diag;
}

}  // namespace

TopoDS_Shape refit_creased_blend_corners(const TopoDS_Shape& input) {
  try {
    // Refitting adds pcurves to shared edges; work on a copy so a rejected
    // attempt leaves the input untouched.
    const TopoDS_Shape shape = BRepBuilderAPI_Copy(input).Shape();
    TopTools_IndexedDataMapOfShapeListOfShape edge_faces;
    TopExp::MapShapesAndUniqueAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edge_faces);
    TopTools_IndexedMapOfShape faces;
    TopExp::MapShapes(shape, TopAbs_FACE, faces);

    BRepTools_ReShape reshape;
    int replaced = 0;
    for (int i = 1; i <= faces.Extent(); ++i) {
      const TopoDS_Face f = TopoDS::Face(faces(i));
      if (BRepAdaptor_Surface(f, false).GetType() != GeomAbs_BSplineSurface) continue;
      const double before = worst_crease(edge_faces, f, f);
      if (before < MIN_CREASE) continue;
      TopoDS_Face nf;
      try { nf = refit(edge_faces, f); } catch (const Standard_Failure&) { continue; }
      if (nf.IsNull()) continue;
      // The new face shares the old face's edges, so its neighbours are unchanged.
      if (worst_crease(edge_faces, f, nf) >= before) continue;
      if (relative_deviation(f, nf) > MAX_DEVIATION_FRACTION) continue;
      reshape.Replace(f, nf);
      ++replaced;
    }
    if (!replaced) return input;
    TopoDS_Shape out = reshape.Apply(shape);
    return BRepCheck_Analyzer(out).IsValid() ? out : input;
  } catch (const Standard_Failure&) {
    return input;
  }
}
