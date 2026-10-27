// buildRevolve / buildSweep — see op_revolve_sweep.hpp.
//
// Ported from cad-kernel/src/ops/revolve.rs (127 lines) and
// cad-kernel/src/ops/sweep.rs (155 lines). Geometry I/O (profile faces,
// plane parse, tessellation, topology, brep<->base64) is delegated to the
// shared geom_io.hpp contract — nothing here re-implements those.

#include "op_revolve_sweep.hpp"

#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

#include "geom_io.hpp"

#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepBuilderAPI_TransitionMode.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepAlgoAPI_Cut.hxx>

#include <GC_MakeArcOfCircle.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>

#include <BRep_Tool.hxx>
#include <BRepTools.hxx>
#include <TopExp_Explorer.hxx>
#include <gp_Ax1.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Iterator.hxx>

#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>

#include <Precision.hxx>
#include <Standard_Failure.hxx>

namespace kernel {
namespace {

constexpr double kPi = 3.14159265358979323846;

// Read a JSON [f64;3] into a gp_Pnt.
gp_Pnt point3(const json& a) {
  return gp_Pnt(a.at(0).get<double>(), a.at(1).get<double>(), a.at(2).get<double>());
}

// Read a JSON [f64;3] as a free vector.
gp_Vec vec3(const json& a) {
  return gp_Vec(a.at(0).get<double>(), a.at(1).get<double>(), a.at(2).get<double>());
}

// Extract the first (outer) wire of a face, used to feed the pipe builder
// (BRepOffsetAPI_MakePipeShell::Add takes a wire/shape profile).
TopoDS_Wire outer_wire_of(const TopoDS_Face& face) {
  for (TopoDS_Iterator it(face); it.More(); it.Next()) {
    if (it.Value().ShapeType() == TopAbs_WIRE) {
      return TopoDS::Wire(it.Value());
    }
  }
  throw std::runtime_error("sweep: profile face has no wire");
}

// Build the path wire from the typed PathEdge[] list. Lines map to a
// segment edge, three-point arcs to GC_MakeArcOfCircle, a lone circle to a
// closed gp_Circ edge. Mirrors revolve.rs/sweep.rs build_path_wire.
TopoDS_Wire build_path_wire(const json& edges) {
  // Single-circle path: closed loop, one OCCT edge.
  if (edges.size() == 1 && edges.at(0).value("kind", "") == "circle") {
    const json& e = edges.at(0);
    double radius = e.at("radius").get<double>();
    if (radius <= 1e-9) {
      throw std::runtime_error("sweep path: circle radius must be > 0");
    }
    gp_Pnt center = point3(e.at("center"));
    gp_Vec n = vec3(e.at("normal"));
    if (n.Magnitude() < Precision::Confusion()) {
      throw std::runtime_error("sweep path: circle normal is degenerate (zero-length)");
    }
    gp_Circ circ(gp_Ax2(center, gp_Dir(n)), radius);
    TopoDS_Edge circle_edge = BRepBuilderAPI_MakeEdge(circ).Edge();
    return BRepBuilderAPI_MakeWire(circle_edge).Wire();
  }

  BRepBuilderAPI_MakeWire wire_builder;
  for (std::size_t i = 0; i < edges.size(); ++i) {
    const json& e = edges.at(i);
    const std::string kind = e.value("kind", "");

    if (kind == "line") {
      gp_Pnt a = point3(e.at("start"));
      gp_Pnt b = point3(e.at("end"));
      if (a.SquareDistance(b) < 1e-18) {
        throw std::runtime_error("sweep path: line segment " + std::to_string(i) +
                                 " is zero-length");
      }
      TopoDS_Edge edge = BRepBuilderAPI_MakeEdge(a, b).Edge();
      wire_builder.Add(edge);
    } else if (kind == "arc") {
      gp_Pnt a = point3(e.at("start"));
      gp_Pnt m = point3(e.at("mid"));
      gp_Pnt b = point3(e.at("end"));
      // Collinear three points → degenerate (OCCT throws). cross = AB × AM.
      gp_Vec ab(a, b);
      gp_Vec am(a, m);
      if (ab.Crossed(am).SquareMagnitude() < 1e-12) {
        throw std::runtime_error("sweep path: arc " + std::to_string(i) +
                                 " has collinear start/mid/end (degenerate)");
      }
      GC_MakeArcOfCircle make_arc(a, m, b);
      if (!make_arc.IsDone()) {
        throw std::runtime_error("sweep path: arc " + std::to_string(i) +
                                 " could not be built (OCCT GC_MakeArcOfCircle failed)");
      }
      TopoDS_Edge edge = BRepBuilderAPI_MakeEdge(make_arc.Value()).Edge();
      wire_builder.Add(edge);
    } else if (kind == "circle") {
      throw std::runtime_error(
          "sweep path: circle segments only allowed as a single-edge closed path");
    } else {
      throw std::runtime_error("sweep path: unknown edge kind '" + kind + "'");
    }
  }

  if (!wire_builder.IsDone()) {
    throw std::runtime_error(
        "sweep path: edges do not form a connected wire (check chain order / "
        "coincident endpoints)");
  }
  return wire_builder.Wire();
}

// Sweep a single profile wire along the path via BRepOffsetAPI_MakePipeShell
// (the forgiving builder that tolerates sharp path corners, mirroring the
// Rust sweep_along_shell). Returns a capped solid. Throws on builder failure.
TopoDS_Shape sweep_wire_along(const TopoDS_Wire& profile, const TopoDS_Wire& path) {
  try {
    BRepOffsetAPI_MakePipeShell pipe(path);
    // At a G0 corner (e.g. an L-shaped two-line path) the default
    // Transformed transition TRANSLATES the section across the break
    // without rotating it — the post-corner leg sweeps a profile that
    // is coplanar with its own travel direction and degenerates into a
    // zero-thickness sheet. RightCorner mitres the junction (profile
    // rotated, legs extended to the bisector plane), matching how
    // SolidWorks/Onshape sweep sharp-cornered paths.
    pipe.SetTransitionMode(BRepBuilderAPI_RightCorner);
    pipe.Add(profile, Standard_False, Standard_False);
    pipe.Build();
    if (!pipe.IsDone()) {
      throw std::runtime_error("pipe builder did not complete");
    }
    if (!pipe.MakeSolid()) {
      throw std::runtime_error("pipe builder could not cap the swept shell into a solid");
    }
    return pipe.Shape();
  } catch (const Standard_Failure& f) {
    throw std::runtime_error(std::string("OCCT pipe failure: ") + f.GetMessageString());
  }
}

// Unwrap a face's surface to its toroidal basis (the pipe builder wraps the
// elbow torus in a rectangular trimmed surface); null when not a torus.
opencascade::handle<Geom_ToroidalSurface> torus_of(const TopoDS_Face& face,
                                                   TopLoc_Location& loc) {
  opencascade::handle<Geom_Surface> raw = BRep_Tool::Surface(face, loc);
  opencascade::handle<Geom_ToroidalSurface> torus =
      opencascade::handle<Geom_ToroidalSurface>::DownCast(raw);
  if (torus.IsNull()) {
    opencascade::handle<Geom_RectangularTrimmedSurface> trimmed =
        opencascade::handle<Geom_RectangularTrimmedSurface>::DownCast(raw);
    if (!trimmed.IsNull()) {
      torus = opencascade::handle<Geom_ToroidalSurface>::DownCast(trimmed->BasisSurface());
    }
  }
  return torus;
}

// A torus face with a DEGENERATE seam is the toxic layout: the profile
// circle's parameter origin faced the path bend's center of curvature, so the
// tube's seam landed exactly on the pinch point and collapsed to a null-curve
// edge. BRepMesh strip-meshes that face (elbow renders as a flat chamfer) and
// BRepOffset segfaults on it. With the seam anywhere else the same pinched
// elbow meshes and offsets fine.
bool has_degenerate_torus_seam(const TopoDS_Shape& shape) {
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
    TopoDS_Face face = TopoDS::Face(ex.Current());
    TopLoc_Location loc;
    if (torus_of(face, loc).IsNull()) continue;
    for (TopExp_Explorer ee(face, TopAbs_EDGE); ee.More(); ee.Next()) {
      const TopoDS_Edge& e = TopoDS::Edge(ee.Current());
      if (BRep_Tool::Degenerated(e) && BRepTools::IsReallyClosed(e, face)) return true;
    }
  }
  return false;
}

// Lone-circle profile wire with its parameter origin rotated by `rot` about
// the plane normal — moves the swept tube's seam away from a pinch.
TopoDS_Wire circle_wire_rotated(const Plane3& plane, const json& circle_edge, double rot) {
  const json& c = circle_edge.at("center");
  double r = circle_edge.at("radius").get<double>();
  double cx = c.at("x").get<double>(), cy = c.at("y").get<double>();
  gp_Pnt center = plane.origin.Translated(
      gp_Vec(plane.x_axis) * cx + gp_Vec(plane.y_axis) * cy);
  gp_Ax2 ax2(center, plane.normal);
  ax2.Rotate(gp_Ax1(center, plane.normal), rot);
  gp_Circ circ(ax2, r);
  return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(circ).Edge()).Wire();
}

