// See op_boolean.hpp for the contract. Implements buildBoolean (Fuse/Cut/Common),
// bodyVolume, exportStl, exportStep against OCCT 8.0 + the geom_io.hpp helpers.

#include "op_boolean.hpp"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include <unistd.h>

#include <BRep_Builder.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_StepModelType.hxx>
#include <STEPControl_Writer.hxx>
#include <StlAPI_Writer.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>

#include "geom_io.hpp"

namespace kernel {
using nlohmann::json;

namespace {

// Standard base64 (RFC 4648) — matches the Rust kernel's `base64 STANDARD`
// engine used for the STL payload. geom_io's brep_to_base64 takes a Shape, not
// raw file bytes, so the export ops need this byte-level encoder.
std::string bytes_to_base64(const std::vector<unsigned char>& in) {
  static const char* T =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((in.size() + 2) / 3) * 4);
  size_t i = 0;
  for (; i + 2 < in.size(); i += 3) {
    unsigned v = (in[i] << 16) | (in[i + 1] << 8) | in[i + 2];
    out.push_back(T[(v >> 18) & 0x3F]);
    out.push_back(T[(v >> 12) & 0x3F]);
    out.push_back(T[(v >> 6) & 0x3F]);
    out.push_back(T[v & 0x3F]);
  }
  if (i < in.size()) {
    unsigned v = in[i] << 16;
    bool two = (i + 1 < in.size());
    if (two) v |= in[i + 1] << 8;
    out.push_back(T[(v >> 18) & 0x3F]);
    out.push_back(T[(v >> 12) & 0x3F]);
    out.push_back(two ? T[(v >> 6) & 0x3F] : '=');
    out.push_back('=');
  }
  return out;
}

// Unique temp path per process so concurrent export RPCs don't clobber.
std::string temp_path(const char* tag, const char* ext) {
  static std::atomic<unsigned long> counter{0};
  std::ostringstream os;
  const char* dir = std::getenv("TMPDIR");
  os << (dir && *dir ? dir : "/tmp") << "/cad-export-" << ::getpid() << '-' << tag
     << '-' << counter.fetch_add(1) << '.' << ext;
  return os.str();
}

std::string require_string(const json& params, const char* key) {
  if (!params.contains(key) || !params[key].is_string()) {
    throw std::runtime_error(std::string("buildBoolean: missing string field '") + key + "'");
  }
  return params[key].get<std::string>();
}

// Per-op stage timing (REQ 880). Lap() returns ms since the previous lap.
// One [kernel-timing] stderr line per op → visible via docker logs, greppable.
struct StageTimer {
  std::chrono::steady_clock::time_point t0 = std::chrono::steady_clock::now();
  std::chrono::steady_clock::time_point last = t0;
  long lap() {
    auto now = std::chrono::steady_clock::now();
    long ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - last).count();
    last = now;
    return ms;
  }
  long total() const {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - t0).count();
  }
};

// Combine the export operand BReps into a single shape: one body passes through
// directly; multiple bodies become a cleaned compound. Mirrors the Rust
// `export_stl` / `export_step` operand assembly.
TopoDS_Shape assemble_export_shape(const json& params) {
  if (!params.contains("breps") || !params["breps"].is_array() ||
      params["breps"].empty()) {
    throw std::runtime_error("no bodies to export");
  }
  const auto& breps = params["breps"];
  std::vector<TopoDS_Shape> shapes;
  shapes.reserve(breps.size());
  for (size_t i = 0; i < breps.size(); ++i) {
    if (!breps[i].is_string()) {
      throw std::runtime_error("export: body " + std::to_string(i) + " BRep is not a string");
    }
    try {
      shapes.push_back(brep_from_base64(breps[i].get<std::string>()));
    } catch (const std::exception& e) {
      throw std::runtime_error("deserialize body " + std::to_string(i) + " BRep: " + e.what());
    }
  }
  if (shapes.size() == 1) return shapes[0];

  TopoDS_Compound compound;
  BRep_Builder builder;
  builder.MakeCompound(compound);
  for (const auto& s : shapes) builder.Add(compound, s);
  return clean_unify(compound);
}

}  // namespace

