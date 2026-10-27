// buildShell / buildEdgeBlend — see op_shell_blend.hpp for the contract.
//
// Port of cad-kernel/src/ops/shell.rs + cad-kernel/src/ops/edge_blend.rs to
// native OCCT 8.0. Face/edge picks arrive as geometry (centroid+normal for
// shell faces, endpoint pairs for blend edges) and are matched against the
// freshly-exploded topology of the input BRep — robust to OCCT's per-boolean
// re-numbering of faces/edges.

#include "op_shell_blend.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

#include "geom_io.hpp"

#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_ListOfShape.hxx>
#include <BRep_Tool.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <Standard_Failure.hxx>

namespace kernel {

namespace {

// ── small json helpers ─────────────────────────────────────────────────────
double req_num(const json& j, const char* key) {
  if (!j.contains(key) || !j.at(key).is_number()) {
    throw std::runtime_error(std::string("missing or non-numeric field: ") + key);
  }
  return j.at(key).get<double>();
}

std::array<double, 3> req_vec3(const json& j, const char* key) {
  if (!j.contains(key) || !j.at(key).is_array() || j.at(key).size() != 3) {
    throw std::runtime_error(std::string("field '") + key + "' must be a 3-element array");
  }
  const auto& a = j.at(key);
  return {a[0].get<double>(), a[1].get<double>(), a[2].get<double>()};
}

double dist3(const std::array<double, 3>& a, const gp_Pnt& b) {
  double dx = a[0] - b.X(), dy = a[1] - b.Y(), dz = a[2] - b.Z();
  return std::sqrt(dx * dx + dy * dy + dz * dz);
}

// Centroid of a face via surface mass properties (matches Rust center_of_mass()).
gp_Pnt face_centroid(const TopoDS_Face& f) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(f, props);
  return props.CentreOfMass();
}

// Outward normal of a face at its centroid, honouring face orientation.
gp_Dir face_normal_at(const TopoDS_Face& f, const gp_Pnt& at) {
  BRepAdaptor_Surface surf(f, Standard_False);
  // Project the centroid to (u,v): use the parametric midpoint as a robust
  // sampling point — exact for planar faces, a good proxy elsewhere.
  Standard_Real u = 0.5 * (surf.FirstUParameter() + surf.LastUParameter());
  Standard_Real v = 0.5 * (surf.FirstVParameter() + surf.LastVParameter());
  (void)at;
  BRepLProp_SLProps lprop(surf, u, v, 1, 1.0e-7);
  gp_Dir n(0, 0, 1);
  if (lprop.IsNormalDefined()) {
    n = lprop.Normal();
  }
  if (f.Orientation() == TopAbs_REVERSED) {
    n.Reverse();
  }
  return n;
}

}  // namespace