// Last-resort heal when the seam can't be moved off the pinch: nudge the horn
// torus (major == minor to the last ulp) onto the SPINDLE side by 1e-12
// relative — BRepMesh handles that perfectly, so the elbow at least renders
// correctly. Offsetting such a face still fails (cleanly, post-cpp-13).
void heal_pinched_bends(const TopoDS_Shape& shape) {
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
    TopoDS_Face face = TopoDS::Face(ex.Current());
    TopLoc_Location loc;
    opencascade::handle<Geom_ToroidalSurface> torus = torus_of(face, loc);
    if (torus.IsNull()) continue;
    double major = torus->MajorRadius();
    double minor = torus->MinorRadius();
    if (std::fabs(major - minor) >= minor * 1e-9) continue;
    // Constructors accept spindle radii; only the Set* methods guard, so
    // build a fresh surface rather than mutating in place.
    opencascade::handle<Geom_ToroidalSurface> fresh =
        new Geom_ToroidalSurface(torus->Position(), minor * (1.0 - 1e-12), minor);
    replace_torus_surface(face, loc, fresh, BRep_Tool::Tolerance(face));
  }
}

// Sweep one profile loop along the path, avoiding the degenerate-seam layout:
// when the first build lands the tube seam on a pinch (bend radius == profile
// radius — Onshape-legal geometry), retry with the profile circle's parameter
// origin rotated so the seam moves off the pinch. Falls back to the spindle
// heal when rotation can't fix it (non-circle profiles, or pinch everywhere).
TopoDS_Shape sweep_profile_along(const Plane3& plane, const json& profile,
                                 const TopoDS_Wire& path) {
  TopoDS_Face face = build_profile_face(plane, profile, json::array());
  TopoDS_Shape shape = sweep_wire_along(outer_wire_of(face), path);
  if (!has_degenerate_torus_seam(shape)) return shape;

  if (profile.size() == 1 && profile.at(0).value("kind", "") == "circle") {
    for (double rot : {kPi / 2.0, kPi / 4.0}) {
      try {
        TopoDS_Shape candidate =
            sweep_wire_along(circle_wire_rotated(plane, profile.at(0), rot), path);
        if (!has_degenerate_torus_seam(candidate)) return candidate;
      } catch (const std::exception&) {
        // Rotation attempt failed to build — keep the original shape.
      }
    }
  }
  heal_pinched_bends(shape);
  return shape;
}

}  // namespace

