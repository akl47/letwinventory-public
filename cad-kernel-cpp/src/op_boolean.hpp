// buildBoolean / bodyVolume / exportStl / exportStep — native OCCT 8.0 port of
// cad-kernel/src/ops/boolean.rs, the body_volume handler in ops/shape_io.rs, and
// cad-kernel/src/ops/export.rs.
//
// Handlers take the RPC `params` json (BuildBooleanParams / BodyVolumeParams /
// ExportStlParams / ExportStepParams from cad-kernel/src/protocol.rs) and return
// the matching result json:
//   buildBoolean → {brepBytes, faces, topology, solids}
//   buildFuseMany→ {brepBytes, faces, topology, solids}  (N-shape fuse in one BOP)
//   bodyVolume   → {volume, centroid}
//   exportStl    → {stlBase64}
//   exportStep   → {step}
//
// buildBoolean / buildFuseMany accept optional `wantFaces`:
//   "all" (default) — top-level faces+topology AND per-solid tessellation
//   "solids"        — per-solid tessellation only; top-level faces/topology
//                     are returned empty. The compose pipeline consumes only
//                     solids[].faces, so this halves tessellation work.
// They throw std::runtime_error on failure; the server turns that into a
// JSON-RPC error.
//
// All geometry I/O (BRep round-trip, generic tessellation, topology extraction,
// solid decomposition, UnifySameDomain cleanup, exact mass properties) is
// delegated to the shared contract in geom_io.hpp. This file owns only the
// op-level logic: the Fuse/Cut/Common dispatch, the export compound + writers.
#pragma once

#include <nlohmann/json.hpp>

namespace kernel {

nlohmann::json op_buildBoolean(const nlohmann::json& params);
nlohmann::json op_buildFuseMany(const nlohmann::json& params);
nlohmann::json op_bodyVolume(const nlohmann::json& params);
nlohmann::json op_exportStl(const nlohmann::json& params);
nlohmann::json op_exportStep(const nlohmann::json& params);

}  // namespace kernel
