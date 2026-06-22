// buildBoolean / bodyVolume / exportStl / exportStep — native OCCT 8.0 port of
// cad-kernel/src/ops/boolean.rs, the body_volume handler in ops/shape_io.rs, and
// cad-kernel/src/ops/export.rs.
//
// Handlers take the RPC `params` json (BuildBooleanParams / BodyVolumeParams /
// ExportStlParams / ExportStepParams from cad-kernel/src/protocol.rs) and return
// the matching result json:
//   buildBoolean → {brepBytes, faces, topology, solids}
//   bodyVolume   → {volume, centroid}
//   exportStl    → {stlBase64}
//   exportStep   → {step}
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
nlohmann::json op_bodyVolume(const nlohmann::json& params);
nlohmann::json op_exportStl(const nlohmann::json& params);
nlohmann::json op_exportStep(const nlohmann::json& params);

}  // namespace kernel
