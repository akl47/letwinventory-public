// See shell_hole_fallback.hpp.
#include "shell_hole_fallback.hpp"

#include <algorithm>
#include <cmath>
#include <vector>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Defeaturing.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepOffsetAPI_MakeOffset.hxx>
#include <IMeshTools_Parameters.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <ElCLib.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Lin.hxx>

namespace {

struct Hole {
  gp_Ax1 axis;
  std::vector<TopoDS_Face> faces;
};

bool same_axis(const gp_Ax1& a, const gp_Ax1& b, double tol) {
  if (!a.IsParallel(b, 1e-9)) return false;
  return gp_Lin(a).Distance(b.Location()) < tol;
}

// Cylinder/cone whose material is OUTSIDE (a hole wall): the outward normal
// points toward the axis.
bool concave_revolved(const TopoDS_Face& f, gp_Ax1& axis_out) {
  BRepAdaptor_Surface s(f);
  if (s.GetType() == GeomAbs_Cylinder) axis_out = s.Cylinder().Axis();
  else if (s.GetType() == GeomAbs_Cone) axis_out = s.Cone().Axis();
  else return false;
  double u0, u1, v0, v1;
  BRepTools::UVBounds(f, u0, u1, v0, v1);
  if (u1 - u0 < 2 * M_PI - 1e-6) return false;  // partial (e.g. a concave fillet)
  BRepLProp_SLProps pr(s, (u0 + u1) / 2, (v0 + v1) / 2, 1, 1e-9);
  if (!pr.IsNormalDefined()) return false;
  gp_Dir n = pr.Normal();
  if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
  const gp_Pnt p = pr.Value();
  const gp_Lin line(axis_out);
  const gp_Pnt q = ElCLib::Value(ElCLib::Parameter(line, p), line);
  gp_Vec radial(q, p);
  if (radial.Magnitude() < 1e-9) return false;
  return gp_Vec(n).Dot(radial) < 0.0;
}

// Planar face perpendicular to `axis` whose edges are all circles on it.
bool coaxial_floor(const TopoDS_Face& f, const gp_Ax1& axis, double tol) {
  BRepAdaptor_Surface s(f);
  if (s.GetType() != GeomAbs_Plane) return false;
  if (!s.Plane().Axis().IsParallel(axis, 1e-9)) return false;
  for (TopExp_Explorer e(f, TopAbs_EDGE); e.More(); e.Next()) {
    BRepAdaptor_Curve c(TopoDS::Edge(e.Current()));
    if (c.GetType() != GeomAbs_Circle) return false;
    if (gp_Lin(axis).Distance(c.Circle().Location()) > tol) return false;
  }
  return true;
}

// Axial range and end radii of one face along the hole axis.
struct Span { double s0, s1, r0, r1; bool lateral; bool disk; };

Span span_of(const TopoDS_Face& f, const gp_Ax1& axis) {
  const gp_Lin line(axis);
  Span sp{1e300, -1e300, 0, 0, false, false};
  double rmin = 1e300, rmax = -1e300;
  for (TopExp_Explorer e(f, TopAbs_VERTEX); e.More(); e.Next()) {
    const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(e.Current()));
    const double s = gp_Vec(axis.Location(), p).Dot(gp_Vec(axis.Direction()));
    const double r = line.Distance(p);
    if (s < sp.s0) { sp.s0 = s; sp.r0 = r; }
    if (s > sp.s1) { sp.s1 = s; sp.r1 = r; }
    rmin = std::min(rmin, r);
    rmax = std::max(rmax, r);
  }
  BRepAdaptor_Surface s(f);
  sp.lateral = s.GetType() != GeomAbs_Plane;
  if (!sp.lateral) {
    sp.r0 = rmin;
    sp.r1 = rmax;
    int wires = 0;
    for (TopExp_Explorer w(f, TopAbs_WIRE); w.More(); w.Next()) ++wires;
    sp.disk = wires == 1;  // no inner loop: a blind hole's flat bottom
  }
  // A full-circle face has a single seam vertex per circle; radius comes from
  // the surface for cylinders (both ends equal).
  if (s.GetType() == GeomAbs_Cylinder) sp.r0 = sp.r1 = s.Cylinder().Radius();
  return sp;
}

