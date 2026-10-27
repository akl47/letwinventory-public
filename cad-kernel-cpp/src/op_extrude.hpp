// buildExtrude / buildLoft — native OCCT 8.0 port of cad-kernel/src/ops/extrude.rs.
//
// Handlers take the RPC `params` json (BuildExtrudeParams / BuildLoftParams from
// cad-kernel/src/protocol.rs) and return the result json (BuildExtrudeResult:
// {brepBytes, faces, topology}). They throw std::runtime_error on bad geometry;
// the server converts that into a JSON-RPC error.
//
// All profile/tessellation/topology/BRep work is delegated to the shared contract
// in geom_io.hpp (build_profile_face, tessellate_named, extract_topology,
// brep_to_base64 / brep_from_base64, clean_unify). This file owns only the
// op-level logic: blind extrude, start_offset, direction2 folding, up-to-body /
// up-to-next end conditions, and the loft via BRepOffsetAPI_ThruSections.
#pragma once

#include <nlohmann/json.hpp>

namespace kernel {

nlohmann::json op_buildExtrude(const nlohmann::json& params);
nlohmann::json op_buildLoft(const nlohmann::json& params);

}  // namespace kernel
