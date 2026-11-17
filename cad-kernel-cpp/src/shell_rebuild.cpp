// See shell_rebuild.hpp.
#include "shell_rebuild.hpp"

#include "shell_hole_fallback.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <numeric>
#include <vector>

#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Defeaturing.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepOffset_MakeOffset.hxx>
#include <BRepTools.hxx>
#include <BRepTopAdaptor_FClass2d.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Geom2d_Curve.hxx>
#include <IMeshTools_Parameters.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>

namespace {

const double kInf = std::numeric_limits<double>::infinity();

enum EdgeKind { Convex = -1, Smooth = 0, Reflex = 1 };

bool outward_normal(const TopoDS_Face& f, const gp_Pnt2d& uv, gp_Pnt& p, gp_Dir& n) {
  BRepAdaptor_Surface s(f);
  BRepLProp_SLProps pr(s, uv.X(), uv.Y(), 1, 1e-9);
  if (!pr.IsNormalDefined()) return false;
  n = pr.Normal();
  if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
  p = pr.Value();
  return true;
}

// Whether the material at `e` is less than (Convex) or more than (Reflex) a
// half-space: step off the edge into f2 and see which side of f1's tangent
// plane that lands. Sampled at three points; the majority wins.
EdgeKind edge_kind(const TopoDS_Edge& e, const TopoDS_Face& f1, const TopoDS_Face& f2) {
  double a1, b1, a2, b2;
  Handle(Geom2d_Curve) c1 = BRep_Tool::CurveOnSurface(e, f1, a1, b1);
  Handle(Geom2d_Curve) c2 = BRep_Tool::CurveOnSurface(e, f2, a2, b2);
  if (c1.IsNull() || c2.IsNull()) return Smooth;
  BRepAdaptor_Surface s2(f2);
  BRepTopAdaptor_FClass2d inside(f2, 1e-9);
  int convex = 0, reflex = 0, smooth = 0;
  for (double fr : {0.5, 0.23, 0.77}) {
    gp_Pnt p1, pe;
    gp_Dir n1, n2;
    if (!outward_normal(f1, c1->Value(a1 + (b1 - a1) * fr), p1, n1)) continue;
    gp_Pnt2d q;
    gp_Vec2d t;
    c2->D1(a2 + (b2 - a2) * fr, q, t);
    if (t.Magnitude() < 1e-12 || !outward_normal(f2, q, pe, n2)) continue;
    if (n1.Dot(n2) > 0.9995) { ++smooth; continue; }
    gp_Vec2d perp(-t.Y(), t.X());
    perp.Normalize();
    bool done = false;
    for (double d : {1e-3, 1e-2, 1e-4}) {
      for (int sgn : {1, -1}) {
        const gp_Pnt2d uv(q.X() + sgn * d * perp.X(), q.Y() + sgn * d * perp.Y());
        if (inside.Perform(uv) != TopAbs_IN) continue;
        const gp_Pnt x = s2.Value(uv.X(), uv.Y());
        const double len = pe.Distance(x);
        if (len < 1e-12) continue;
        const double h = gp_Vec(pe, x).Dot(gp_Vec(n1)) / len;
        if (h > 1e-3) ++reflex;
        else if (h < -1e-3) ++convex;
        else ++smooth;
        done = true;
        break;
      }
      if (done) break;
    }
  }
  if (reflex > convex && reflex >= smooth) return Reflex;
  if (convex > reflex && convex >= smooth) return Convex;
  return Smooth;
}

// Radius of curvature of `f` toward the side it is offset to: the offset
// surface degenerates once the wall reaches it. `lo`/`hi` are the extremes
// over the face (∞ where it curves away or is flat).
void focal_radius(const TopoDS_Face& f, double thickness, double& lo, double& hi) {
  lo = kInf;
  hi = 0.0;
  BRepAdaptor_Surface s(f);
  double u0, u1, v0, v1;
  BRepTools::UVBounds(f, u0, u1, v0, v1);
  // Centre of curvature sits at P + N/k for OCCT's signed curvature k along
  // the natural normal N; the offset travels along sign(thickness) × the
  // outward normal.
  const double side = (thickness < 0 ? -1.0 : 1.0) * (f.Orientation() == TopAbs_REVERSED ? -1.0 : 1.0);
  const int n = 5;
  for (int i = 0; i < n; ++i) {
    for (int j = 0; j < n; ++j) {
      BRepLProp_SLProps pr(s, u0 + (u1 - u0) * (i + 0.5) / n, v0 + (v1 - v0) * (j + 0.5) / n, 2, 1e-9);
      if (!pr.IsCurvatureDefined()) continue;
      const double k = std::max(pr.MaxCurvature() * side, pr.MinCurvature() * side);
      const double r = k > 1e-9 ? 1.0 / k : kInf;
      lo = std::min(lo, r);
      hi = std::max(hi, r);
    }
  }
  if (hi == 0.0) hi = kInf;
}

bool valid_solid(const TopoDS_Shape& s) {
  if (s.IsNull() || !BRepCheck_Analyzer(s).IsValid()) return false;
  TopExp_Explorer ex(s, TopAbs_SOLID);
  return ex.More();
}

// Every face triangulates at the kernel's tessellation settings (geom_io).
bool meshes(const TopoDS_Shape& s) {
  IMeshTools_Parameters p;
  p.Deflection = 0.05;
  p.Angle = 0.5;
  p.InParallel = Standard_True;
  BRepMesh_IncrementalMesh mesh(s, p);
  for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
    TopLoc_Location loc;
    if (BRep_Tool::Triangulation(TopoDS::Face(ex.Current()), loc).IsNull()) return false;
  }
  return true;
}