// Grown copy of one hole: its (s, r) half-profile, open ends extended past
// the body, offset by `t` in 2D, clipped to r ≥ 0 and revolved about the hole
// axis. `join` Intersection keeps corners sharp (SolidWorks: a counterbore
// tube has a square shoulder); Arc rounds them. Null when the faces don't form one
// contiguous profile.
TopoDS_Shape grown_hole(const Hole& h, double t, double reach, double tol, GeomAbs_JoinType join) {
  std::vector<Span> lat, flat;
  for (const auto& f : h.faces) {
    Span sp = span_of(f, h.axis);
    (sp.lateral ? lat : flat).push_back(sp);
  }
  if (lat.empty()) return {};
  std::sort(lat.begin(), lat.end(), [](const Span& a, const Span& b) { return a.s0 < b.s0; });
  for (size_t i = 1; i < lat.size(); ++i) {
    if (std::fabs(lat[i].s0 - lat[i - 1].s1) > tol) return {};  // gap/overlap
  }
  auto closed_at = [&](double s) {
    for (const auto& f : flat) {
      if (std::fabs(f.s0 - s) < tol && f.disk) return true;
    }
    return false;
  };
  const double s_lo = lat.front().s0, s_hi = lat.back().s1;
  const bool open_lo = lat.front().r0 > tol && !closed_at(s_lo);
  const bool open_hi = lat.back().r1 > tol && !closed_at(s_hi);

  // Open ends run on straight past the body; a profile point at r = 0
  // closes each end on the axis.
  std::vector<std::pair<double, double>> pts;  // (s, r)
  if (open_lo) {
    pts.push_back({s_lo - reach, 0.0});
    pts.push_back({s_lo - reach, lat.front().r0});
  } else {
    pts.push_back({s_lo, 0.0});
  }
  pts.push_back({s_lo, lat.front().r0});
  for (size_t i = 0; i < lat.size(); ++i) {
    if (i > 0 && std::fabs(lat[i].r0 - pts.back().second) > tol) {
      pts.push_back({lat[i].s0, lat[i].r0});  // step across a floor
    }
    pts.push_back({lat[i].s1, lat[i].r1});
  }
  if (open_hi) pts.push_back({s_hi + reach, lat.back().r1});
  pts.push_back({pts.back().first, 0.0});

  const gp_Dir d = h.axis.Direction();
  const gp_Dir e = std::fabs(d.X()) < 0.9 ? gp_Dir(gp_Vec(d).Crossed(gp_Vec(1, 0, 0)))
                                          : gp_Dir(gp_Vec(d).Crossed(gp_Vec(0, 1, 0)));
  auto P = [&](double s, double r) {
    return h.axis.Location().Translated(gp_Vec(d) * s + gp_Vec(e) * r);
  };
  BRepBuilderAPI_MakePolygon poly;
  for (const auto& p : pts) poly.Add(P(p.first, p.second));
  poly.Close();
  if (!poly.IsDone()) return {};
  TopoDS_Face profile = BRepBuilderAPI_MakeFace(poly.Wire(), true);

  BRepOffsetAPI_MakeOffset off(profile, join);
  off.Perform(std::fabs(t));
  if (!off.IsDone()) return {};
  TopoDS_Face grown = BRepBuilderAPI_MakeFace(TopoDS::Wire(off.Shape()), true);

  const double big = reach * 4;
  BRepBuilderAPI_MakePolygon half(P(-big, 0), P(big, 0), P(big, big), P(-big, big), true);
  TopoDS_Shape clipped = BRepAlgoAPI_Common(grown, BRepBuilderAPI_MakeFace(half.Wire(), true));
  TopExp_Explorer fx(clipped, TopAbs_FACE);
  if (!fx.More()) return {};
  BRepPrimAPI_MakeRevol rev(fx.Current(), h.axis, 2 * M_PI);
  return rev.IsDone() ? rev.Shape() : TopoDS_Shape();
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

bool valid_solid(const TopoDS_Shape& s) {
  if (s.IsNull() || !BRepCheck_Analyzer(s).IsValid()) return false;
  TopExp_Explorer ex(s, TopAbs_SOLID);
  return ex.More();
}

}  // namespace