json op_buildRevolve(const json& params) {
  const json& profile = params.at("profile");
  if (!profile.is_array() || profile.empty()) {
    throw std::runtime_error("revolve profile is empty");
  }
  const json holes = params.value("holes", json::array());
  const std::string feature_id = params.value("featureId", std::string("f_anon"));

  const json& axis_origin_j = params.at("axisOrigin");
  const json& axis_dir_j = params.at("axisDir");
  double dx = axis_dir_j.at(0).get<double>();
  double dy = axis_dir_j.at(1).get<double>();
  double dz = axis_dir_j.at(2).get<double>();
  double axis_dir_len = std::sqrt(dx * dx + dy * dy + dz * dz);
  if (axis_dir_len < 1e-9) {
    throw std::runtime_error(
        "revolve axis direction is degenerate (zero-length vector). Check that "
        "the sketched axis line has distinct endpoints.");
  }
  gp_Pnt axis_origin = point3(axis_origin_j);
  gp_Dir axis_dir(dx, dy, dz);  // gp_Dir normalizes internally
  gp_Ax1 axis(axis_origin, axis_dir);

  double angle_deg = params.at("angleDeg").get<double>();
  // Anything within 0.001° of 360 is a full revolve (2*pi radians). Unlike the
  // Rust binding (which has a no-angle "closed" constructor), OCCT's
  // BRepPrimAPI_MakeRevol with angle == 2*pi builds the closed body directly.
  bool is_full = std::fabs(angle_deg - 360.0) < 1.0e-3;
  double angle_rad = is_full ? (2.0 * kPi) : (angle_deg * kPi / 180.0);

  Plane3 plane = plane_from_json(params.at("plane"));
  TopoDS_Face face = build_profile_face(plane, profile, holes);

  TopoDS_Shape shape;
  try {
    BRepPrimAPI_MakeRevol revol(face, axis, angle_rad);
    revol.Build();
    if (!revol.IsDone()) {
      throw std::runtime_error("revol builder did not complete");
    }
    shape = revol.Shape();
  } catch (const Standard_Failure& f) {
    throw std::runtime_error(
        std::string("revolve failed: OCCT couldn't build the swept solid (") +
        f.GetMessageString() +
        "). Common causes: profile coincident with the rotation axis, axis "
        "crosses the profile interior, or degenerate / self-intersecting profile.");
  }
  if (shape.IsNull()) {
    throw std::runtime_error(
        "revolve failed: OCCT produced a null shape. Common causes: profile "
        "coincident with the rotation axis, or degenerate profile.");
  }

  Tessellated tess = tessellate_generic(shape, feature_id);
  std::string brep = brep_to_base64(shape);
  if (brep.empty()) {
    throw std::runtime_error(
        "buildRevolve: result BRep serialization returned empty bytes. Likely "
        "degenerate input (e.g. profile coincident with the axis).");
  }

  return json{
      {"brepBytes", brep},
      {"faces", tess.faces},
      {"topology", tess.topology},
  };
}