// The solid swept between `skin` (a face or a shell of faces) and its offset.
// Sharp joins first (SolidWorks parity), rounded when those fail.
TopoDS_Shape thicken(const TopoDS_Shape& skin, double depth, double tolerance) {
  for (GeomAbs_JoinType join : {GeomAbs_Intersection, GeomAbs_Arc}) {
    try {
      // On a copy: the offset engine adjusts tolerances on what it is given,
      // and the body is still needed afterwards.
      BRepOffset_MakeOffset mo;
      mo.Initialize(BRepBuilderAPI_Copy(skin).Shape(), depth, tolerance, BRepOffset_Skin, false,
                    false, join, true);
      mo.MakeOffsetShape();
      if (mo.IsDone() && valid_solid(mo.Shape())) return mo.Shape();
    } catch (const Standard_Failure&) {
    }
  }
  return {};
}

// Thickens every patch of `body` into `tools`. False when a patch can't be
// offset; `vanishing` then lists the faces whose offset collapses. A patch
// holding such a face never goes to OCCT, which can hand back a well-formed
// solid for the inverted offset.
bool thicken_patches(const TopoDS_Shape& body, const TopTools_ListOfShape& closing_faces,
                     double thickness, double tolerance, TopTools_ListOfShape& tools,
                     TopTools_ListOfShape& vanishing) {
  TopTools_IndexedMapOfShape closing, faces;
  for (const auto& f : closing_faces) closing.Add(f);
  for (TopExp_Explorer ex(body, TopAbs_FACE); ex.More(); ex.Next()) {
    if (!closing.Contains(ex.Current())) faces.Add(ex.Current());
  }
  const int n = faces.Extent();
  if (n == 0) return false;

  // Join faces across every edge except those where the two offsets overlap
  // (convex material for an inward shell, reflex for an outward one) — there
  // independent slabs simply cross.
  const EdgeKind overlap = thickness < 0 ? Convex : Reflex;
  std::vector<int> parent(n + 1);
  std::iota(parent.begin(), parent.end(), 0);
  auto find = [&](int x) {
    while (parent[x] != x) x = parent[x] = parent[parent[x]];
    return x;
  };
  TopTools_IndexedDataMapOfShapeListOfShape edge_faces;
  TopExp::MapShapesAndAncestors(body, TopAbs_EDGE, TopAbs_FACE, edge_faces);
  for (int i = 1; i <= edge_faces.Extent(); ++i) {
    const auto& adj = edge_faces(i);
    if (adj.Extent() != 2) continue;
    const TopoDS_Face f1 = TopoDS::Face(adj.First()), f2 = TopoDS::Face(adj.Last());
    const int a = faces.FindIndex(f1), b = faces.FindIndex(f2);
    if (!a || !b || a == b) continue;
    const TopoDS_Edge e = TopoDS::Edge(edge_faces.FindKey(i));
    if (BRep_Tool::Degenerated(e) || edge_kind(e, f1, f2) == overlap) continue;
    parent[find(a)] = find(b);
  }
  std::map<int, std::vector<int>> patches;
  for (int i = 1; i <= n; ++i) patches[find(i)].push_back(i);

  const double wall = std::fabs(thickness);
  bool ok = true;
  for (const auto& p : patches) {
    TopoDS_Shape skin = faces(p.second.front());
    if (p.second.size() > 1) {
      BRep_Builder b;
      TopoDS_Shell sh;
      b.MakeShell(sh);
      for (int i : p.second) b.Add(sh, faces(i));
      skin = sh;
    }
    TopTools_ListOfShape collapsing;
    for (int i : p.second) {
      double lo, hi;
      focal_radius(TopoDS::Face(faces(i)), thickness, lo, hi);
      // A face that vanishes only in part can't simply be dropped.
      if (lo <= wall * 1.001 && hi <= lo * 1.02) collapsing.Append(faces(i));
    }
    if (collapsing.IsEmpty()) {
      const TopoDS_Shape t = thicken(skin, thickness, tolerance);
      if (!t.IsNull()) {
        tools.Append(t);
        continue;
      }
    }
    ok = false;
    vanishing.Append(collapsing);
  }
  return ok;
}

