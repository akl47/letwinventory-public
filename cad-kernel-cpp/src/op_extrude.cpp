// buildExtrude / buildLoft — native OCCT 8.0 port of cad-kernel/src/ops/extrude.rs.
//
// Op-level logic only; all profile/tessellation/topology/BRep work is delegated
// to the shared contract in geom_io.hpp.

#include "op_extrude.hpp"

#include <cmath>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BOPAlgo_GlueEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <ShapeAnalysis.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>

#include "geom_io.hpp"

namespace kernel {
namespace {

using nlohmann::json;

// Mirror the Rust "through-all" extent constants. The boolean subtract caps the
// prism at the body's real surface, so this just needs to be reliably larger
// than any real model.
constexpr double THROUGH_ALL_LEN = 1.0e4;
constexpr double THROUGH_ALL_FALLBACK = 1.0e4;

// ── small json helpers ────────────────────────────────────────────────────────

double jnum(const json& j, const char* key, double def) {
  if (!j.contains(key) || j.at(key).is_null()) return def;
  return j.at(key).get<double>();
}

std::string jstr(const json& j, const char* key, const std::string& def) {
  if (!j.contains(key) || j.at(key).is_null()) return def;
  return j.at(key).get<std::string>();
}

bool jbool(const json& j, const char* key, bool def) {
  if (!j.contains(key) || j.at(key).is_null()) return def;
  return j.at(key).get<bool>();
}

// Reads a Plane3 {origin,xAxis,yAxis,normal} into the shared contract type by
// delegating to plane_from_json (geom_io). Kept separate so we can pull the
// origin/normal as plain vectors for the offset + naming math.
Plane3 read_plane(const json& jplane) { return plane_from_json(jplane); }

gp_Pnt translated_origin(const gp_Pnt& origin, const gp_Dir& normal, double along) {
  return gp_Pnt(origin.X() + normal.X() * along, origin.Y() + normal.Y() * along,
                origin.Z() + normal.Z() * along);
}

// Build a single-direction prism: profile (+holes) → planar face → linear sweep
// by `extrude_vec`. Mirrors the Rust `build_prism` (which branched on holes; the
// shared build_profile_face already folds holes in, so one path covers both).
TopoDS_Shape build_prism(const Plane3& plane, const json& profile, const json& holes,
                         const gp_Vec& extrude_vec) {
  TopoDS_Face face = build_profile_face(plane, profile, holes);
  BRepPrimAPI_MakePrism mk(face, extrude_vec);
  mk.Build();
  if (!mk.IsDone()) {
    throw std::runtime_error("extrude: BRepPrimAPI_MakePrism failed to build the prism");
  }
  return mk.Shape();
}

// A ∪ B via OCCT fuse. `glue` enables BOPAlgo_GlueShift for the coincident-face
// case (the shared start-plane face when stacking direction-2 / multiple kept
// solids), which lets OCCT skip the general face-face intersection along that
// plane. Falls back through cleanly when faces aren't actually coincident.
TopoDS_Shape fuse(const TopoDS_Shape& a, const TopoDS_Shape& b, bool glue) {
  BRepAlgoAPI_Fuse op(a, b);
  if (glue) op.SetGlue(BOPAlgo_GlueShift);
  op.Build();
  if (op.HasErrors()) {
    throw std::runtime_error("extrude: boolean fuse failed");
  }
  return op.Shape();
}

// A − B via OCCT cut.
TopoDS_Shape cut(const TopoDS_Shape& a, const TopoDS_Shape& b) {
  BRepAlgoAPI_Cut op(a, b);
  op.Build();
  if (op.HasErrors()) {
    throw std::runtime_error("extrude: boolean cut failed");
  }
  return op.Shape();
}

// Every TopAbs_SOLID under `shape`, each wrapped as its own TopoDS_Shape.
std::vector<TopoDS_Shape> solids_of(const TopoDS_Shape& shape) {
  std::vector<TopoDS_Shape> out;
  for (TopExp_Explorer ex(shape, TopAbs_SOLID); ex.More(); ex.Next()) {
    out.push_back(ex.Current());
  }
  return out;
}

// Min / max projection of a shape's topology vertices onto `dir`, relative to
// `origin`. Uses the shared extract_topology so it matches what the result
// payload reports (and so curved far surfaces are handled — magnitude is taken
// from real geometry, not assumed from the prism length).
void proj_extent(const TopoDS_Shape& shape, const gp_Pnt& origin, const gp_Dir& dir,
                 double& min_proj, double& max_proj) {
  min_proj = std::numeric_limits<double>::max();
  max_proj = std::numeric_limits<double>::lowest();
  json topo = extract_topology(shape);
  for (const auto& v : topo.at("vertices")) {
    const auto& p = v.at("position");
    double px = p[0].get<double>() - origin.X();
    double py = p[1].get<double>() - origin.Y();
    double pz = p[2].get<double>() - origin.Z();
    double d = px * dir.X() + py * dir.Y() + pz * dir.Z();
    if (d < min_proj) min_proj = d;
    if (d > max_proj) max_proj = d;
  }
}

// Assemble the {brepBytes, faces, topology} result shared by extrude + loft.
json make_result(const TopoDS_Shape& shape, const gp_Pnt& plane_origin,
                 const gp_Dir& plane_normal, double signed_distance,
                 const std::string& feature_id) {
  std::string brep = brep_to_base64(shape);
  if (brep.empty()) {
    throw std::runtime_error(
        "extrude: result BRep serialization returned empty bytes — the solid is "
        "degenerate (the profile may not enclose a valid region).");
  }
  Tessellated tess =
      tessellate_named(shape, plane_origin, plane_normal, signed_distance, feature_id);
  return json{{"brepBytes", brep}, {"faces", tess.faces}, {"topology", tess.topology}};
}

}  // namespace

// ── buildExtrude ────────────────────────────────────────────────────────────

nlohmann::json op_buildExtrude(const nlohmann::json& params) {
  const std::string feature_id = jstr(params, "featureId", "f_anon");
  const json& profile = params.at("profile");
  const json holes = params.contains("holes") ? params.at("holes") : json::array();
  Plane3 plane = read_plane(params.at("plane"));

  // "Up To Body" / "Up To Next": delegate to the dedicated builder when an
  // untilBrep or non-empty untilBreps is present.
  const bool has_until_brep = params.contains("untilBrep") && !params.at("untilBrep").is_null();
  const bool has_until_breps =
      params.contains("untilBreps") && !params.at("untilBreps").is_null() &&
      !params.at("untilBreps").empty();

  if (has_until_brep || has_until_breps) {
    // ── build_up_to_body ──────────────────────────────────────────────────
    // Collect every target body (the single Up-To-Body + all Up-To-Next
    // upstream bodies). All are subtracted; the kept start-side piece caps at
    // the nearest.
    std::vector<TopoDS_Shape> targets;
    if (has_until_brep) {
      targets.push_back(brep_from_base64(params.at("untilBrep").get<std::string>()));
    }
    if (has_until_breps) {
      for (const auto& b64 : params.at("untilBreps")) {
        targets.push_back(brep_from_base64(b64.get<std::string>()));
      }
    }
    if (targets.empty()) {
      throw std::runtime_error("up-to: no target body provided");
    }

    gp_Dir plane_normal = plane.normal;  // already unit-length
    // Extrude direction along the normal, reversed when `flipped`.
    const double dir_sign = jbool(params, "flipped", false) ? -1.0 : 1.0;
    gp_Dir dir(plane_normal.X() * dir_sign, plane_normal.Y() * dir_sign,
               plane_normal.Z() * dir_sign);

    const double start_offset = jnum(params, "startOffset", 0.0);
    gp_Pnt sketch_origin = plane.origin;
    gp_Pnt start_origin = translated_origin(sketch_origin, plane_normal, start_offset);

    // Start-plane: sketch plane translated by start_offset along the normal.
    Plane3 start_plane = plane;
    start_plane.origin = start_origin;

    // Direction sanity check: at least one target must lie on the extrude side.
    // Magnitude is NOT used to size the prism (a curved far surface can reach
    // past every vertex), only the sign.
    double d_far_hint = std::numeric_limits<double>::lowest();
    for (const auto& t : targets) {
      json topo = extract_topology(t);
      for (const auto& v : topo.at("vertices")) {
        const auto& p = v.at("position");
        double px = p[0].get<double>() - start_origin.X();
        double py = p[1].get<double>() - start_origin.Y();
        double pz = p[2].get<double>() - start_origin.Z();
        double d = px * dir.X() + py * dir.Y() + pz * dir.Z();
        if (d > d_far_hint) d_far_hint = d;
      }
    }
    if (d_far_hint <= 1e-6) {
      throw std::runtime_error(
          "Up to Body/Next: no target body lies in the extrude direction. Try Reverse.");
    }

    // Through-all prism (the codebase "infinity" extent); the boolean subtract
    // caps it at each body's real surface. Subtracting EVERY target means the
    // kept start-side piece stops at the nearest one ("Up To Next" behaviour).
    gp_Vec through_vec(dir.X() * THROUGH_ALL_LEN, dir.Y() * THROUGH_ALL_LEN,
                       dir.Z() * THROUGH_ALL_LEN);
    TopoDS_Shape result_shape = build_prism(start_plane, profile, holes, through_vec);
    for (const auto& t : targets) {
      result_shape = cut(result_shape, t);
    }

    // Keep the solid piece(s) adjacent to the start plane (min projection ≈ 0).
    const double tol = 1.0e-3;
    std::vector<TopoDS_Shape> kept;
    for (const auto& solid : solids_of(result_shape)) {
      double min_proj, max_proj;
      proj_extent(solid, start_origin, dir, min_proj, max_proj);
      if (min_proj <= tol) kept.push_back(solid);
    }
    if (kept.empty()) {
      throw std::runtime_error(
          "Up to Body: could not build a solid up to the target body. Re-pick the target.");
    }
    TopoDS_Shape result = kept.front();
    for (std::size_t i = 1; i < kept.size(); ++i) {
      result = fuse(result, kept[i], /*glue=*/true);
    }

    // Guard: a kept piece still running the full through-all length means the
    // boolean never capped it — the profile missed (or only partly covers) the
    // body. Computed on the up-to piece ALONE, before any Direction-2 material.
    {
      double min_proj, max_proj;
      proj_extent(result, start_origin, dir, min_proj, max_proj);
      if (max_proj > THROUGH_ALL_LEN - 1.0) {
        throw std::runtime_error(
            "Up to Body: the profile does not fully land on the target body. The whole "
            "profile must lie within the body's footprint along the extrude direction.");
      }
    }

    // Direction 2 (optional): a blind / through-all prism growing the OPPOSITE
    // way from the up-to direction, fused in. The shared start-plane face
    // becomes internal after the fuse (glued, since the faces are coincident).
    if (params.contains("direction2") && !params.at("direction2").is_null()) {
      const json& d2 = params.at("direction2");
      const std::string kind = jstr(d2, "kind", "blind");
      const double d2_mag = (kind == "throughAll") ? THROUGH_ALL_FALLBACK : jnum(d2, "distance", 0.0);
      if (std::fabs(d2_mag) > 1e-9) {
        gp_Vec d2_vec(dir.X() * (-d2_mag), dir.Y() * (-d2_mag), dir.Z() * (-d2_mag));
        TopoDS_Shape d2_prism = build_prism(start_plane, profile, holes, d2_vec);
        result = fuse(result, d2_prism, /*glue=*/true);
      }
    }

    // Heal the up-to result: merge coplanar / co-cylindrical faces and drop the
    // redundant seam edges the through-all subtraction + Direction-2 fuse leave
    // behind. clean preserves geometry/extent so the max_proj naming stays valid.
    result = clean_unify(result);

    // Naming: original sketch-plane origin + signed actual capped extent.
    double min_proj, max_proj;
    proj_extent(result, start_origin, dir, min_proj, max_proj);
    const double signed_distance = dir_sign * max_proj;
    return make_result(result, sketch_origin, plane_normal, signed_distance, feature_id);
  }

  // ── blind / direction-2 (folded single prism) ─────────────────────────────
  gp_Dir plane_normal = plane.normal;
  const double distance = jnum(params, "distance", 0.0);
  const bool flipped = jbool(params, "flipped", false);
  const double start_offset = jnum(params, "startOffset", 0.0);

  // Resolve direction 2's signed magnitude up front so we can fold it into a
  // SINGLE prism rather than fusing two (which would leave the shared start face
  // as a visible internal parting ring). Translate the start back by d2 and
  // extrude the whole (d1 + d2) length.
  double d2_magnitude = 0.0;
  if (params.contains("direction2") && !params.at("direction2").is_null()) {
    const json& d2 = params.at("direction2");
    if (jstr(d2, "kind", "blind") == "throughAll") {
      d2_magnitude = THROUGH_ALL_FALLBACK;
    } else {
      d2_magnitude = jnum(d2, "distance", 0.0);
    }
  }

  const double d1_signed = flipped ? -distance : distance;
  const double d2_signed = flipped ? d2_magnitude : -d2_magnitude;
  const double effective_start = start_offset + d2_signed;
  const double total_signed = d1_signed - d2_signed;  // |d1| + |d2| with d1's sign

  gp_Pnt sketch_origin = plane.origin;
  Plane3 offset_plane = plane;
  if (effective_start != 0.0) {
    offset_plane.origin = translated_origin(sketch_origin, plane_normal, effective_start);
  }

  gp_Vec extrude_vec(plane_normal.X() * total_signed, plane_normal.Y() * total_signed,
                     plane_normal.Z() * total_signed);
  TopoDS_Shape shape = build_prism(offset_plane, profile, holes, extrude_vec);

  // Naming references the original sketch-plane origin + direction-1's signed
  // distance, so persistent ids stay stable across saves.
  return make_result(shape, sketch_origin, plane_normal, d1_signed, feature_id);
}

// ── buildLoft ───────────────────────────────────────────────────────────────

nlohmann::json op_buildLoft(const nlohmann::json& params) {
  const std::string feature_id = jstr(params, "featureId", "f_anon");
  const json& sections = params.at("sections");
  if (sections.size() < 2) {
    throw std::runtime_error("loft needs at least 2 profile sections, got " +
                             std::to_string(sections.size()));
  }

  // ThruSections lofts a solid through each section's OUTER wire. Build each
  // section's planar face via the same path extrude uses, then take its outer
  // wire. (holes aren't supported in loft — mirrors the Rust signature, which
  // only carries `profile` per LoftSection.)
  BRepOffsetAPI_ThruSections thru(/*isSolid=*/Standard_True, /*ruled=*/Standard_False);
  for (std::size_t i = 0; i < sections.size(); ++i) {
    const json& sec = sections[i];
    Plane3 plane = read_plane(sec.at("plane"));
    TopoDS_Face face = build_profile_face(plane, sec.at("profile"), json::array());
    TopoDS_Wire outer = ShapeAnalysis::OuterWire(face);
    if (outer.IsNull()) {
      throw std::runtime_error("loft section " + std::to_string(i) +
                               ": could not extract an outer wire from the profile face");
    }
    thru.AddWire(outer);
  }
  thru.Build();
  if (!thru.IsDone()) {
    throw std::runtime_error("loft: BRepOffsetAPI_ThruSections failed to build the solid");
  }
  TopoDS_Shape shape = thru.Shape();

  // Naming / orientation reference the FIRST section's plane, signed_distance 0
  // (loft has no single extrude axis — every face classifies as a side).
  Plane3 p0 = read_plane(sections[0].at("plane"));
  return make_result(shape, p0.origin, p0.normal, 0.0, feature_id);
}

}  // namespace kernel