// buildBoolean — Fuse / Cut / Common, then clean_unify, then tessellate +
// decompose. The Rust soft-clean-timeout / GlueShift fuse path is intentionally
// dropped: we run direct OCCT here.
json op_buildBoolean(const json& params) {
  StageTimer timer;
  std::string feature_id =
      params.value("featureId", std::string("f_anon"));
  std::string op = require_string(params, "op");
  std::string a_brep = require_string(params, "aBrep");
  std::string b_brep = require_string(params, "bBrep");
  // "all" (default) = top-level faces/topology AND per-solid tessellation.
  // "solids" = per-solid only — the compose pipeline consumes solids[].faces
  // exclusively, so skipping the top-level pass halves tessellation work.
  const std::string want_faces = params.value("wantFaces", std::string("all"));
  const size_t bytes_in = a_brep.size() + b_brep.size();

  TopoDS_Shape a = brep_from_base64(a_brep);
  TopoDS_Shape b = brep_from_base64(b_brep);
  const long t_deser = timer.lap();

  // Union / Cut / Common. BuildBooleanOp serializes lowercase in protocol.rs.
  // A fuzzy tolerance (scaled to the part) absorbs the sub-1e-4 mm mismatch
  // between a tool wall rebuilt from a solved sketch and the body's coincident
  // wall, so near-coincident faces merge instead of duplicating.
  const double fuzzy = boolean_fuzzy(a, b);
  TopoDS_Shape raw;
  if (op == "fuse") {
    BRepAlgoAPI_Fuse fuse(a, b);
    fuse.SetFuzzyValue(fuzzy);
    fuse.Build();
    if (!fuse.IsDone()) throw std::runtime_error("buildBoolean: Fuse failed");
    raw = fuse.Shape();
  } else if (op == "cut") {
    BRepAlgoAPI_Cut cut(a, b);
    cut.SetFuzzyValue(fuzzy);
    cut.Build();
    if (!cut.IsDone()) throw std::runtime_error("buildBoolean: Cut failed");
    raw = cut.Shape();
  } else if (op == "common") {
    BRepAlgoAPI_Common common(a, b);
    common.SetFuzzyValue(fuzzy);
    common.Build();
    if (!common.IsDone()) throw std::runtime_error("buildBoolean: Common failed");
    raw = common.Shape();
  } else {
    throw std::runtime_error("buildBoolean: unknown op '" + op + "'");
  }
  const long t_bool = timer.lap();

  // Merge co-domain sub-faces the boolean introduced (incl. coaxial cylinder
  // fragments with opposite axis directions — clean_unify canonicalizes those
  // surfaces first so UnifySameDomain recognizes them as one).
  TopoDS_Shape shape = clean_unify(raw);
  const long t_unify = timer.lap();

  // Topology + generic (centroid-sorted) face tessellation. Skipped when the
  // caller only consumes the per-solid decomposition (wantFaces:"solids") —
  // previously the whole body was meshed here AND again per solid (REQ 878).
  json topology = json{{"vertices", json::array()}, {"edges", json::array()}};
  json faces = json::array();
  if (want_faces != "solids") {
    topology = extract_topology(shape);
    faces = tessellate_generic(shape, feature_id).faces;
  }
  const long t_tess = timer.lap();

  // Whole-shape BRep that feeds the NEXT compose op. brep_to_base64 throws on
  // an empty/unserializable shape, matching the Rust empty-bytes guard.
  std::string brep_bytes = brep_to_base64(shape);
  if (brep_bytes.empty()) {
    throw std::runtime_error(
        "buildBoolean: result BRep serialization returned empty bytes — "
        "OCCT couldn't write the resulting shape. Likely degenerate input "
        "(e.g. cutting a body in a way that produces zero volume).");
  }
  const long t_ser = timer.lap();

  // SolidWorks-style body tracking: split the result into disjoint solids.
  json solids = decompose_into_solids(shape, feature_id);
  const long t_decomp = timer.lap();

  std::fprintf(stderr,
               "[kernel-timing] buildBoolean feature=%s op=%s wantFaces=%s inKB=%zu "
               "deser=%ld bool=%ld unify=%ld tess=%ld ser=%ld decomp=%ld total=%ldms\n",
               feature_id.c_str(), op.c_str(), want_faces.c_str(), bytes_in / 1024,
               t_deser, t_bool, t_unify, t_tess, t_ser, t_decomp, timer.total());
  std::fflush(stderr);

  return json{
      {"brepBytes", brep_bytes},
      {"faces", faces},
      {"topology", topology},
      {"solids", solids},
  };
}

