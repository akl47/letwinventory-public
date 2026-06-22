// buildPattern / buildFeaturePattern / buildToolPattern — see op_pattern.hpp.
//
// Port of cad-kernel/src/ops/pattern.rs + cad-kernel/src/ops/feature_pattern.rs.
// The Rust kernel rode the opencascade-rs Shape helpers (translate_xyz /
// rotate_around / mirror_plane / union / subtract / union_glued / compound_of /
// clean); here we drop to raw OCCT 8.0:
//   PatternTransform → gp_Trsf, applied via BRepBuilderAPI_Transform
//   union  → BRepAlgoAPI_Fuse        (GlueShift for the glued additive fuse)
//   cut    → BRepAlgoAPI_Cut
//   compound_of → BRep_Builder + TopoDS_Compound
//   clean  → clean_unify (geom_io.hpp)

#include "op_pattern.hpp"

#include <stdexcept>
#include <string>
#include <vector>

#include "geom_io.hpp"

#include <TopoDS_Shape.hxx>
#include <TopoDS_Compound.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <BRep_Builder.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BOPAlgo_GlueEnum.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>

namespace kernel {
namespace {

// ── Transform: one PatternTransform json → gp_Trsf ──────────────────────────────
// Field names from protocol.rs PatternTransform (tag = "kind", lowercase):
//   translate {dx,dy,dz}
//   rotate    {origin[3], direction[3], angleRad}
//   mirror    {origin[3], normal[3]}
gp_Trsf trsf_from_json(const json& t) {
  const std::string kind = t.value("kind", "");
  gp_Trsf trsf;
  if (kind == "translate") {
    const double dx = t.at("dx").get<double>();
    const double dy = t.at("dy").get<double>();
    const double dz = t.at("dz").get<double>();
    trsf.SetTranslation(gp_Vec(dx, dy, dz));
  } else if (kind == "rotate") {
    const auto& o = t.at("origin");
    const auto& d = t.at("direction");
    const double angle = t.at("angleRad").get<double>();
    gp_Pnt origin(o.at(0).get<double>(), o.at(1).get<double>(), o.at(2).get<double>());
    gp_Dir dir(d.at(0).get<double>(), d.at(1).get<double>(), d.at(2).get<double>());
    trsf.SetRotation(gp_Ax1(origin, dir), angle);
  } else if (kind == "mirror") {
    const auto& o = t.at("origin");
    const auto& n = t.at("normal");
    gp_Pnt origin(o.at(0).get<double>(), o.at(1).get<double>(), o.at(2).get<double>());
    gp_Dir normal(n.at(0).get<double>(), n.at(1).get<double>(), n.at(2).get<double>());
    trsf.SetMirror(gp_Ax2(origin, normal));
  } else {
    throw std::runtime_error("pattern: unknown transform kind '" + kind + "'");
  }
  return trsf;
}

// Apply a single PatternTransform to `source`, returning the transformed copy.
// Matches pattern.rs::apply_transform. `Copy(true)` so each instance is an
// independent shape (mirror needs the copy to avoid sharing geometry).
TopoDS_Shape apply_transform(const TopoDS_Shape& source, const json& t) {
  BRepBuilderAPI_Transform xf(source, trsf_from_json(t), /*Copy=*/true);
  if (!xf.IsDone()) {
    throw std::runtime_error("pattern: failed to apply transform to source body");
  }
  return xf.Shape();
}

// A shape is "empty" (no material) when it has no vertices — mirrors
// feature_pattern.rs::is_empty. Used to drop null delta operands.
bool is_empty(const TopoDS_Shape& s) {
  TopExp_Explorer exp(s, TopAbs_VERTEX);
  return !exp.More();
}

// Booleans -------------------------------------------------------------------
TopoDS_Shape fuse(const TopoDS_Shape& a, const TopoDS_Shape& b) {
  BRepAlgoAPI_Fuse op(a, b);
  if (!op.IsDone()) throw std::runtime_error("pattern: fuse (union) failed");
  return op.Shape();
}

// Glued fuse — pattern/mirror copies meet the body (and each other) at
// exactly-coincident faces; GlueShift fuses without the general intersection
// that otherwise shaves slivers and under-reports volume (feature_pattern.rs
// union_glued).
TopoDS_Shape fuse_glued(const TopoDS_Shape& a, const TopoDS_Shape& b) {
  BRepAlgoAPI_Fuse op(a, b);
  op.SetGlue(BOPAlgo_GlueShift);
  if (!op.IsDone()) throw std::runtime_error("pattern: glued fuse failed");
  return op.Shape();
}

TopoDS_Shape cut(const TopoDS_Shape& a, const TopoDS_Shape& b) {
  BRepAlgoAPI_Cut op(a, b);
  if (!op.IsDone()) throw std::runtime_error("pattern: cut (subtract) failed");
  return op.Shape();
}

// Group transformed copies of `seed` into one compound (compound_of equivalent).
TopoDS_Compound compound_of_transformed(const TopoDS_Shape& seed, const json& transforms) {
  TopoDS_Compound compound;
  BRep_Builder builder;
  builder.MakeCompound(compound);
  for (const auto& t : transforms) {
    builder.Add(compound, apply_transform(seed, t));
  }
  return compound;
}

// Assemble the BuildPatternResult json from a finished shape.
// {brepBytes, faces, topology, solids} — matches protocol.rs BuildPatternResult.
json assemble_result(const TopoDS_Shape& result_shape,
                     const std::string& feature_id,
                     const char* op_name) {
  std::string brep = brep_to_base64(result_shape);
  if (brep.empty()) {
    throw std::runtime_error(std::string(op_name) +
                             ": result BRep serialization returned empty bytes — one or more "
                             "transforms may have produced a degenerate body (e.g. a mirror plane "
                             "passing through the source, or a 0°/coincident rotate), or the "
                             "pattern removed the entire body.");
  }
  Tessellated tess = tessellate_generic(result_shape, feature_id);
  json solids = decompose_into_solids(result_shape, feature_id);
  return json{
      {"brepBytes", std::move(brep)},
      {"faces", std::move(tess.faces)},
      {"topology", std::move(tess.topology)},
      {"solids", std::move(solids)},
  };
}

}  // namespace

// ── buildPattern ────────────────────────────────────────────────────────────────
// Apply N transforms to a source BREP, fuse the transformed copies (and
// optionally the source) into one body. Port of pattern.rs::build.
json op_buildPattern(const json& params) {
  const std::string feature_id = params.value("featureId", "f_anon");
  const json& transforms = params.value("transforms", json::array());
  const bool merge_with_source = params.value("mergeWithSource", true);

  if (!transforms.is_array() || transforms.empty()) {
    throw std::runtime_error(
        "buildPattern: no transforms supplied — a pattern with zero copies has nothing to do");
  }

  TopoDS_Shape source = brep_from_base64(params.at("aBrep").get<std::string>());

  std::vector<TopoDS_Shape> copies;
  copies.reserve(transforms.size());
  for (const auto& t : transforms) copies.push_back(apply_transform(source, t));

  TopoDS_Shape acc;
  if (merge_with_source) {
    // Fuse source with the first copy, then fold the rest in.
    acc = fuse(source, copies[0]);
    for (size_t i = 1; i < copies.size(); ++i) acc = fuse(acc, copies[i]);
  } else {
    // Skip the source; fuse copies among themselves into a free-floating body.
    acc = copies[0];
    for (size_t i = 1; i < copies.size(); ++i) acc = fuse(acc, copies[i]);
  }

  TopoDS_Shape result_shape = clean_unify(acc);
  return assemble_result(result_shape, feature_id, "buildPattern");
}

// ── buildFeaturePattern ───────────────────────────────────────────────────────
// Repeat a seed feature's geometry delta at N instances:
//   removed = before − after, added = after − before
//   body = (body − ⋃ Tᵢ(removed)) ∪ ⋃ Tᵢ(added)
// Port of feature_pattern.rs::build.
json op_buildFeaturePattern(const json& params) {
  const std::string feature_id = params.value("featureId", "f_anon");
  const json& transforms = params.value("transforms", json::array());

  if (!transforms.is_array() || transforms.empty()) {
    throw std::runtime_error(
        "buildFeaturePattern: no transforms supplied — a pattern with zero copies has nothing "
        "to do");
  }

  TopoDS_Shape after = brep_from_base64(params.at("afterBrep").get<std::string>());
  TopoDS_Shape body = brep_from_base64(params.at("bodyBrep").get<std::string>());

  // `before` is absent/empty for a body-seeding feature (nothing was removed;
  // the whole `after` is the added material).
  bool has_before = false;
  TopoDS_Shape before;
  if (params.contains("beforeBrep") && !params["beforeBrep"].is_null()) {
    const std::string b = params["beforeBrep"].get<std::string>();
    if (!b.empty()) {
      before = brep_from_base64(b);
      has_before = true;
    }
  }

  // Geometry delta.
  bool has_removed = false;
  TopoDS_Shape removed;
  TopoDS_Shape added;
  if (has_before) {
    removed = cut(before, after);
    added = cut(after, before);
    has_removed = true;
  } else {
    added = after;
  }

  // Drop empty deltas so we never feed OCCT booleans a null operand.
  if (has_removed && is_empty(removed)) has_removed = false;
  const bool added_nonempty = !is_empty(added);
  if (!has_removed && !added_nonempty) {
    throw std::runtime_error(
        "buildFeaturePattern: the seed feature produced no geometry change to repeat — check "
        "that the seed actually adds or removes material");
  }

  // Re-apply each delta with a SINGLE boolean over the compound of all copies
  // (one BOP resolves all coincident seams in one pass — folding instances
  // one-at-a-time re-tolerances the body per instance and shaves slivers).
  if (has_removed) {
    TopoDS_Compound tool = compound_of_transformed(removed, transforms);
    body = cut(body, tool);
  }
  if (added_nonempty) {
    TopoDS_Compound tool = compound_of_transformed(added, transforms);
    body = fuse_glued(body, tool);
  }

  TopoDS_Shape result_shape = clean_unify(body);
  return assemble_result(result_shape, feature_id, "buildFeaturePattern");
}

// ── buildToolPattern ──────────────────────────────────────────────────────────
// TRUE feature pattern for a tool-based seed: transform the seed's tool solid at
// each instance and fuse-or-cut it into the EVOLVING body (exact inter-feature
// boundaries). Port of feature_pattern.rs::build_tool_pattern.
json op_buildToolPattern(const json& params) {
  const std::string feature_id = params.value("featureId", "f_anon");
  const json& transforms = params.value("transforms", json::array());
  const bool do_fuse = params.value("fuse", false);

  if (!transforms.is_array() || transforms.empty()) {
    throw std::runtime_error("buildToolPattern: no transforms supplied");
  }

  TopoDS_Shape body = brep_from_base64(params.at("bodyBrep").get<std::string>());
  TopoDS_Shape tool = brep_from_base64(params.at("toolBrep").get<std::string>());
  if (is_empty(tool)) {
    throw std::runtime_error("buildToolPattern: seed tool is empty — nothing to repeat");
  }

  for (const auto& t : transforms) {
    TopoDS_Shape tool_i = apply_transform(tool, t);
    body = do_fuse ? fuse(body, tool_i) : cut(body, tool_i);
  }

  TopoDS_Shape result_shape = clean_unify(body);
  return assemble_result(result_shape, feature_id, "buildToolPattern");
}

}  // namespace kernel