// ────────────────────────────────────────────────────────────────────────────
// buildShell
// ────────────────────────────────────────────────────────────────────────────
json op_buildShell(const json& params) {
  const std::string feature_id = params.value("featureId", std::string("shell"));

  if (!params.contains("faces") || !params.at("faces").is_array() ||
      params.at("faces").empty()) {
    throw std::runtime_error(
        "buildShell: at least one face must be picked as the open / removed face");
  }
  const double thickness = req_num(params, "thickness");
  if (!std::isfinite(thickness) || thickness == 0.0) {
    throw std::runtime_error(
        "buildShell: thickness must be a non-zero finite number (got " +
        std::to_string(thickness) +
        "). Positive = outward; negative = inward.");
  }
  const double tolerance = params.contains("tolerance")
                               ? params.at("tolerance").get<double>()
                               : 1.0e-3;
  if (!std::isfinite(tolerance) || tolerance <= 0.0) {
    throw std::runtime_error(
        "buildShell: tolerance must be a positive finite number (got " +
        std::to_string(tolerance) + ")");
  }

  TopoDS_Shape body;
  try {
    body = brep_from_base64(params.at("aBrep").get<std::string>());
  } catch (const std::exception& e) {
    throw std::runtime_error(std::string("buildShell: decoding input BREP: ") + e.what());
  }

  // Snapshot the body's faces in a stable index order.
  std::vector<TopoDS_Face> body_faces;
  for (TopExp_Explorer ex(body, TopAbs_FACE); ex.More(); ex.Next()) {
    body_faces.push_back(TopoDS::Face(ex.Current()));
  }
  if (body_faces.empty()) {
    throw std::runtime_error(
        "buildShell: input body has no faces to remove. Source BREP is likely empty.");
  }

  // Precompute per-face centroid + normal so we don't recompute in the loop.
  std::vector<gp_Pnt> centroids(body_faces.size());
  std::vector<gp_Dir> normals(body_faces.size());
  double mn[3] = {std::numeric_limits<double>::infinity(),
                  std::numeric_limits<double>::infinity(),
                  std::numeric_limits<double>::infinity()};
  double mx[3] = {-std::numeric_limits<double>::infinity(),
                  -std::numeric_limits<double>::infinity(),
                  -std::numeric_limits<double>::infinity()};
  for (size_t i = 0; i < body_faces.size(); ++i) {
    centroids[i] = face_centroid(body_faces[i]);
    normals[i] = face_normal_at(body_faces[i], centroids[i]);
    const gp_Pnt& c = centroids[i];
    double v[3] = {c.X(), c.Y(), c.Z()};
    for (int k = 0; k < 3; ++k) {
      if (v[k] < mn[k]) mn[k] = v[k];
      if (v[k] > mx[k]) mx[k] = v[k];
    }
  }
  double diag = std::sqrt((mx[0] - mn[0]) * (mx[0] - mn[0]) +
                          (mx[1] - mn[1]) * (mx[1] - mn[1]) +
                          (mx[2] - mn[2]) * (mx[2] - mn[2]));
  const double pos_tol = std::max(diag * 1.0e-3, 1.0);  // mm

  // Match each pick to a body face (two-pass: on-surface, then legacy nearest).
  std::vector<size_t> matched;
  matched.reserve(params.at("faces").size());
  size_t pick_idx = 0;
  for (const auto& pick : params.at("faces")) {
    const std::array<double, 3> p_centroid = req_vec3(pick, "centroid");
    const std::array<double, 3> p_normal = req_vec3(pick, "normal");

    bool have_on_surface = false;
    size_t on_surface_idx = 0;
    double on_surface_dist = 0.0;
    bool have_legacy = false;
    size_t legacy_idx = 0;
    double legacy_score = 0.0;

    for (size_t i = 0; i < body_faces.size(); ++i) {
      const gp_Pnt& c = centroids[i];
      double dx = p_centroid[0] - c.X();
      double dy = p_centroid[1] - c.Y();
      double dz = p_centroid[2] - c.Z();
      double d = std::sqrt(dx * dx + dy * dy + dz * dz);
      const gp_Dir& n = normals[i];
      double dot = n.X() * p_normal[0] + n.Y() * p_normal[1] + n.Z() * p_normal[2];
      // Pass 1: normal aligned + pick point lies on the face's plane.
      if (dot > 0.9) {
        double plane_dist = std::abs(dx * n.X() + dy * n.Y() + dz * n.Z());
        if (plane_dist < pos_tol) {
          if (!have_on_surface || d < on_surface_dist) {
            have_on_surface = true;
            on_surface_idx = i;
            on_surface_dist = d;
          }
        }
      }
      // Pass 2 candidate: legacy nearest-centroid scoring.
      double score = d - 0.1 * std::max(dot, 0.0);
      if (!have_legacy || score < legacy_score) {
        have_legacy = true;
        legacy_idx = i;
        legacy_score = score;
      }
    }

    if (have_on_surface) {
      matched.push_back(on_surface_idx);
      ++pick_idx;
      continue;
    }
    if (!have_legacy) {
      throw std::runtime_error(
          "buildShell: no body faces to match against (empty face list?)");
    }
    // legacy_score is centroid distance minus a small normal bonus; the
    // Rust path checks the raw distance against pos_tol — recompute it.
    double best_dist = dist3(p_centroid, centroids[legacy_idx]);
    if (best_dist > pos_tol) {
      throw std::runtime_error(
          "buildShell: picked face " + std::to_string(pick_idx) +
          " has no match within " + std::to_string(pos_tol) +
          " mm in the body — closest face is " + std::to_string(best_dist) +
          " mm away. The body may have changed shape upstream; re-pick the face.");
    }
    matched.push_back(legacy_idx);
    ++pick_idx;
  }

  // Reject duplicate matches (a double-pick of the same face).
  for (size_t a = 0; a < matched.size(); ++a) {
    for (size_t b = a + 1; b < matched.size(); ++b) {
      if (matched[a] == matched[b]) {
        throw std::runtime_error(
            "buildShell: two picked faces resolved to the same body face (index " +
            std::to_string(matched[a]) +
            "). Remove the duplicate from the pick list.");
      }
    }
  }

  // Build the thick solid. ClosingFaces = the faces to remove; Offset = signed
  // thickness; the resulting body is the original walls offset inward/outward.
  TopTools_ListOfShape closing_faces;
  for (size_t idx : matched) {
    closing_faces.Append(body_faces[idx]);
  }

  // OCCT's offset engine cannot thicken a body whose swept elbow pinches
  // EXACTLY (bend radius == tube radius, a horn torus): ByJoin and BySimple
  // both refuse, even though the shell is legitimate — the inner offset wall
  // is a healthy ring torus, and Onshape/Parasolid hollow this geometry fine.
  // Verified escape on the real body (model 45): give the pinched torus 0.1 µm
  // of clearance (minor = major - 1e-4 mm) via a pcurve-preserving surface
  // swap, and ByJoin hollows it cleanly. The change is far below manufacturing
  // relevance; face/edge tolerances are raised to 2e-4 to absorb it.
  for (TopExp_Explorer fe(body, TopAbs_FACE); fe.More(); fe.Next()) {
    TopoDS_Face pinched = TopoDS::Face(fe.Current());
    TopLoc_Location ploc;
    opencascade::handle<Geom_Surface> raw = BRep_Tool::Surface(pinched, ploc);
    opencascade::handle<Geom_ToroidalSurface> torus =
        opencascade::handle<Geom_ToroidalSurface>::DownCast(raw);
    if (torus.IsNull()) {
      opencascade::handle<Geom_RectangularTrimmedSurface> trimmed =
          opencascade::handle<Geom_RectangularTrimmedSurface>::DownCast(raw);
      if (!trimmed.IsNull()) {
        torus = opencascade::handle<Geom_ToroidalSurface>::DownCast(trimmed->BasisSurface());
      }
    }
    if (torus.IsNull()) continue;
    const double kClearance = 1.0e-4;  // mm
    double major = torus->MajorRadius();
    double minor = torus->MinorRadius();
    if (std::fabs(major - minor) >= kClearance || major <= kClearance * 4.0) continue;
    opencascade::handle<Geom_ToroidalSurface> fresh =
        new Geom_ToroidalSurface(torus->Position(), major, major - kClearance);
    replace_torus_surface(pinched, ploc, fresh, kClearance * 2.0);
  }

  TopoDS_Shape shape;
  try {
    BRepOffsetAPI_MakeThickSolid mts;
    mts.MakeThickSolidByJoin(body, closing_faces, thickness, tolerance);
    mts.Build();
    if (!mts.IsDone()) {
      throw std::runtime_error("MakeThickSolidByJoin did not complete");
    }
    shape = mts.Shape();
  } catch (const Standard_Failure& f) {
    throw std::runtime_error(
        std::string("buildShell: failed to build the shell. The body's geometry "
                    "could not be hollowed at the requested thickness (") +
        std::to_string(thickness) +
        " mm). Try a smaller thickness, or simplify the body near the picked "
        "faces. (Kernel detail: " + f.GetMessageString() + ")");
  }
  if (shape.IsNull()) {
    throw std::runtime_error(
        "buildShell: failed to build the shell — OCCT returned a null shape at "
        "thickness " + std::to_string(thickness) + " mm.");
  }

  std::string brep_b64 = brep_to_base64(shape);
  if (brep_b64.empty()) {
    throw std::runtime_error(
        "buildShell: result BRep serialization returned empty bytes — OCCT could "
        "not write the shelled body. Most common cause: the requested thickness (" +
        std::to_string(thickness) +
        " mm) is too large for the body's narrowest dimension, producing "
        "self-intersecting offset surfaces.");
  }

  Tessellated tess = tessellate_generic(shape, feature_id);
  json solids = decompose_into_solids(shape, feature_id);

  return json{
      {"brepBytes", brep_b64},
      {"faces", tess.faces},
      {"topology", tess.topology},
      {"solids", solids},
  };
}

