// buildPattern / buildFeaturePattern / buildToolPattern —
// native OCCT 8.0 port of cad-kernel/src/ops/pattern.rs +
// cad-kernel/src/ops/feature_pattern.rs.
//
// Handlers take the RPC `params` json (BuildPatternParams /
// BuildFeaturePatternParams / BuildToolPatternParams from
// cad-kernel/src/protocol.rs) and return the result json
// (BuildPatternResult: {brepBytes, faces, topology, solids}). They throw
// std::runtime_error on bad geometry; the server converts that into a
// JSON-RPC error.
//
// All BRep/tessellation/topology/solid work is delegated to the shared
// contract in geom_io.hpp (brep_from_base64 / brep_to_base64,
// tessellate_generic, extract_topology, decompose_into_solids, clean_unify).
// This file owns only the op-level logic: building the per-transform copies
// (translate / rotate / mirror via gp_Trsf), fusing/cutting them into the
// body, and the feature-/tool-pattern delta re-application.
#pragma once

#include <nlohmann/json.hpp>

namespace kernel {

nlohmann::json op_buildPattern(const nlohmann::json& params);
nlohmann::json op_buildFeaturePattern(const nlohmann::json& params);
nlohmann::json op_buildToolPattern(const nlohmann::json& params);

}  // namespace kernel