// Inward: the hollow (`body` minus every thickened patch). Outward: the wall
// (their union). `defeatured` reports that vanishing faces were removed from
// the body first, which leaves the same hollow: a wall at least as thick as a
// blend's radius never reaches around it.
TopoDS_Shape offset_region(const TopoDS_Shape& body, const TopTools_ListOfShape& closing_faces,
                           double thickness, double tolerance, bool& defeatured) {
  TopTools_ListOfShape tools, vanishing;
  if (!thicken_patches(body, closing_faces, thickness, tolerance, tools, vanishing)) {
    if (defeatured || vanishing.IsEmpty()) return {};
    BRepAlgoAPI_Defeaturing defeat;
    defeat.SetShape(body);
    for (const auto& f : vanishing) defeat.AddFaceToRemove(f);
    defeat.SetRunParallel(true);
    defeat.Build();
    if (!defeat.IsDone() || !valid_solid(defeat.Shape())) return {};
    // Defeaturing keeps a face it cannot remove and still reports success.
    for (const auto& f : vanishing) {
      if (!defeat.IsDeleted(f)) return {};
    }
    TopTools_ListOfShape closing;
    if (!closing_faces_after(defeat, closing_faces, defeat.Shape(), tolerance, closing)) return {};
    defeatured = true;
    return offset_region(defeat.Shape(), closing, thickness, tolerance, defeatured);
  }

  // Booleans find the intersections between walls that were never neighbours.
  TopTools_ListOfShape args, rest = tools;
  if (thickness < 0) {
    args.Append(body);
    BRepAlgoAPI_Cut cut;
    cut.SetArguments(args);
    cut.SetTools(rest);
    cut.SetRunParallel(true);
    cut.Build();
    return cut.IsDone() ? cut.Shape() : TopoDS_Shape();
  }
  if (tools.Extent() == 1) return tools.First();
  args.Append(rest.First());
  rest.RemoveFirst();
  BRepAlgoAPI_Fuse fuse;
  fuse.SetArguments(args);
  fuse.SetTools(rest);
  fuse.SetRunParallel(true);
  fuse.Build();
  return fuse.IsDone() ? fuse.Shape() : TopoDS_Shape();
}

}  // namespace

TopoDS_Shape shell_by_patches(const TopoDS_Shape& body,
                              const TopTools_ListOfShape& closing_faces,
                              double thickness, double tolerance) {
  try {
    bool defeatured = false;
    const TopoDS_Shape region =
        offset_region(body, closing_faces, thickness, std::min(tolerance, 1e-6), defeatured);
    if (region.IsNull()) return {};

    TopoDS_Shape result = region;
    if (thickness < 0) {
      TopExp_Explorer hollow(region, TopAbs_SOLID);
      if (!hollow.More()) return {};  // the wall fills the body
      BRepAlgoAPI_Cut cut(body, region);
      if (!cut.IsDone()) return {};
      result = cut.Shape();
    } else if (defeatured) {
      // The wall was grown from the defeatured body, which the real one overlaps.
      BRepAlgoAPI_Cut cut(region, body);
      if (!cut.IsDone()) return {};
      result = cut.Shape();
    }

    try {
      ShapeUpgrade_UnifySameDomain unify(result, true, true, false);
      unify.Build();
      if (valid_solid(unify.Shape())) result = unify.Shape();
    } catch (const Standard_Failure&) {
    }
    if (!valid_solid(result) || !meshes(result)) return {};
    return result;
  } catch (const Standard_Failure&) {
    return {};
  }
}