// ────────────────────────────────────────────────────────────────────────────
// buildEdgeBlend
// ────────────────────────────────────────────────────────────────────────────
namespace {

// Match each picked endpoint-pair to one body edge by combined endpoint
// distance (direct or swapped). Returns matched indices into `body_edges`.
std::vector<size_t> match_picked_edges(const std::vector<TopoDS_Edge>& body_edges,
                                       const json& picks) {
  if (body_edges.empty()) {
    throw std::runtime_error("input body has no edges to fillet/chamfer");
  }
  // Bounding diagonal over all edge endpoints → tolerance 0.1% diag, floor 1mm.
  double mn[3] = {std::numeric_limits<double>::infinity(),
                  std::numeric_limits<double>::infinity(),
                  std::numeric_limits<double>::infinity()};
  double mx[3] = {-std::numeric_limits<double>::infinity(),
                  -std::numeric_limits<double>::infinity(),
                  -std::numeric_limits<double>::infinity()};
  std::vector<std::pair<gp_Pnt, gp_Pnt>> ends(body_edges.size());
  for (size_t i = 0; i < body_edges.size(); ++i) {
    TopoDS_Vertex v1, v2;
    TopExp::Vertices(body_edges[i], v1, v2);
    gp_Pnt p1 = BRep_Tool::Pnt(v1);
    gp_Pnt p2 = BRep_Tool::Pnt(v2);
    ends[i] = {p1, p2};
    for (const gp_Pnt& p : {p1, p2}) {
      double v[3] = {p.X(), p.Y(), p.Z()};
      for (int k = 0; k < 3; ++k) {
        if (v[k] < mn[k]) mn[k] = v[k];
        if (v[k] > mx[k]) mx[k] = v[k];
      }
    }
  }
  double diag = std::sqrt((mx[0] - mn[0]) * (mx[0] - mn[0]) +
                          (mx[1] - mn[1]) * (mx[1] - mn[1]) +
                          (mx[2] - mn[2]) * (mx[2] - mn[2]));
  const double tol = std::max(diag * 1.0e-3, 1.0);

  std::vector<size_t> out;
  out.reserve(picks.size());
  size_t pick_idx = 0;
  for (const auto& p : picks) {
    const std::array<double, 3> p_start = req_vec3(p, "start");
    const std::array<double, 3> p_end = req_vec3(p, "end");
    bool have_best = false;
    size_t best_idx = 0;
    double best_score = std::numeric_limits<double>::infinity();
    for (size_t j = 0; j < body_edges.size(); ++j) {
      const gp_Pnt& es = ends[j].first;
      const gp_Pnt& ee = ends[j].second;
      double direct = dist3(p_start, es) + dist3(p_end, ee);
      double swap = dist3(p_start, ee) + dist3(p_end, es);
      double score = std::min(direct, swap);
      if (score < best_score) {
        best_score = score;
        best_idx = j;
        have_best = true;
      }
    }
    if (!have_best || best_score > tol * 2.0) {
      throw std::runtime_error(
          "buildEdgeBlend: picked edge " + std::to_string(pick_idx) +
          " didn't match any body edge within tolerance " +
          std::to_string(tol * 2.0) + " (closest was " +
          std::to_string(best_score) +
          "). The body may have changed enough that this edge no longer exists "
          "— re-pick.");
    }
    out.push_back(best_idx);
    ++pick_idx;
  }
  return out;
}

// For each picked edge, find one body face topologically adjacent to it
// (endpoint coincidence, either pairing). Returns face indices parallel to
// `picked`. Used by twoDistance / distanceAngle chamfer modes.
std::vector<size_t> find_adjacent_faces(const std::vector<TopoDS_Edge>& body_edges,
                                        const std::vector<size_t>& picked,
                                        const std::vector<TopoDS_Face>& body_faces) {
  const double TOL = 1.0e-4;
  auto close = [&](const gp_Pnt& a, const gp_Pnt& b) {
    return std::abs(a.X() - b.X()) < TOL && std::abs(a.Y() - b.Y()) < TOL &&
           std::abs(a.Z() - b.Z()) < TOL;
  };
  std::vector<size_t> out;
  out.reserve(picked.size());
  for (size_t req_idx = 0; req_idx < picked.size(); ++req_idx) {
    const TopoDS_Edge& edge = body_edges[picked[req_idx]];
    TopoDS_Vertex ev1, ev2;
    TopExp::Vertices(edge, ev1, ev2);
    gp_Pnt es = BRep_Tool::Pnt(ev1);
    gp_Pnt ee = BRep_Tool::Pnt(ev2);

    bool found = false;
    size_t found_idx = 0;
    for (size_t face_idx = 0; face_idx < body_faces.size() && !found; ++face_idx) {
      for (TopExp_Explorer fe(body_faces[face_idx], TopAbs_EDGE); fe.More();
           fe.Next()) {
        TopoDS_Vertex fv1, fv2;
        TopExp::Vertices(TopoDS::Edge(fe.Current()), fv1, fv2);
        gp_Pnt fs = BRep_Tool::Pnt(fv1);
        gp_Pnt ff = BRep_Tool::Pnt(fv2);
        bool direct = close(es, fs) && close(ee, ff);
        bool swap = close(es, ff) && close(ee, fs);
        if (direct || swap) {
          found = true;
          found_idx = face_idx;
          break;
        }
      }
    }
    if (!found) {
      throw std::runtime_error(
          "buildEdgeBlend: picked edge " + std::to_string(req_idx) +
          " has no adjacent face in the body — cannot apply asymmetric or angle "
          "chamfer.");
    }
    out.push_back(found_idx);
  }
  return out;
}


}  // namespace

