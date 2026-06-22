// buildShell / buildEdgeBlend — native OCCT 8.0 port of
// cad-kernel/src/ops/shell.rs and cad-kernel/src/ops/edge_blend.rs.
//
// buildShell hollows a solid by removing one or more "open" faces (matched
// geometrically by centroid + outward normal) and offsetting the rest by a
// signed wall thickness via BRepOffsetAPI_MakeThickSolid (MakeThickSolidByJoin).
//
// buildEdgeBlend applies a fillet (BRepFilletAPI_MakeFillet) or chamfer
// (BRepFilletAPI_MakeChamfer) to a set of edges, matched by their two
// world-space endpoints (in either order) — robust to OCCT edge renumbering.
//
// Handlers take the RPC `params` json (BuildShellParams / BuildEdgeBlendParams
// from cad-kernel/src/protocol.rs) and return the result json
// ({brepBytes, faces, topology, solids}). They throw std::runtime_error on
// failure; the server converts that into a JSON-RPC error.
//
// All tessellation / topology / solid decomposition / BRep I/O is delegated to
// the shared contract in geom_io.hpp.
#pragma once

#include <nlohmann/json.hpp>

namespace kernel {

nlohmann::json op_buildShell(const nlohmann::json& params);
nlohmann::json op_buildEdgeBlend(const nlohmann::json& params);

}  // namespace kernel