json op_buildSweep(const json& params) {
  const json& profile = params.at("profile");
  if (!profile.is_array() || profile.empty()) {
    throw std::runtime_error("sweep profile is empty");
  }
  const json& path_edges = params.at("pathEdges");
  if (!path_edges.is_array() || path_edges.empty()) {
    throw std::runtime_error("sweep path is empty");
  }
  const json holes = params.value("holes", json::array());
  const std::string feature_id = params.value("featureId", std::string("f_anon"));

  TopoDS_Wire path = build_path_wire(path_edges);
  Plane3 plane = plane_from_json(params.at("profilePlane"));

  // Outer profile (no holes here — holes are swept separately and subtracted,
  // mirroring sweep.rs which can't sweep a compound face directly).
  TopoDS_Shape shape;
  try {
    shape = sweep_profile_along(plane, profile, path);
  } catch (const std::exception& e) {
    throw std::runtime_error(
        std::string("sweep failed: OCCT couldn't build the swept solid (") +
        e.what() +
        "). Common causes: profile coplanar with the path's start tangent, path "
        "crosses itself, or the profile reaches/exceeds a path bend radius.");
  }

  // Subtract any hole-tubes one at a time: sweep each hole loop along the same
  // path to a tube-solid, then boolean-cut it from the running outer solid.
  if (holes.is_array()) {
    for (std::size_t h = 0; h < holes.size(); ++h) {
      const json& hole_edges = holes.at(h);
      TopoDS_Shape hole_solid;
      try {
        hole_solid = sweep_profile_along(plane, hole_edges, path);
      } catch (const std::exception& e) {
        throw std::runtime_error(
            std::string("sweep: hole couldn't be swept along the path (likely too "
                        "large for a path turn): ") + e.what());
      }
      try {
        BRepAlgoAPI_Cut cut(shape, hole_solid);
        cut.Build();
        if (!cut.IsDone()) {
          throw std::runtime_error("boolean cut did not complete");
        }
        shape = clean_unify(cut.Shape());
      } catch (const Standard_Failure& f) {
        throw std::runtime_error(std::string("sweep: hole subtraction failed: ") +
                                 f.GetMessageString());
      }
    }
  }

  if (shape.IsNull()) {
    throw std::runtime_error("buildSweep: result shape is null after sweep/subtract.");
  }

  Tessellated tess = tessellate_generic(shape, feature_id);
  std::string brep = brep_to_base64(shape);
  if (brep.empty()) {
    throw std::runtime_error(
        "buildSweep: result BRep serialization returned empty bytes. Likely "
        "degenerate input (profile coplanar with path tangent, or path with "
        "self-intersections).");
  }

  return json{
      {"brepBytes", brep},
      {"faces", tess.faces},
      {"topology", tess.topology},
  };
}

}  // namespace kernel