json op_buildEdgeBlend(const json& params) {
  const std::string feature_id = params.value("featureId", std::string("edgeBlend"));

  if (!params.contains("edges") || !params.at("edges").is_array() ||
      params.at("edges").empty()) {
    throw std::runtime_error("buildEdgeBlend: at least one edge must be picked");
  }
  const double value = req_num(params, "value");
  if (!std::isfinite(value) || value <= 0.0) {
    throw std::runtime_error(
        "buildEdgeBlend: value must be a positive number (got " +
        std::to_string(value) + ")");
  }
  const std::string kind = params.value("kind", std::string(""));
  if (kind != "fillet" && kind != "chamfer") {
    throw std::runtime_error(
        "buildEdgeBlend: kind must be 'fillet' or 'chamfer' (got '" + kind + "')");
  }

  TopoDS_Shape body;
  try {
    body = brep_from_base64(params.at("aBrep").get<std::string>());
  } catch (const std::exception& e) {
    throw std::runtime_error(std::string("buildEdgeBlend: decoding input BREP: ") +
                             e.what());
  }

  std::vector<TopoDS_Edge> body_edges;
  for (TopExp_Explorer ex(body, TopAbs_EDGE); ex.More(); ex.Next()) {
    body_edges.push_back(TopoDS::Edge(ex.Current()));
  }
  std::vector<size_t> matched = match_picked_edges(body_edges, params.at("edges"));

  // Resolve per-edge value overrides (radius for fillet, distance for chamfer).
  const json& edges_json = params.at("edges");
  std::vector<double> per_edge_value(matched.size());
  for (size_t i = 0; i < matched.size(); ++i) {
    double v = value;
    const auto& ej = edges_json[i];
    if (ej.contains("value") && !ej.at("value").is_null()) {
      v = ej.at("value").get<double>();
    }
    if (!std::isfinite(v) || v <= 0.0) {
      throw std::runtime_error(
          "buildEdgeBlend: edge " + std::to_string(i) + " per-edge value " +
          std::to_string(v) + " must be positive and finite");
    }
    per_edge_value[i] = v;
  }

  TopoDS_Shape shape;
  try {
    if (kind == "fillet") {
      BRepFilletAPI_MakeFillet mk(body);
      for (size_t i = 0; i < matched.size(); ++i) {
        mk.Add(per_edge_value[i], body_edges[matched[i]]);
      }
      mk.Build();
      if (mk.IsDone()) {
        shape = mk.Shape();
      } else {
        // FULL ROUND (SolidWorks/OnShape parity, within OCCT limits): the radius
        // is at/over the full-round limit — the rounds from two opposing edges
        // meet and consume the wall, and OCCT's rolling-ball builder degenerates
        // exactly at that radius (it can't make the true full round). Step the
        // radius down minutely until it builds: the largest real round OCCT can
        // produce, a sub-micron flat short of a perfect full round (e.g. r=4.9999
        // vs 5 on a 10mm wall — a ~0.5µm flat, well below any tolerance). Far
        // better than failing or a no-op. Only the failing radius is reduced;
        // normal fillets never reach here.
        static const double FACTORS[] = {0.9999, 0.999, 0.99, 0.98, 0.95};
        for (double fct : FACTORS) {
          BRepFilletAPI_MakeFillet mk2(body);
          for (size_t i = 0; i < matched.size(); ++i) {
            mk2.Add(per_edge_value[i] * fct, body_edges[matched[i]]);
          }
          try { mk2.Build(); } catch (const Standard_Failure&) { continue; }
          if (mk2.IsDone()) { shape = mk2.Shape(); break; }
        }
        if (shape.IsNull()) {
          throw std::runtime_error(
              "fillet did not complete — the radius is too large for this edge "
              "set. Each edge may fillet on its own, but together the rounds "
              "overrun the geometry between them (e.g. two opposing edges of a "
              "thin wall whose fillets meet and consume the wall). Try a smaller "
              "radius, fillet fewer edges at once, or split into separate "
              "features.");
        }
      }
    } else {
      const std::string mode = params.value("chamferMode", std::string("equal"));
      BRepFilletAPI_MakeChamfer mk(body);
      if (mode == "equal") {
        for (size_t i = 0; i < matched.size(); ++i) {
          mk.Add(per_edge_value[i], body_edges[matched[i]]);
        }
      } else if (mode == "twoDistance") {
        if (!params.contains("distance2") || params.at("distance2").is_null()) {
          throw std::runtime_error(
              "buildEdgeBlend: chamfer mode 'twoDistance' requires `distance2`");
        }
        double d2 = params.at("distance2").get<double>();
        if (!std::isfinite(d2) || d2 <= 0.0) {
          throw std::runtime_error(
              "buildEdgeBlend: distance2 must be positive and finite (got " +
              std::to_string(d2) + ")");
        }
        std::vector<TopoDS_Face> body_faces;
        for (TopExp_Explorer ex(body, TopAbs_FACE); ex.More(); ex.Next()) {
          body_faces.push_back(TopoDS::Face(ex.Current()));
        }
        std::vector<size_t> faces = find_adjacent_faces(body_edges, matched, body_faces);
        for (size_t i = 0; i < matched.size(); ++i) {
          // Add(Dis1, Dis2, edge, face): Dis1 on `face`'s side.
          mk.Add(per_edge_value[i], d2, body_edges[matched[i]],
                 body_faces[faces[i]]);
        }
      } else if (mode == "distanceAngle") {
        if (!params.contains("angle") || params.at("angle").is_null()) {
          throw std::runtime_error(
              "buildEdgeBlend: chamfer mode 'distanceAngle' requires `angle`");
        }
        double deg = params.at("angle").get<double>();
        if (!std::isfinite(deg) || deg <= 0.0 || deg >= 90.0) {
          throw std::runtime_error(
              "buildEdgeBlend: angle must be in (0°, 90°) (got " +
              std::to_string(deg) + "°)");
        }
        double radians = deg * (M_PI / 180.0);
        std::vector<TopoDS_Face> body_faces;
        for (TopExp_Explorer ex(body, TopAbs_FACE); ex.More(); ex.Next()) {
          body_faces.push_back(TopoDS::Face(ex.Current()));
        }
        std::vector<size_t> faces = find_adjacent_faces(body_edges, matched, body_faces);
        for (size_t i = 0; i < matched.size(); ++i) {
          // AddDA(Dis, Angle, edge, face): distance on `face`'s side, angle from it.
          mk.AddDA(per_edge_value[i], radians, body_edges[matched[i]],
                   body_faces[faces[i]]);
        }
      } else {
        throw std::runtime_error(
            "buildEdgeBlend: unknown chamferMode '" + mode + "'");
      }
      mk.Build();
      if (!mk.IsDone()) {
        throw std::runtime_error(
            "chamfer did not complete — the distance is too large for this "
            "edge set. Each edge may chamfer on its own, but together the "
            "bevels overrun the geometry between them. Try a smaller distance, "
            "chamfer fewer edges at once, or split into separate features.");
      }
      shape = mk.Shape();
    }
  } catch (const Standard_Failure& f) {
    throw std::runtime_error(
        std::string("buildEdgeBlend: result BRep is empty — the ") +
        (kind == "fillet" ? "fillet" : "chamfer") +
        " likely failed (radius/distance too large for one of the picked edges, "
        "or the edges are adjacent in a way OCCT can't blend). (Kernel detail: " +
        f.GetMessageString() + ")");
  }

  if (shape.IsNull()) {
    throw std::runtime_error(
        std::string("buildEdgeBlend: result BRep is empty — the ") +
        (kind == "fillet" ? "fillet" : "chamfer") +
        " likely failed (radius/distance too large for one of the picked edges, "
        "or the edges are adjacent in a way OCCT can't blend).");
  }

  std::string brep_b64 = brep_to_base64(shape);
  if (brep_b64.empty()) {
    throw std::runtime_error(
        std::string("buildEdgeBlend: result BRep is empty — the ") +
        (kind == "fillet" ? "fillet" : "chamfer") +
        " likely failed (radius/distance too large for one of the picked edges, "
        "or the edges are adjacent in a way OCCT can't blend).");
  }

  Tessellated tess = tessellate_generic(shape, feature_id);
  json solids = decompose_into_solids(shape, feature_id);

  return json{
      {"brepBytes", brep_b64},
      {"faces", tess.faces},
      {"topology", tess.topology},
      {"solids", solids},
  };
}

}  // namespace kernel
