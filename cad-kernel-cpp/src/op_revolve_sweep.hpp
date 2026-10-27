// buildRevolve / buildSweep — OCCT 8.0 ports of the Rust kernel's
// ops/revolve.rs + ops/sweep.rs. Both build a profile face on the host
// plane via geom_io's shared contract, then either revolve it about a
// world-space axis (BRepPrimAPI_MakeRevol) or sweep it along a path wire
// (BRepOffsetAPI_MakePipeShell), and emit the same {brepBytes, faces,
// topology} result the backend/frontend already consume.
//
// Field names match cad-kernel/src/protocol.rs:
//   BuildRevolveParams: featureId, profile, holes, plane, axisOrigin,
//                       axisDir, angleDeg
//   BuildSweepParams:   featureId, profile, holes, profilePlane, pathEdges
//   PathEdge (tagged "kind": "line"|"arc"|"circle"): start/end | start/mid/end
//                       | center/radius/normal
//   Result (both): brepBytes, faces, topology
#pragma once

#include <nlohmann/json.hpp>

namespace kernel {

// Revolve a sketched profile about a world-space axis. Throws
// std::runtime_error on degenerate input or OCCT builder failure.
nlohmann::json op_buildRevolve(const nlohmann::json& params);

// Sweep a sketched profile face along a 3D path wire. Holes are swept
// separately and boolean-subtracted. Throws std::runtime_error on
// degenerate input or OCCT builder failure.
nlohmann::json op_buildSweep(const nlohmann::json& params);

}  // namespace kernel