// buildFuseMany — fuse N shapes in ONE boolean pass (REQ 878). The first brep
// is the base; the rest join it as a single compound tool, so one BOP resolves
// every seam at once instead of N-1 chained pairwise fuses, each re-parsing
// and re-tessellating the growing accumulator. The caller supplies the SAME
// featureId string the legacy chain's final fuse used, so per-solid face
// persistent names are unchanged (no NAMING_SCHEMA_VERSION bump).
json op_buildFuseMany(const json& params) {
  StageTimer timer;
  std::string feature_id = params.value("featureId", std::string("f_anon"));
  const std::string want_faces = params.value("wantFaces", std::string("all"));
  if (!params.contains("breps") || !params["breps"].is_array() || params["breps"].size() < 2) {
    throw std::runtime_error("buildFuseMany: 'breps' must be an array of 2+ base64 BReps");
  }
  const auto& breps = params["breps"];
  size_t bytes_in = 0;
  std::vector<TopoDS_Shape> shapes;
  shapes.reserve(breps.size());
  for (size_t i = 0; i < breps.size(); ++i) {
    if (!breps[i].is_string()) {
      throw std::runtime_error("buildFuseMany: brep " + std::to_string(i) + " is not a string");
    }
    const std::string s = breps[i].get<std::string>();
    bytes_in += s.size();
    shapes.push_back(brep_from_base64(s));
  }
  const long t_deser = timer.lap();

  TopoDS_Compound tool;
  BRep_Builder builder;
  builder.MakeCompound(tool);
  for (size_t i = 1; i < shapes.size(); ++i) builder.Add(tool, shapes[i]);

  BRepAlgoAPI_Fuse fuse(shapes[0], tool);
  fuse.SetFuzzyValue(boolean_fuzzy(shapes[0], tool));
  fuse.Build();
  if (!fuse.IsDone()) throw std::runtime_error("buildFuseMany: Fuse failed");
  TopoDS_Shape shape = clean_unify(fuse.Shape());
  const long t_bool = timer.lap();

  json topology = json{{"vertices", json::array()}, {"edges", json::array()}};
  json faces = json::array();
  if (want_faces != "solids") {
    topology = extract_topology(shape);
    faces = tessellate_generic(shape, feature_id).faces;
  }
  const long t_tess = timer.lap();

  std::string brep_bytes = brep_to_base64(shape);
  if (brep_bytes.empty()) {
    throw std::runtime_error("buildFuseMany: result BRep serialization returned empty bytes");
  }
  const long t_ser = timer.lap();

  json solids = decompose_into_solids(shape, feature_id);
  const long t_decomp = timer.lap();

  std::fprintf(stderr,
               "[kernel-timing] buildFuseMany feature=%s n=%zu wantFaces=%s inKB=%zu "
               "deser=%ld bool+unify=%ld tess=%ld ser=%ld decomp=%ld total=%ldms\n",
               feature_id.c_str(), (size_t)breps.size(), want_faces.c_str(), bytes_in / 1024,
               t_deser, t_bool, t_tess, t_ser, t_decomp, timer.total());
  std::fflush(stderr);

  return json{
      {"brepBytes", brep_bytes},
      {"faces", faces},
      {"topology", topology},
      {"solids", solids},
  };
}

// bodyVolume — exact analytic mass properties (GProp over the faces).
json op_bodyVolume(const json& params) {
  std::string a_brep = require_string(params, "aBrep");
  TopoDS_Shape shape = brep_from_base64(a_brep);

  double volume = 0.0;
  gp_Pnt centroid(0.0, 0.0, 0.0);
  volume_centroid_exact(shape, volume, centroid);

  return json{
      {"volume", volume},
      {"centroid", {centroid.X(), centroid.Y(), centroid.Z()}},
  };
}

// exportStl — combine bodies, mesh at chord tolerance, write binary STL, base64.
json op_exportStl(const json& params) {
  TopoDS_Shape shape = assemble_export_shape(params);

  double tol = params.value("tolerance", 0.01);
  if (tol <= 0.0) tol = 0.01;

  // Triangulate the shape; StlAPI_Writer reads the stored triangulation.
  BRepMesh_IncrementalMesh mesher(shape, tol);
  mesher.Perform();
  if (!mesher.IsDone()) {
    throw std::runtime_error("STL meshing failed");
  }

  std::string path = temp_path("stl", "stl");
  StlAPI_Writer writer;
  writer.ASCIIMode() = Standard_False;  // binary STL
  if (!writer.Write(shape, path.c_str())) {
    std::remove(path.c_str());
    throw std::runtime_error("STL write failed");
  }

  std::ifstream in(path, std::ios::binary);
  if (!in) {
    std::remove(path.c_str());
    throw std::runtime_error("read STL temp file");
  }
  std::vector<unsigned char> bytes((std::istreambuf_iterator<char>(in)),
                                   std::istreambuf_iterator<char>());
  in.close();
  std::remove(path.c_str());

  return json{{"stlBase64", bytes_to_base64(bytes)}};
}

// exportStep — combine bodies, transfer each as-is, write STEP, return text.
json op_exportStep(const json& params) {
  TopoDS_Shape shape = assemble_export_shape(params);

  STEPControl_Writer writer;
  if (writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone) {
    throw std::runtime_error("STEP transfer failed");
  }

  std::string path = temp_path("step", "step");
  if (writer.Write(path.c_str()) != IFSelect_RetDone) {
    std::remove(path.c_str());
    throw std::runtime_error("STEP write failed");
  }

  std::ifstream in(path, std::ios::binary);
  if (!in) {
    std::remove(path.c_str());
    throw std::runtime_error("read STEP temp file");
  }
  std::stringstream ss;
  ss << in.rdbuf();
  in.close();
  std::remove(path.c_str());

  return json{{"step", ss.str()}};
}

}  // namespace kernel