TopoDS_Shape shell_with_hole_tubes(const TopoDS_Shape& body,
                                   const TopTools_ListOfShape& closing_faces,
                                   double thickness, double tolerance) {
  if (thickness >= 0.0) return {};
  try {
    Bnd_Box box;
    BRepBndLib::Add(body, box);
    const double reach = std::sqrt(box.SquareExtent()) + std::fabs(thickness) * 4;
    const double tol = std::max(tolerance, 1e-6 * reach);

    TopTools_IndexedMapOfShape closing;
    for (const auto& f : closing_faces) closing.Add(f);

    // 1. Recognise holes: group coaxial concave walls, then pull in the
    //    planar floors adjacent to them.
    std::vector<Hole> holes;
    TopTools_IndexedMapOfShape used;
    for (TopExp_Explorer ex(body, TopAbs_FACE); ex.More(); ex.Next()) {
      const TopoDS_Face f = TopoDS::Face(ex.Current());
      gp_Ax1 ax;
      if (closing.Contains(f) || !concave_revolved(f, ax)) continue;
      used.Add(f);
      auto it = std::find_if(holes.begin(), holes.end(),
                             [&](const Hole& h) { return same_axis(h.axis, ax, tol); });
      if (it == holes.end()) holes.push_back({ax, {f}});
      else it->faces.push_back(f);
    }
    if (holes.empty()) return {};
    TopTools_IndexedDataMapOfShapeListOfShape edge_faces;
    TopExp::MapShapesAndAncestors(body, TopAbs_EDGE, TopAbs_FACE, edge_faces);
    for (auto& h : holes) {
      const size_t n_walls = h.faces.size();
      for (size_t i = 0; i < n_walls; ++i) {
        for (TopExp_Explorer e(h.faces[i], TopAbs_EDGE); e.More(); e.Next()) {
          for (const auto& adj : edge_faces.FindFromKey(e.Current())) {
            const TopoDS_Face g = TopoDS::Face(adj);
            if (used.Contains(g) || closing.Contains(g)) continue;
            if (!coaxial_floor(g, h.axis, tol)) continue;
            // A floor is inside the hole only if every edge borders this hole.
            bool inner = true;
            for (TopExp_Explorer ge(g, TopAbs_EDGE); ge.More() && inner; ge.Next()) {
              bool hits = false;
              for (const auto& a2 : edge_faces.FindFromKey(ge.Current())) {
                if (!a2.IsSame(g) &&
                    std::any_of(h.faces.begin(), h.faces.begin() + n_walls,
                                [&](const TopoDS_Face& w) { return w.IsSame(a2); })) hits = true;
              }
              inner = hits;
            }
            if (!inner) continue;
            used.Add(g);
            h.faces.push_back(g);
          }
        }
      }
    }

    // 2. Fill the holes and shell the filled body.
    BRepAlgoAPI_Defeaturing defeat;
    defeat.SetShape(body);
    for (const auto& h : holes) for (const auto& f : h.faces) defeat.AddFaceToRemove(f);
    defeat.SetRunParallel(true);
    defeat.Build();
    if (!defeat.IsDone()) return {};
    const TopoDS_Shape filled = defeat.Shape();
    if (!valid_solid(filled)) return {};
    TopTools_ListOfShape closing_filled;
    for (const auto& f : closing_faces) {
      if (defeat.IsDeleted(f)) {
        // Filling the holes can rebuild a face they pierced (REQ 1050): take
        // the filled body's faces on the same plane, facing the same way.
        BRepAdaptor_Surface os(TopoDS::Face(f));
        if (os.GetType() != GeomAbs_Plane) return {};
        const gp_Pln op = os.Plane();
        gp_Dir on = op.Axis().Direction();
        if (f.Orientation() == TopAbs_REVERSED) on.Reverse();
        const int before = closing_filled.Extent();
        for (TopExp_Explorer fx(filled, TopAbs_FACE); fx.More(); fx.Next()) {
          const TopoDS_Face g = TopoDS::Face(fx.Current());
          BRepAdaptor_Surface gs(g);
          if (gs.GetType() != GeomAbs_Plane) continue;
          gp_Dir gn = gs.Plane().Axis().Direction();
          if (g.Orientation() == TopAbs_REVERSED) gn.Reverse();
          if (gn.Dot(on) < 1.0 - 1e-9 || op.Distance(gs.Plane().Location()) > tol) continue;
          closing_filled.Append(g);
        }
        if (closing_filled.Extent() == before) return {};
        continue;
      }
      const TopTools_ListOfShape& mod = defeat.Modified(f);
      if (mod.IsEmpty()) closing_filled.Append(f);
      else for (const auto& m : mod) closing_filled.Append(m);
    }
    BRepOffsetAPI_MakeThickSolid mts;
    mts.MakeThickSolidByJoin(filled, closing_filled, thickness, tolerance);
    mts.Build();
    if (!mts.IsDone() || !valid_solid(mts.Shape())) return {};

    // 3. Hollow = filled − shell, minus the holes grown by the wall
    //    thickness; subtract from the body. Square tube shoulders first
    //    (SolidWorks parity); when a tube wall grazes another inner wall the
    //    intersection can leave a face BRepMesh can't triangulate, and the
    //    rounded shoulder (which stays clear of the graze) is used instead.
    const TopoDS_Shape cavity = BRepAlgoAPI_Cut(filled, mts.Shape());
    for (GeomAbs_JoinType join : {GeomAbs_Intersection, GeomAbs_Arc}) {
      TopTools_ListOfShape grown;
      for (const auto& h : holes) {
        TopoDS_Shape g = grown_hole(h, thickness, reach, tol, join);
        if (g.IsNull()) return {};
        grown.Append(g);
      }
      BRepAlgoAPI_Cut keep_tubes;
      TopTools_ListOfShape args;
      args.Append(cavity);
      keep_tubes.SetArguments(args);
      keep_tubes.SetTools(grown);
      keep_tubes.SetRunParallel(true);
      keep_tubes.Build();
      if (!keep_tubes.IsDone()) continue;
      const TopoDS_Shape result = BRepAlgoAPI_Cut(body, keep_tubes.Shape());
      if (valid_solid(result) && meshes(result)) return result;
    }
    return {};
  } catch (const Standard_Failure&) {
    return {};
  }
}
