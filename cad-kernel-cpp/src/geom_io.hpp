// Shared geometry I/O + tessellation + naming + topology helpers.
//
// This is the CONTRACT every op (extrude/boolean/revolve/...) compiles against.
// Implemented in geom_io.cpp (port of the Rust kernel's ops/shape_io.rs +
// naming.rs). All `json` is nlohmann::json. Functions throw std::runtime_error
// on failure (the server turns that into a JSON-RPC error).
//
// Field names in the emitted json MUST match the Rust kernel's protocol exactly
// (see cad-kernel/src/protocol.rs) so the Node backend + Angular frontend are
// unchanged: faceId, persistentName, isFlat, positions, normals, indices,
// boundaryEdgeIds, surface{kind,origin,normal,axis,radius}; topology {vertices:
// [{id,position}], edges:[{id,isStraight,isTangent,endpoints,polyline?}]}.
#pragma once

#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>

namespace kernel {
using nlohmann::json;

// ── BRep <-> base64 (binary BinTools, matching the Rust serialize_brep) ────────
TopoDS_Shape brep_from_base64(const std::string& b64);
std::string brep_to_base64(const TopoDS_Shape& shape);

// ── Sketch plane + profile geometry ────────────────────────────────────────────
struct Plane3 {
  gp_Pnt origin;
  gp_Dir x_axis;
  gp_Dir y_axis;
  gp_Dir normal;
};
// Parse {origin,xAxis,yAxis,normal} (each [f64;3]).
Plane3 plane_from_json(const json& j);

// Build the planar face for a region: outer ProfileEdge[] minus each holes[i].
// `outer` is a json array of ProfileEdge; `holes` is a json array of ProfileEdge
// arrays (may be null/empty). ProfileEdge kinds: line/arc/circle/bezier (see
// protocol.rs). Throws on a degenerate/non-closed loop.
TopoDS_Face build_profile_face(const Plane3& plane, const json& outer, const json& holes);

// Build a single (open or closed) wire from a ProfileEdge[] on `plane`.
TopoDS_Wire build_profile_wire(const Plane3& plane, const json& edges);

// ── Tessellation + persistent naming + topology ───────────────────────────────
// Result bundle: `faces` is a json ARRAY of FaceMesh objects; `topology` is the
// {vertices, edges} object. Both ready to drop straight into an op's result json.
struct Tessellated {
  json faces;
  json topology;
};

// Analytic-feature tessellation (extrude/revolve/sweep/loft): classifies each face
// as cap-top / cap-bottom / side by projecting its centroid onto `plane_normal`
// from `plane_origin` (≈0 → cap-bottom, ≈signed_distance → cap-top, else side with
// sub_index = a stable per-face index). Persistent names are PersistentName JSON.
Tessellated tessellate_named(const TopoDS_Shape& shape,
                             const gp_Pnt& plane_origin,
                             const gp_Dir& plane_normal,
                             double signed_distance,
                             const std::string& feature_id);

// Generic tessellation (boolean/pattern/shell/blend results): face ids are
// PersistentName JSON with feature_id=`scope`, role=side, sub_index=face index.
// This mirrors the Rust tessellate_faces_generic_with_topology.
Tessellated tessellate_generic(const TopoDS_Shape& shape, const std::string& scope);

// {vertices:[{id,position}], edges:[{id,isStraight,isTangent,endpoints,polyline?}]}
// Drops parametric seams + coplanar/co-domain redundant edges (the e86/e97 case).
json extract_topology(const TopoDS_Shape& shape);

// ── Solid decomposition + mass properties ──────────────────────────────────────
// Returns a json ARRAY of SolidPart {brepBytes, centroid, volume, faces, topology},
// one per disjoint solid. `scope` namespaces each solid's face ids (`scope#bodyN`).
json decompose_into_solids(const TopoDS_Shape& shape, const std::string& scope);

// Mesh-based volume/centroid (fast; used for body-tracking identity matching).
void volume_centroid(const TopoDS_Shape& shape, double& volume, gp_Pnt& centroid);
// Exact analytic volume/centroid (GProp over faces; used by bodyVolume).
void volume_centroid_exact(const TopoDS_Shape& shape, double& volume, gp_Pnt& centroid);

// ── Boolean cleanup (ShapeUpgrade_UnifySameDomain) ─────────────────────────────
TopoDS_Shape clean_unify(const TopoDS_Shape& shape);

// Bounding-box-relative fuzzy tolerance for boolean ops (fuse/cut/common and
// pattern/mirror unions). A tool/instance wall rebuilt from a solved sketch can
// land a few 1e-5 mm off a coincident wall — far above OCCT's 1e-7 confusion
// tolerance, so the algorithm treats the near-coincident faces as distinct and
// leaves a DUPLICATE coincident face. This value (~1e-4 mm on a ~100 mm body)
// merges them while staying negligible vs feature sizes. Pass both operands so
// the box covers the whole interference region.
double boolean_fuzzy(const TopoDS_Shape& a, const TopoDS_Shape& b);

}  // namespace kernel
