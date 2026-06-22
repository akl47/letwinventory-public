// geom_io.cpp — native OCCT 8.0 port of the Rust kernel's ops/shape_io.rs +
// naming.rs + the profile-face/wire builders lifted from ops/extrude.rs.
//
// Every JSON field name emitted here matches cad-kernel/src/protocol.rs exactly
// (FaceMesh, Topology, TopologyVertex, TopologyEdge, SolidPart, FaceSurface) so
// the Node backend + Angular frontend are unchanged. See geom_io.hpp for the
// contract.

#include "geom_io.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <unordered_map>
#include <vector>

// ── OCCT headers ────────────────────────────────────────────────────────────
#include <BinTools.hxx>
#include <Standard_Failure.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>

#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_MapOfShape.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopLoc_Location.hxx>

#include <BRep_Tool.hxx>
#include <BRep_Builder.hxx>
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <BRepGProp_Face.hxx>
#include <GProp_GProps.hxx>

#include <BRepMesh_IncrementalMesh.hxx>
#include <Poly_Triangulation.hxx>
#include <Poly_Triangle.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <TColgp_Array1OfDir.hxx>

#include <BRepAdaptor_Surface.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <Geom_Surface.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <GeomAbs_CurveType.hxx>
#include <gp_Pln.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Vec.hxx>

#include <GCPnts_TangentialDeflection.hxx>

#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <Geom_BezierCurve.hxx>
#include <Geom_Curve.hxx>
#include <TColgp_Array1OfPnt.hxx>

#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Lin.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax3.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom2d_Curve.hxx>
#include <GeomProjLib.hxx>
#include <ShapeBuild_ReShape.hxx>
#include <BRepLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <ElCLib.hxx>

namespace kernel {

namespace {

// ── Constants mirroring the Rust kernel ─────────────────────────────────────
constexpr double DEFAULT_CHORD_TOLERANCE = 0.05;
constexpr double QUANT_STEP = 1.0e6;      // edge_geom_key / vertex quantization
constexpr double MIN_EDGE_LEN_SQ = 1.0e-10;
constexpr double MIN_VERTEX_DIST_SQ = 1.0e-8;
constexpr double MIN_POLY_AREA = 1.0e-6;
constexpr double COLLINEAR_TOL = 1.0e-9;
constexpr double TANGENT_DOT = 0.9962;    // cos(5°)
constexpr double TAU = 6.283185307179586;

using Key = std::array<std::array<int64_t, 3>, 3>;
using QPos = std::array<int64_t, 3>;

QPos quantize(double x, double y, double z) {
  return {static_cast<int64_t>(std::llround(x * QUANT_STEP)),
          static_cast<int64_t>(std::llround(y * QUANT_STEP)),
          static_cast<int64_t>(std::llround(z * QUANT_STEP))};
}
QPos quantize(const gp_Pnt& p) { return quantize(p.X(), p.Y(), p.Z()); }

// ── base64 (own encoder/decoder — no external dep) ──────────────────────────
const char* B64_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string base64_encode(const std::vector<unsigned char>& in) {
  std::string out;
  out.reserve(((in.size() + 2) / 3) * 4);
  size_t i = 0;
  for (; i + 2 < in.size(); i += 3) {
    uint32_t n = (uint32_t(in[i]) << 16) | (uint32_t(in[i + 1]) << 8) | uint32_t(in[i + 2]);
    out.push_back(B64_ALPHABET[(n >> 18) & 63]);
    out.push_back(B64_ALPHABET[(n >> 12) & 63]);
    out.push_back(B64_ALPHABET[(n >> 6) & 63]);
    out.push_back(B64_ALPHABET[n & 63]);
  }
  size_t rem = in.size() - i;
  if (rem == 1) {
    uint32_t n = uint32_t(in[i]) << 16;
    out.push_back(B64_ALPHABET[(n >> 18) & 63]);
    out.push_back(B64_ALPHABET[(n >> 12) & 63]);
    out.push_back('=');
    out.push_back('=');
  } else if (rem == 2) {
    uint32_t n = (uint32_t(in[i]) << 16) | (uint32_t(in[i + 1]) << 8);
    out.push_back(B64_ALPHABET[(n >> 18) & 63]);
    out.push_back(B64_ALPHABET[(n >> 12) & 63]);
    out.push_back(B64_ALPHABET[(n >> 6) & 63]);
    out.push_back('=');
  }
  return out;
}

int b64_val(unsigned char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;  // skip whitespace / padding
}

std::vector<unsigned char> base64_decode(const std::string& in) {
  std::vector<unsigned char> out;
  out.reserve(in.size() / 4 * 3);
  int buf = 0, bits = 0;
  for (unsigned char c : in) {
    if (c == '=') break;
    int v = b64_val(c);
    if (v < 0) continue;  // whitespace
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<unsigned char>((buf >> bits) & 0xFF));
    }
  }
  return out;
}

// ── PersistentName JSON encoder (field order: feature_id, role, sub_index,
//    upstream_refs; role kebab-case). Mirrors naming.rs `encode()`. ──────────
std::string persistent_name(const std::string& feature_id, const std::string& role,
                            uint32_t sub_index) {
  // Build by hand so field ORDER is guaranteed (serde uses declaration order;
  // nlohmann::json objects sort keys, which would reorder them).
  json j;
  j["feature_id"] = feature_id;
  j["role"] = role;
  j["sub_index"] = sub_index;
  j["upstream_refs"] = json::array();
  // nlohmann would reorder alphabetically on dump(); emit ordered manually.
  std::string fi = json(feature_id).dump();
  std::string ro = json(role).dump();
  std::ostringstream os;
  os << "{\"feature_id\":" << fi << ",\"role\":" << ro
     << ",\"sub_index\":" << sub_index << ",\"upstream_refs\":[]}";
  return os.str();
}

// ── Mesh flatten: ports opencascade-rs mesh.rs (per-face triangulation) ──────
// Tessellates a SINGLE face (the caller passes a one-face shape, matching the
// Rust `mesh_with_tolerance` per-face call) and returns flat f32 positions,
// f32 normals, u32 indices — orientation-aware (REVERSED faces flip winding).
struct FaceMeshArrays {
  std::vector<float> positions;
  std::vector<float> normals;
  std::vector<uint32_t> indices;
};

FaceMeshArrays mesh_face(const TopoDS_Face& face) {
  // The BRepMesh_IncrementalMesh constructor meshes the shape (matching the
  // opencascade-rs IncrementalMesh_new → IsDone() flow; no separate Perform()).
  BRepMesh_IncrementalMesh mesher(face, DEFAULT_CHORD_TOLERANCE);
  if (!mesher.IsDone()) {
    throw std::runtime_error("BRepMesh failed on a face");
  }

  FaceMeshArrays out;
  TopLoc_Location loc;
  opencascade::handle<Poly_Triangulation> tri = BRep_Tool::Triangulation(face, loc);
  if (tri.IsNull()) {
    throw std::runtime_error("face has no triangulation after meshing");
  }

  const bool reversed = (face.Orientation() == TopAbs_REVERSED);
  const gp_Trsf trsf = loc.Transformation();
  const int n_nodes = tri->NbNodes();

  // Positions (transformed by the face location).
  out.positions.reserve(n_nodes * 3);
  for (int i = 1; i <= n_nodes; ++i) {
    gp_Pnt p = tri->Node(i);
    p.Transform(trsf);
    out.positions.push_back(static_cast<float>(p.X()));
    out.positions.push_back(static_cast<float>(p.Y()));
    out.positions.push_back(static_cast<float>(p.Z()));
  }

  // Normals — computed by OCCT (ComputeNormals then Poly_Triangulation::Normal),
  // one per node, 1-indexed 1..NbNodes. NOTE: opencascade-rs's mesh.rs had a
  // latent off-by-one here (`for i in 1..normal_array.Length()` + a
  // `TODO(bschwind) - Why do we start at 1 here?`) that dropped the LAST node's
  // normal and padded it with (0,0,0). Under OCCT 7.x that zero-normal node
  // rarely landed on a visible triangle; under OCCT 8.0's node ordering it does,
  // rendering as a dark/off-color triangle. We read ALL nodes — normals are
  // tessellation output, not BRep wire bytes, so there's nothing to "match".
  // ComputeNormals gives normals in the SURFACE's natural direction, which is
  // OPPOSITE the face's outward direction for REVERSED faces. The frontend (and
  // faceToPlane, which sets a sketch's plane from a picked face) require
  // OUTWARD-facing normals for solids, so negate on REVERSED — matching the
  // orientation-aware surface.normal (BRepGProp_Face::Normal). Without this, a
  // sketch placed on a reversed face faces INTO the body.
  BRepLib_ToolTriangulatedShape::ComputeNormals(face, tri);
  if (tri->HasNormals()) {
    const float s = reversed ? -1.0f : 1.0f;
    for (int i = 1; i <= n_nodes; ++i) {
      gp_Dir nrm = tri->Normal(i);
      out.normals.push_back(s * static_cast<float>(nrm.X()));
      out.normals.push_back(s * static_cast<float>(nrm.Y()));
      out.normals.push_back(s * static_cast<float>(nrm.Z()));
    }
  }
  // Safety net: if OCCT produced no/short normals, pad so normals.len() ==
  // positions.len() (the frontend assumes aligned arrays).
  while (out.normals.size() < out.positions.size()) out.normals.push_back(0.0f);

  // Indices — orientation-aware winding.
  const int n_tri = tri->NbTriangles();
  out.indices.reserve(n_tri * 3);
  for (int i = 1; i <= n_tri; ++i) {
    int a, b, c;
    tri->Triangle(i).Get(a, b, c);
    if (!reversed) {
      out.indices.push_back(static_cast<uint32_t>(a - 1));
      out.indices.push_back(static_cast<uint32_t>(b - 1));
      out.indices.push_back(static_cast<uint32_t>(c - 1));
    } else {
      out.indices.push_back(static_cast<uint32_t>(c - 1));
      out.indices.push_back(static_cast<uint32_t>(b - 1));
      out.indices.push_back(static_cast<uint32_t>(a - 1));
    }
  }
  return out;
}

bool looks_flat(const std::vector<float>& normals) {
  if (normals.size() < 6) return true;
  float nx0 = normals[0], ny0 = normals[1], nz0 = normals[2];
  const float tol = 1e-3f;
  for (size_t i = 3; i < normals.size(); i += 3) {
    float nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
    if (std::fabs(nx * nx0 + ny * ny0 + nz * nz0 - 1.0f) > tol) return false;
  }
  return true;
}

// ── Face surface adaptor → analytic classification (REQ 749) ────────────────
// Plane: origin = center_of_mass, normal = orientation-aware Face::Normal.
// Cylinder: origin = axis location, axis = axis direction, radius.
gp_Pnt face_center_of_mass(const TopoDS_Face& face) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props, /*skipShared=*/false,
                               /*useTriangulation=*/false);
  return props.CentreOfMass();
}

// Orientation-aware normal at a WORLD point: project the point onto the face's
// surface → (u,v), then BRepGProp_Face::Normal (which respects face
// orientation). Faithful port of opencascade-rs Face::normal_at.
gp_Dir face_normal_at_point(const TopoDS_Face& face, const gp_Pnt& pos) {
  opencascade::handle<Geom_Surface> surface = BRep_Tool::Surface(face);
  Standard_Real u = 0.0, v = 0.0;
  if (!surface.IsNull()) {
    GeomAPI_ProjectPointOnSurf projector(pos, surface);
    if (projector.NbPoints() > 0) {
      projector.LowerDistanceParameters(u, v);
    }
  }
  BRepGProp_Face gprop_face(face);
  gp_Pnt p;
  gp_Vec nrm;
  gprop_face.Normal(u, v, p, nrm);
  if (nrm.Magnitude() < 1.0e-12) return gp_Dir(0, 0, 1);
  return gp_Dir(nrm);
}

gp_Dir face_normal_at_center(const TopoDS_Face& face) {
  return face_normal_at_point(face, face_center_of_mass(face));
}

// Returns true and fills `surf` if planar or cylindrical; false otherwise.
bool classify_face_surface(const TopoDS_Face& face, json& surf) {
  BRepAdaptor_Surface adaptor(face);
  GeomAbs_SurfaceType t = adaptor.GetType();
  if (t == GeomAbs_Plane) {
    gp_Pnt o = face_center_of_mass(face);
    gp_Dir n = face_normal_at_center(face);
    surf = json{{"kind", "plane"},
                {"origin", {o.X(), o.Y(), o.Z()}},
                {"normal", {n.X(), n.Y(), n.Z()}}};
    return true;
  }
  if (t == GeomAbs_Cylinder) {
    gp_Cylinder cyl = adaptor.Cylinder();
    const gp_Ax1 axis = cyl.Axis();
    gp_Pnt o = axis.Location();
    gp_Dir d = axis.Direction();
    surf = json{{"kind", "cylinder"},
                {"origin", {o.X(), o.Y(), o.Z()}},
                {"axis", {d.X(), d.Y(), d.Z()}},
                {"radius", cyl.Radius()}};
    return true;
  }
  return false;
}

// ── Edge curve classification + polyline sampling ───────────────────────────
gp_Pnt edge_start_point(const TopoDS_Edge& e) {
  BRepAdaptor_Curve c(e);
  return c.Value(c.FirstParameter());
}
gp_Pnt edge_end_point(const TopoDS_Edge& e) {
  BRepAdaptor_Curve c(e);
  return c.Value(c.LastParameter());
}

// Approximation segments: GCPnts_TangentialDeflection(adaptor, 0.1, 0.1),
// Value(1..NbPoints). Mirrors opencascade-rs edge.rs.
std::vector<gp_Pnt> approximation_segments(const TopoDS_Edge& e) {
  std::vector<gp_Pnt> pts;
  BRepAdaptor_Curve adaptor(e);
  GCPnts_TangentialDeflection approx(adaptor, 0.1, 0.1);
  int n = approx.NbPoints();
  pts.reserve(n);
  for (int i = 1; i <= n; ++i) pts.push_back(approx.Value(i));
  return pts;
}

// Returns (is_straight, polyline). polyline empty == None.
bool sample_edge_curve(const TopoDS_Edge& e, std::vector<gp_Pnt>& polyline) {
  BRepAdaptor_Curve adaptor(e);
  if (adaptor.GetType() == GeomAbs_Line) return true;  // straight, no polyline
  std::vector<gp_Pnt> pts = approximation_segments(e);
  if (pts.size() < 3) return false;  // degenerate → endpoint-only, not straight
  polyline = std::move(pts);
  return false;
}

// edge_geom_key: rounded {lo, mid, hi}, orientation-independent. Mirrors
// shape_io.rs edge_geom_key (mid = polyline middle index when ≥3 pts, else lo).
Key edge_geom_key(const TopoDS_Edge& e) {
  QPos start = quantize(edge_start_point(e));
  QPos end = quantize(edge_end_point(e));
  QPos lo = start, hi = end;
  if (!(start <= end)) { lo = end; hi = start; }
  std::vector<gp_Pnt> poly = approximation_segments(e);
  QPos mid = lo;
  if (poly.size() >= 3) mid = quantize(poly[poly.size() / 2]);
  return {lo, mid, hi};
}

// face_normal_at(face, world point): project point onto surface → (u,v) →
// BRepGProp_Face::Normal. Used by the tangent detector at edge midpoints.
gp_Dir face_normal_at(const TopoDS_Face& face, double x, double y, double z) {
  return face_normal_at_point(face, gp_Pnt(x, y, z));
}

// Collect a shape's faces / edges / solids into vectors via TopExp_Explorer.
std::vector<TopoDS_Face> collect_faces(const TopoDS_Shape& shape) {
  std::vector<TopoDS_Face> faces;
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
    faces.push_back(TopoDS::Face(ex.Current()));
  }
  return faces;
}
std::vector<TopoDS_Edge> collect_edges(const TopoDS_Shape& shape) {
  std::vector<TopoDS_Edge> edges;
  for (TopExp_Explorer ex(shape, TopAbs_EDGE); ex.More(); ex.Next()) {
    edges.push_back(TopoDS::Edge(ex.Current()));
  }
  return edges;
}

// Edges of a single face (used for boundary-edge lookup).
std::vector<TopoDS_Edge> face_edges(const TopoDS_Face& face) {
  return collect_edges(face);
}

// ── Tangent / seam classification (port of detect_tangent_edges) ────────────
enum class TangentKind { Tangent, Seam };

gp_Dir normal_at_mid(const TopoDS_Face& face, const Key& key) {
  double mx = static_cast<double>(key[1][0]) / QUANT_STEP;
  double my = static_cast<double>(key[1][1]) / QUANT_STEP;
  double mz = static_cast<double>(key[1][2]) / QUANT_STEP;
  return face_normal_at(face, mx, my, mz);
}

// face → unit normal if FLAT (constant normal across edge midpoints), else not.
// Returns whether the face is flat and the representative unit normal.
bool face_flat_normal(const TopoDS_Face& face, gp_Dir& out) {
  bool have = false;
  gp_Dir rep(0, 0, 1);
  for (const TopoDS_Edge& e : face_edges(face)) {
    Key k = edge_geom_key(e);
    gp_Dir n = normal_at_mid(face, k);
    if (!have) { rep = n; have = true; }
    else if (std::fabs(rep.Dot(n)) <= 0.999) return false;  // not flat
  }
  out = rep;
  return have;  // flat iff we found at least one normal and none diverged
}

// True if two faces lie on the SAME underlying cylinder (same axis LINE + radius,
// IGNORING axis-direction sign). A boolean can leave one cylinder split into faces
// whose surfaces carry opposite axis directions; the shared edge between them is a
// co-domain seam that should be dropped (UnifySameDomain won't merge the faces
// because it treats +axis/-axis cylinders as different domains — see clean_unify).
static bool same_cylinder(const TopoDS_Face& a, const TopoDS_Face& b) {
  BRepAdaptor_Surface sa(a), sb(b);
  if (sa.GetType() != GeomAbs_Cylinder || sb.GetType() != GeomAbs_Cylinder) return false;
  gp_Cylinder ca = sa.Cylinder(), cb = sb.Cylinder();
  // Loose tolerances: a full round built from two opposing fillets leaves two
  // near-coaxial same-radius cylinder halves whose axes sit ~1e-3 mm apart (the
  // rounds can't reach EXACTLY half-width, so each axis is offset by that sliver).
  // They're one logical cylinder, so their shared seam should drop. Genuinely
  // distinct cylinders differ by far more than these tolerances.
  if (std::fabs(ca.Radius() - cb.Radius()) > 1e-3) return false;
  gp_Ax1 axa = ca.Axis(), axb = cb.Axis();
  // Directions parallel up to sign.
  if (std::fabs(std::fabs(axa.Direction().Dot(axb.Direction())) - 1.0) > 1e-6) return false;
  // Both axis locations lie on (nearly) the same line.
  gp_Lin la(axa);
  return la.Distance(axb.Location()) <= 1e-2;
}

std::map<Key, TangentKind> detect_tangent_edges(const std::vector<TopoDS_Face>& faces) {
  // Per-face flatness, computed once.
  std::vector<bool> flat(faces.size(), false);
  for (size_t i = 0; i < faces.size(); ++i) {
    gp_Dir n;
    flat[i] = face_flat_normal(faces[i], n);
  }
  // Per-face "sliver" flag: a face that is a thin STRIP — the sub-micron flat
  // remnant a full-round fillet leaves between its two halves (the rounds can't
  // reach EXACTLY half-width). It's invisible, but its two tangent edges (to the
  // fillet cylinders) render as a seam line. Mark it so every edge it touches is
  // dropped (Seam) and the full round reads as one smooth surface. Display-only;
  // real features are never this thin. Thinness = 2·area/perimeter (the strip's
  // width) — NOT the 3D bbox min, which is ~0 for ANY flat face and would flag
  // every planar face.
  constexpr double SLIVER_MM = 0.02;
  std::vector<bool> sliver(faces.size(), false);
  for (size_t i = 0; i < faces.size(); ++i) {
    GProp_GProps ap, lp;
    BRepGProp::SurfaceProperties(faces[i], ap);
    BRepGProp::LinearProperties(faces[i], lp);  // total boundary-edge length
    const double area = ap.Mass(), perim = lp.Mass();
    if (area <= 0.0 || perim <= 1e-9) continue;
    const double width = 2.0 * area / perim;  // hydraulic width of the strip
    if (width < SLIVER_MM) sliver[i] = true;
  }
  // Per edge key: list of (face_index, count).
  std::map<Key, std::vector<std::pair<size_t, size_t>>> edge_faces;
  for (size_t i = 0; i < faces.size(); ++i) {
    std::map<Key, size_t> local;
    for (const TopoDS_Edge& e : face_edges(faces[i])) local[edge_geom_key(e)]++;
    for (auto& kv : local) edge_faces[kv.first].push_back({i, kv.second});
  }
  std::map<Key, TangentKind> classified;
  for (auto& kv : edge_faces) {
    // Any edge touching a sliver face: drop it (the seam around the invisible
    // remnant of a full round). Checked first so it wins over other rules.
    {
      bool touchesSliver = false;
      for (const auto& o : kv.second) if (sliver[o.first]) { touchesSliver = true; break; }
      if (touchesSliver) { classified[kv.first] = TangentKind::Seam; continue; }
    }
    const Key& key = kv.first;
    const auto& owners = kv.second;
    if (owners.size() == 1 && owners[0].second >= 2) {
      classified[key] = TangentKind::Seam;  // parametric seam (single face wrap)
      continue;
    }
    if (owners.size() == 2) {
      // Co-cylindrical faces (one cylinder split into pieces, possibly with
      // opposite axis directions) → the shared edge is a co-domain seam, drop it.
      // The faces stay separate (geometry untouched) but the spurious tangent
      // seam line no longer renders/selects (the e86 / e101 case).
      if (same_cylinder(faces[owners[0].first], faces[owners[1].first])) {
        classified[key] = TangentKind::Seam;
        continue;
      }
      gp_Dir n0 = normal_at_mid(faces[owners[0].first], key);
      gp_Dir n1 = normal_at_mid(faces[owners[1].first], key);
      double dot = n0.Dot(n1);  // both unit
      bool flat0 = flat[owners[0].first];
      bool flat1 = flat[owners[1].first];
      if (dot > TANGENT_DOT && flat0 && flat1) {
        classified[key] = TangentKind::Seam;  // coplanar planar faces → drop
        continue;
      }
      if (std::fabs(dot) > TANGENT_DOT) classified[key] = TangentKind::Tangent;
    } else if (owners.size() >= 2) {
      // Non-manifold (≥3 faces): tangent iff every pair is tangent.
      bool all_tangent = true;
      for (size_t i = 0; i < owners.size() && all_tangent; ++i) {
        for (size_t j = i + 1; j < owners.size(); ++j) {
          gp_Dir n0 = normal_at_mid(faces[owners[i].first], key);
          gp_Dir n1 = normal_at_mid(faces[owners[j].first], key);
          double dot = n0.Dot(n1);
          if (std::fabs(dot) <= TANGENT_DOT) { all_tangent = false; break; }
        }
      }
      if (all_tangent) classified[key] = TangentKind::Tangent;
    }
    // owners.size()==1 with count 1 → boundary edge, kept (not classified).
  }
  return classified;
}

// ── Profile face building (port of extrude.rs build_profile_face) ───────────
struct PVec3 {
  double x, y, z;
};
PVec3 to_world(const Plane3& pl, double x, double y) {
  return {pl.origin.X() + pl.x_axis.X() * x + pl.y_axis.X() * y,
          pl.origin.Y() + pl.x_axis.Y() * x + pl.y_axis.Y() * y,
          pl.origin.Z() + pl.x_axis.Z() * x + pl.y_axis.Z() * y};
}
gp_Pnt to_world_pnt(const Plane3& pl, double x, double y) {
  PVec3 w = to_world(pl, x, y);
  return gp_Pnt(w.x, w.y, w.z);
}

double signed_polygon_area(const std::vector<std::array<double, 2>>& pts) {
  size_t n = pts.size();
  double sum = 0.0;
  for (size_t i = 0; i < n; ++i) {
    auto a = pts[i];
    auto b = pts[(i + 1) % n];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2.0;
}

std::vector<std::array<double, 2>> dedup_consecutive(std::vector<std::array<double, 2>> pts) {
  if (pts.empty()) return pts;
  std::vector<std::array<double, 2>> out;
  out.reserve(pts.size());
  for (auto& p : pts) {
    if (!out.empty()) {
      double dx = p[0] - out.back()[0], dy = p[1] - out.back()[1];
      if (dx * dx + dy * dy < MIN_VERTEX_DIST_SQ) continue;
    }
    out.push_back(p);
  }
  while (out.size() > 1) {
    double dx = out.back()[0] - out.front()[0], dy = out.back()[1] - out.front()[1];
    if (dx * dx + dy * dy < MIN_VERTEX_DIST_SQ) out.pop_back();
    else break;
  }
  return out;
}

void validate_polygon(const std::vector<std::array<double, 2>>& pts) {
  size_t n = pts.size();
  for (size_t i = 0; i < n; ++i) {
    auto a = pts[i];
    auto b = pts[(i + 1) % n];
    double dx = b[0] - a[0], dy = b[1] - a[1];
    if (dx * dx + dy * dy < MIN_VERTEX_DIST_SQ)
      throw std::runtime_error("profile has a zero-length edge — consecutive points coincide");
  }
  for (size_t i = 0; i < n; ++i) {
    auto a = pts[i];
    auto b = pts[(i + 1) % n];
    auto c = pts[(i + 2) % n];
    double cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (std::fabs(cross) > COLLINEAR_TOL) continue;
    double dot = (b[0] - a[0]) * (c[0] - a[0]) + (b[1] - a[1]) * (c[1] - a[1]);
    double ac_len_sq = (c[0] - a[0]) * (c[0] - a[0]) + (c[1] - a[1]) * (c[1] - a[1]);
    if (dot > 0.0 && dot < ac_len_sq)
      throw std::runtime_error("profile has a degenerate corner — three consecutive collinear points");
  }
  if (std::fabs(signed_polygon_area(pts)) < MIN_POLY_AREA)
    throw std::runtime_error("profile encloses near-zero area; pick distinct vertices");
}

// Orientation polygon: one vertex per edge start + each arc's midpoint.
std::vector<std::array<double, 2>> orientation_polygon(const json& profile) {
  std::vector<std::array<double, 2>> poly;
  for (const auto& e : profile) {
    std::string kind = e.value("kind", "");
    if (kind == "line") {
      auto s = e.at("start");
      poly.push_back({s.at("x").get<double>(), s.at("y").get<double>()});
    } else if (kind == "arc") {
      auto s = e.at("start");
      auto c = e.at("center");
      double r = e.at("radius").get<double>();
      double sa = e.at("startAngle").get<double>();
      double ea = e.at("endAngle").get<double>();
      bool ccw = e.at("ccw").get<bool>();
      poly.push_back({s.at("x").get<double>(), s.at("y").get<double>()});
      double sweep = ea - sa;
      if (ccw) { while (sweep <= 0.0) sweep += TAU; }
      else { while (sweep >= 0.0) sweep -= TAU; }
      double mid = sa + sweep / 2.0;
      poly.push_back({c.at("x").get<double>() + r * std::cos(mid),
                      c.at("y").get<double>() + r * std::sin(mid)});
    } else if (kind == "bezier") {
      auto pts = e.at("points");
      poly.push_back({pts.at(0).at("x").get<double>(), pts.at(0).at("y").get<double>()});
    }
    // circle: lone circle never reaches here (len==1 fast path).
  }
  return poly;
}

// Traversal start (x,y) for the first edge, honoring reverse.
std::array<double, 2> traversal_start(const json& edge, bool reverse) {
  std::string kind = edge.value("kind", "");
  if (kind == "line" || kind == "arc") {
    const json& p = reverse ? edge.at("end") : edge.at("start");
    return {p.at("x").get<double>(), p.at("y").get<double>()};
  }
  if (kind == "bezier") {
    const auto& pts = edge.at("points");
    const json& p = reverse ? pts.at(pts.size() - 1) : pts.at(0);
    return {p.at("x").get<double>(), p.at("y").get<double>()};
  }
  throw std::runtime_error("traversal_start: unexpected edge kind");
}

bool profile_has_bezier(const json& profile) {
  for (const auto& e : profile)
    if (e.value("kind", "") == "bezier") return true;
  return false;
}

// Build the wire (and face) for a bezier-containing profile (text glyphs).
TopoDS_Face build_bezier_profile_face(const Plane3& plane, const json& profile) {
  std::vector<std::array<double, 2>> orient;
  for (const auto& e : profile) {
    std::string kind = e.value("kind", "");
    if (kind == "line" || kind == "arc") {
      auto s = e.at("start");
      orient.push_back({s.at("x").get<double>(), s.at("y").get<double>()});
    } else if (kind == "bezier") {
      for (const auto& p : e.at("points"))
        orient.push_back({p.at("x").get<double>(), p.at("y").get<double>()});
    }
  }
  bool reverse = signed_polygon_area(orient) < 0.0;

  std::vector<json> ordered(profile.begin(), profile.end());
  if (reverse) std::reverse(ordered.begin(), ordered.end());

  std::vector<TopoDS_Edge> occ_edges;
  std::array<double, 2> cursor = traversal_start(ordered.front(), reverse);

  for (const auto& edge : ordered) {
    std::string kind = edge.value("kind", "");
    if (kind == "line") {
      auto s = edge.at("start");
      auto en = edge.at("end");
      double ex = reverse ? s.at("x").get<double>() : en.at("x").get<double>();
      double ey = reverse ? s.at("y").get<double>() : en.at("y").get<double>();
      if ((ex - cursor[0]) * (ex - cursor[0]) + (ey - cursor[1]) * (ey - cursor[1]) < MIN_EDGE_LEN_SQ)
        continue;
      occ_edges.push_back(BRepBuilderAPI_MakeEdge(to_world_pnt(plane, cursor[0], cursor[1]),
                                                  to_world_pnt(plane, ex, ey)));
      cursor = {ex, ey};
    } else if (kind == "arc") {
      auto c = edge.at("center");
      double r = edge.at("radius").get<double>();
      double saF = edge.at("startAngle").get<double>();
      double eaF = edge.at("endAngle").get<double>();
      bool ccwF = edge.at("ccw").get<bool>();
      auto s = edge.at("start");
      auto en = edge.at("end");
      double sa = reverse ? eaF : saF;
      double ea = reverse ? saF : eaF;
      bool sweep_ccw = reverse ? !ccwF : ccwF;
      double ex = reverse ? s.at("x").get<double>() : en.at("x").get<double>();
      double ey = reverse ? s.at("y").get<double>() : en.at("y").get<double>();
      if ((ex - cursor[0]) * (ex - cursor[0]) + (ey - cursor[1]) * (ey - cursor[1]) < MIN_EDGE_LEN_SQ)
        continue;
      double sweep = ea - sa;
      if (sweep_ccw) { while (sweep <= 0.0) sweep += TAU; }
      else { while (sweep >= 0.0) sweep -= TAU; }
      double mid_angle = sa + sweep / 2.0;
      double cx = c.at("x").get<double>(), cy = c.at("y").get<double>();
      double mx = cx + r * std::cos(mid_angle), my = cy + r * std::sin(mid_angle);
      GC_MakeArcOfCircle mk(to_world_pnt(plane, cursor[0], cursor[1]),
                            to_world_pnt(plane, mx, my),
                            to_world_pnt(plane, ex, ey));
      if (!mk.IsDone()) throw std::runtime_error("arc construction failed in bezier profile");
      occ_edges.push_back(BRepBuilderAPI_MakeEdge(mk.Value()));
      cursor = {ex, ey};
    } else if (kind == "bezier") {
      const auto& points = edge.at("points");
      if (points.size() < 2) continue;
      std::vector<gp_Pnt> raw;
      if (reverse)
        for (auto it = points.rbegin(); it != points.rend(); ++it)
          raw.push_back(to_world_pnt(plane, it->at("x").get<double>(), it->at("y").get<double>()));
      else
        for (const auto& p : points)
          raw.push_back(to_world_pnt(plane, p.at("x").get<double>(), p.at("y").get<double>()));
      std::vector<gp_Pnt> ctrl;
      for (const auto& p : raw) {
        if (ctrl.empty() || ctrl.back().SquareDistance(p) > MIN_EDGE_LEN_SQ) ctrl.push_back(p);
      }
      const json& endp = reverse ? points.at(0) : points.at(points.size() - 1);
      if (ctrl.size() >= 2) {
        TColgp_Array1OfPnt poles(1, static_cast<int>(ctrl.size()));
        for (size_t i = 0; i < ctrl.size(); ++i) poles.SetValue(static_cast<int>(i) + 1, ctrl[i]);
        opencascade::handle<Geom_BezierCurve> bez = new Geom_BezierCurve(poles);
        occ_edges.push_back(BRepBuilderAPI_MakeEdge(bez));
      }
      cursor = {endp.at("x").get<double>(), endp.at("y").get<double>()};
    }
  }
  if (occ_edges.size() < 2)
    throw std::runtime_error("text/bezier profile produced too few edges");

  BRepBuilderAPI_MakeWire mkwire;
  for (auto& e : occ_edges) mkwire.Add(e);
  if (!mkwire.IsDone()) throw std::runtime_error("failed to build bezier profile wire");
  BRepBuilderAPI_MakeFace mkface(mkwire.Wire(), /*OnlyPlane=*/false);
  if (!mkface.IsDone()) throw std::runtime_error("failed to build bezier profile face");
  return mkface.Face();
}

}  // namespace

// ════════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════════

// ── BRep <-> base64 (BinTools binary) ───────────────────────────────────────
TopoDS_Shape brep_from_base64(const std::string& b64) {
  std::vector<unsigned char> bytes = base64_decode(b64);
  if (bytes.empty()) throw std::runtime_error("decode base64 BREP payload: empty");
  std::stringstream ss(std::ios::in | std::ios::out | std::ios::binary);
  ss.write(reinterpret_cast<const char*>(bytes.data()),
           static_cast<std::streamsize>(bytes.size()));
  TopoDS_Shape shape;
  try {
    BinTools::Read(shape, ss);
  } catch (const Standard_Failure& e) {
    throw std::runtime_error(std::string("read BREP: ") + e.GetMessageString());
  }
  if (shape.IsNull()) throw std::runtime_error("read BREP: result is null");
  return shape;
}

std::string brep_to_base64(const TopoDS_Shape& shape) {
  std::stringstream ss(std::ios::in | std::ios::out | std::ios::binary);
  try {
    BinTools::Write(shape, ss);
  } catch (const Standard_Failure&) {
    return std::string();  // mirror serialize_brep returning empty on failure
  }
  std::string s = ss.str();
  std::vector<unsigned char> bytes(s.begin(), s.end());
  return base64_encode(bytes);
}

// ── Plane parsing ───────────────────────────────────────────────────────────
Plane3 plane_from_json(const json& j) {
  auto vec = [](const json& a) {
    return std::array<double, 3>{a.at(0).get<double>(), a.at(1).get<double>(), a.at(2).get<double>()};
  };
  auto o = vec(j.at("origin"));
  auto x = vec(j.at("xAxis"));
  auto y = vec(j.at("yAxis"));
  auto n = vec(j.at("normal"));
  Plane3 pl;
  pl.origin = gp_Pnt(o[0], o[1], o[2]);
  pl.x_axis = gp_Dir(x[0], x[1], x[2]);
  pl.y_axis = gp_Dir(y[0], y[1], y[2]);
  pl.normal = gp_Dir(n[0], n[1], n[2]);
  return pl;
}

// ── Build a single wire from a ProfileEdge[] ─────────────────────────────────
// Reproduces the edge walk used by build_profile_face (lines via segment, arcs
// via 3-point GC_MakeArcOfCircle, lone circle via gp_Circ). No closing/area
// validation here — callers that need a closed validated loop use
// build_profile_face.
TopoDS_Wire build_profile_wire(const Plane3& plane, const json& edges) {
  if (edges.empty()) throw std::runtime_error("profile is empty");

  // Lone circle.
  if (edges.size() == 1 && edges.at(0).value("kind", "") == "circle") {
    const auto& e = edges.at(0);
    auto c = e.at("center");
    double r = e.at("radius").get<double>();
    gp_Pnt center = to_world_pnt(plane, c.at("x").get<double>(), c.at("y").get<double>());
    gp_Ax2 ax2(center, plane.normal);
    gp_Circ circ(ax2, r);
    TopoDS_Edge ce = BRepBuilderAPI_MakeEdge(circ);
    return BRepBuilderAPI_MakeWire(ce);
  }
  if (profile_has_bezier(edges)) {
    // Reuse the bezier builder's edge construction by extracting its wire.
    TopoDS_Face f = build_bezier_profile_face(plane, edges);
    for (TopExp_Explorer ex(f, TopAbs_WIRE); ex.More(); ex.Next())
      return TopoDS::Wire(ex.Current());
    throw std::runtime_error("bezier profile produced no wire");
  }

  std::vector<json> profile(edges.begin(), edges.end());
  std::array<double, 2> cursor = traversal_start(profile.front(), /*reverse=*/false);
  BRepBuilderAPI_MakeWire mkwire;
  for (const auto& edge : profile) {
    std::string kind = edge.value("kind", "");
    if (kind == "line") {
      auto en = edge.at("end");
      double ex = en.at("x").get<double>(), ey = en.at("y").get<double>();
      double dx = ex - cursor[0], dy = ey - cursor[1];
      if (dx * dx + dy * dy < MIN_EDGE_LEN_SQ) continue;
      mkwire.Add(TopoDS_Edge(BRepBuilderAPI_MakeEdge(
          to_world_pnt(plane, cursor[0], cursor[1]), to_world_pnt(plane, ex, ey))));
      cursor = {ex, ey};
    } else if (kind == "arc") {
      auto c = edge.at("center");
      double r = edge.at("radius").get<double>();
      double sa = edge.at("startAngle").get<double>();
      double ea = edge.at("endAngle").get<double>();
      bool ccw = edge.at("ccw").get<bool>();
      auto en = edge.at("end");
      double ex = en.at("x").get<double>(), ey = en.at("y").get<double>();
      double dx = ex - cursor[0], dy = ey - cursor[1];
      if (dx * dx + dy * dy < MIN_EDGE_LEN_SQ) continue;
      double sweep = ea - sa;
      if (ccw) { while (sweep <= 0.0) sweep += TAU; }
      else { while (sweep >= 0.0) sweep -= TAU; }
      double mid_angle = sa + sweep / 2.0;
      double cx = c.at("x").get<double>(), cy = c.at("y").get<double>();
      double mx = cx + r * std::cos(mid_angle), my = cy + r * std::sin(mid_angle);
      GC_MakeArcOfCircle mk(to_world_pnt(plane, cursor[0], cursor[1]),
                            to_world_pnt(plane, mx, my), to_world_pnt(plane, ex, ey));
      if (!mk.IsDone()) throw std::runtime_error("arc construction failed in profile wire");
      mkwire.Add(TopoDS_Edge(BRepBuilderAPI_MakeEdge(mk.Value())));
      cursor = {ex, ey};
    } else if (kind == "circle") {
      throw std::runtime_error(
          "'circle' edge mixed into a polygon profile is invalid; circles must be the sole edge");
    }
  }
  if (!mkwire.IsDone()) throw std::runtime_error("failed to build profile wire");
  return mkwire.Wire();
}

// ── Build the planar face for a region (outer minus holes) ──────────────────
TopoDS_Face build_profile_face(const Plane3& plane, const json& outer, const json& holes) {
  if (outer.empty()) throw std::runtime_error("profile is empty");

  // Build a single (validated) face for one loop.
  auto build_single = [&](const json& profile) -> TopoDS_Face {
    if (profile.size() == 1 && profile.at(0).value("kind", "") == "circle") {
      TopoDS_Wire w = build_profile_wire(plane, profile);
      BRepBuilderAPI_MakeFace mk(w, false);
      if (!mk.IsDone()) throw std::runtime_error("failed to build circle face");
      return mk.Face();
    }
    for (const auto& e : profile)
      if (e.value("kind", "") == "circle")
        throw std::runtime_error(
            "'circle' edge mixed into a polygon profile is invalid; circles must be the sole edge");

    if (profile_has_bezier(profile)) return build_bezier_profile_face(plane, profile);

    std::vector<std::array<double, 2>> poly = orientation_polygon(profile);
    if (poly.size() < 3)
      throw std::runtime_error("profile must have at least 3 edges to form a closed polygon");
    poly = dedup_consecutive(poly);
    if (poly.size() < 3)
      throw std::runtime_error("profile collapses to fewer than 3 distinct vertices");
    validate_polygon(poly);

    bool reverse = signed_polygon_area(poly) < 0.0;
    std::vector<json> edges(profile.begin(), profile.end());
    if (reverse) std::reverse(edges.begin(), edges.end());

    std::array<double, 2> cursor = traversal_start(edges.front(), reverse);
    BRepBuilderAPI_MakeWire mkwire;
    for (const auto& edge : edges) {
      std::string kind = edge.value("kind", "");
      if (kind == "line") {
        auto s = edge.at("start");
        auto en = edge.at("end");
        double ex = reverse ? s.at("x").get<double>() : en.at("x").get<double>();
        double ey = reverse ? s.at("y").get<double>() : en.at("y").get<double>();
        double dx = ex - cursor[0], dy = ey - cursor[1];
        if (dx * dx + dy * dy < MIN_EDGE_LEN_SQ) continue;
        mkwire.Add(TopoDS_Edge(BRepBuilderAPI_MakeEdge(
            to_world_pnt(plane, cursor[0], cursor[1]), to_world_pnt(plane, ex, ey))));
        cursor = {ex, ey};
      } else if (kind == "arc") {
        auto c = edge.at("center");
        double r = edge.at("radius").get<double>();
        double saF = edge.at("startAngle").get<double>();
        double eaF = edge.at("endAngle").get<double>();
        bool ccwF = edge.at("ccw").get<bool>();
        auto s = edge.at("start");
        auto en = edge.at("end");
        double sa = reverse ? eaF : saF;
        double ea = reverse ? saF : eaF;
        bool sweep_ccw = reverse ? !ccwF : ccwF;
        double ex = reverse ? s.at("x").get<double>() : en.at("x").get<double>();
        double ey = reverse ? s.at("y").get<double>() : en.at("y").get<double>();
        double dx = ex - cursor[0], dy = ey - cursor[1];
        if (dx * dx + dy * dy < MIN_EDGE_LEN_SQ) continue;
        double sweep = ea - sa;
        if (sweep_ccw) { while (sweep <= 0.0) sweep += TAU; }
        else { while (sweep >= 0.0) sweep -= TAU; }
        double mid_angle = sa + sweep / 2.0;
        double cx = c.at("x").get<double>(), cy = c.at("y").get<double>();
        double mx = cx + r * std::cos(mid_angle), my = cy + r * std::sin(mid_angle);
        GC_MakeArcOfCircle mk(to_world_pnt(plane, cursor[0], cursor[1]),
                              to_world_pnt(plane, mx, my), to_world_pnt(plane, ex, ey));
        if (!mk.IsDone()) throw std::runtime_error("arc construction failed in profile");
        mkwire.Add(TopoDS_Edge(BRepBuilderAPI_MakeEdge(mk.Value())));
        cursor = {ex, ey};
      }
    }
    if (!mkwire.IsDone()) throw std::runtime_error("failed to build profile wire");
    BRepBuilderAPI_MakeFace mkface(mkwire.Wire(), false);
    if (!mkface.IsDone()) throw std::runtime_error("failed to build profile face");
    return mkface.Face();
  };

  TopoDS_Face outer_face = build_single(outer);
  if (holes.is_null() || holes.empty()) return outer_face;

  // Subtract each hole face (BRepAlgoAPI_Cut), mirroring
  // build_compound_face_with_holes. Result may be a compound containing the
  // pierced face; return it as a face-shaped result the extrude path consumes.
  TopoDS_Shape acc = outer_face;
  for (const auto& hole_edges : holes) {
    TopoDS_Face hole_face = build_single(hole_edges);
    BRepAlgoAPI_Cut cut(acc, hole_face);
    cut.Build();
    if (!cut.IsDone()) throw std::runtime_error("failed to subtract hole from profile face");
    acc = cut.Shape();
  }
  // The result of cutting faces is a compound/shell; extract the single face if
  // there is exactly one, else return the first face (the holed planar region).
  std::vector<TopoDS_Face> rf = collect_faces(acc);
  if (rf.empty()) throw std::runtime_error("holed profile produced no face");
  return rf.front();
}

// ── extract_topology ────────────────────────────────────────────────────────
json extract_topology(const TopoDS_Shape& shape) {
  json vertices = json::array();
  json edges_out = json::array();
  std::set<QPos> seen_v;
  size_t v_id = 0;

  std::vector<TopoDS_Face> faces = collect_faces(shape);
  std::map<Key, TangentKind> classified = detect_tangent_edges(faces);

  // collect_edges uses TopExp_Explorer, which visits a manifold edge ONCE PER
  // OWNING FACE — i.e. every shared edge appears twice. We must keep that
  // double-count for detect_tangent_edges (its seam test counts an edge wrapping
  // a single face twice), but the topology must emit each physical edge ONCE.
  // Emitting both would leave the second as an ORPHAN (no face's boundaryEdgeIds
  // references it, since those resolve by geometric key to the first id), which
  // renders coincident with the real edge and shows up as a spurious, separately
  // pickable edge in edge-select mode. Dedupe by topological identity (IsSame,
  // orientation-insensitive) so each edge is emitted exactly once.
  std::vector<TopoDS_Edge> edges = collect_edges(shape);
  TopTools_MapOfShape seen_edges;
  for (size_t e_idx = 0; e_idx < edges.size(); ++e_idx) {
    const TopoDS_Edge& edge = edges[e_idx];
    if (!seen_edges.Add(edge)) continue;  // shared edge already emitted
    gp_Pnt start = edge_start_point(edge);
    gp_Pnt end = edge_end_point(edge);
    Key key = edge_geom_key(edge);

    auto it = classified.find(key);
    bool is_seam = (it != classified.end() && it->second == TangentKind::Seam);
    if (is_seam) continue;  // drop parametric/coplanar seams entirely

    for (const gp_Pnt& p : {start, end}) {
      QPos vk = quantize(p);
      if (seen_v.insert(vk).second) {
        vertices.push_back(json{{"id", "v" + std::to_string(v_id)},
                                {"position", {p.X(), p.Y(), p.Z()}}});
        ++v_id;
      }
    }

    bool is_tangent = (it != classified.end() && it->second == TangentKind::Tangent);
    std::vector<gp_Pnt> polyline;
    bool is_straight = sample_edge_curve(edge, polyline);

    json e;
    e["id"] = "e" + std::to_string(e_idx);
    e["isStraight"] = is_straight;
    if (is_tangent) e["isTangent"] = true;  // skip_serializing_if = is_false
    e["endpoints"] = {{start.X(), start.Y(), start.Z()}, {end.X(), end.Y(), end.Z()}};
    if (!polyline.empty()) {
      json pl = json::array();
      for (const gp_Pnt& p : polyline) pl.push_back({p.X(), p.Y(), p.Z()});
      e["polyline"] = pl;
    }
    edges_out.push_back(std::move(e));
  }
  return json{{"vertices", vertices}, {"edges", edges_out}};
}

// ── Build the key→edge-id lookup from a serialized topology (topology_edge_key) ─
namespace {
std::unordered_map<std::string, std::string> build_edge_id_lookup(const json& topology) {
  // Key serialized to a string for hashing (lo,mid,hi quantized triples).
  std::unordered_map<std::string, std::string> id_by_key;
  if (!topology.contains("edges")) return id_by_key;
  auto qrt = [](const json& v) -> QPos {
    return quantize(v.at(0).get<double>(), v.at(1).get<double>(), v.at(2).get<double>());
  };
  auto key_str = [](const QPos& lo, const QPos& mid, const QPos& hi) {
    std::ostringstream os;
    os << lo[0] << ',' << lo[1] << ',' << lo[2] << '|' << mid[0] << ',' << mid[1] << ',' << mid[2]
       << '|' << hi[0] << ',' << hi[1] << ',' << hi[2];
    return os.str();
  };
  for (const auto& e : topology.at("edges")) {
    const auto& ep = e.at("endpoints");
    QPos start = qrt(ep.at(0));
    QPos end = qrt(ep.at(1));
    QPos lo = start, hi = end;
    if (!(start <= end)) { lo = end; hi = start; }
    QPos mid = lo;
    if (e.contains("polyline") && e.at("polyline").is_array()) {
      const auto& poly = e.at("polyline");
      if (poly.size() >= 3) mid = qrt(poly.at(poly.size() / 2));
    }
    id_by_key[key_str(lo, mid, hi)] = e.at("id").get<std::string>();
  }
  return id_by_key;
}

std::string key_to_str(const Key& k) {
  std::ostringstream os;
  os << k[0][0] << ',' << k[0][1] << ',' << k[0][2] << '|' << k[1][0] << ',' << k[1][1] << ','
     << k[1][2] << '|' << k[2][0] << ',' << k[2][1] << ',' << k[2][2];
  return os.str();
}

// Build one FaceMesh json object for a face with a given persistent id.
json make_face_mesh(const TopoDS_Face& face, const std::string& id, bool force_flat,
                    const std::unordered_map<std::string, std::string>& id_by_key) {
  FaceMeshArrays m = mesh_face(face);
  bool flat = force_flat ? true : looks_flat(m.normals);

  std::vector<std::string> boundary;
  if (!id_by_key.empty()) {
    for (const TopoDS_Edge& e : face_edges(face)) {
      auto it = id_by_key.find(key_to_str(edge_geom_key(e)));
      if (it != id_by_key.end()) boundary.push_back(it->second);
    }
    std::sort(boundary.begin(), boundary.end());
    boundary.erase(std::unique(boundary.begin(), boundary.end()), boundary.end());
  }

  json fm;
  fm["faceId"] = id;
  fm["persistentName"] = id;
  fm["isFlat"] = flat;
  fm["positions"] = m.positions;
  fm["normals"] = m.normals;
  fm["indices"] = m.indices;
  if (!boundary.empty()) fm["boundaryEdgeIds"] = boundary;
  json surf;
  if (classify_face_surface(face, surf)) fm["surface"] = surf;
  return fm;
}
}  // namespace

// ── tessellate_named (extrude/revolve/sweep/loft cap/side classification) ────
Tessellated tessellate_named(const TopoDS_Shape& shape, const gp_Pnt& plane_origin,
                             const gp_Dir& plane_normal, double signed_distance,
                             const std::string& feature_id) {
  json topology = extract_topology(shape);
  auto id_by_key = build_edge_id_lookup(topology);

  std::vector<TopoDS_Face> faces = collect_faces(shape);
  double tol = std::max(std::fabs(signed_distance) * 1e-3, 1e-6);

  enum class Kind { CapBottom, Side, CapTop };
  struct Entry {
    Kind kind;
    TopoDS_Face face;
    double angle;
  };
  std::vector<Entry> classified;
  classified.reserve(faces.size());
  for (const TopoDS_Face& f : faces) {
    gp_Pnt cm = face_center_of_mass(f);
    gp_Vec offset(plane_origin, cm);
    gp_Vec normal_vec(plane_normal);
    double axial = offset.Dot(normal_vec);
    Kind kind;
    if (std::fabs(axial) <= tol) kind = Kind::CapBottom;
    else if (std::fabs(axial - signed_distance) <= tol) kind = Kind::CapTop;
    else kind = Kind::Side;
    gp_Vec in_plane = offset.Subtracted(normal_vec.Multiplied(axial));
    double angle = std::atan2(in_plane.Z(), in_plane.X());
    classified.push_back({kind, f, angle});
  }

  auto order = [](Kind k) { return k == Kind::CapBottom ? 0 : (k == Kind::Side ? 1 : 2); };
  std::stable_sort(classified.begin(), classified.end(), [&](const Entry& a, const Entry& b) {
    int oa = order(a.kind), ob = order(b.kind);
    if (oa != ob) return oa < ob;
    return a.angle < b.angle;
  });

  json faces_out = json::array();
  uint32_t side_index = 0;
  for (const Entry& e : classified) {
    std::string id;
    bool force_flat;
    if (e.kind == Kind::CapBottom) {
      id = persistent_name(feature_id, "cap-bottom", 0);
      force_flat = true;
    } else if (e.kind == Kind::CapTop) {
      id = persistent_name(feature_id, "cap-top", 0);
      force_flat = true;
    } else {
      id = persistent_name(feature_id, "side", side_index++);
      force_flat = false;
    }
    faces_out.push_back(make_face_mesh(e.face, id, force_flat, id_by_key));
  }
  return Tessellated{faces_out, topology};
}

// ── tessellate_generic (boolean/pattern/shell/blend) ─────────────────────────
Tessellated tessellate_generic(const TopoDS_Shape& shape, const std::string& scope) {
  json topology = extract_topology(shape);
  auto id_by_key = build_edge_id_lookup(topology);

  // Sort faces by centroid lexicographically (deterministic ids).
  std::vector<TopoDS_Face> faces = collect_faces(shape);
  std::vector<std::pair<gp_Pnt, TopoDS_Face>> with_c;
  with_c.reserve(faces.size());
  for (const TopoDS_Face& f : faces) with_c.push_back({face_center_of_mass(f), f});
  std::stable_sort(with_c.begin(), with_c.end(), [](const auto& a, const auto& b) {
    if (a.first.X() != b.first.X()) return a.first.X() < b.first.X();
    if (a.first.Y() != b.first.Y()) return a.first.Y() < b.first.Y();
    return a.first.Z() < b.first.Z();
  });

  json faces_out = json::array();
  for (size_t i = 0; i < with_c.size(); ++i) {
    std::string id = persistent_name(scope, "side", static_cast<uint32_t>(i));
    faces_out.push_back(make_face_mesh(with_c[i].second, id, /*force_flat=*/false, id_by_key));
  }
  return Tessellated{faces_out, topology};
}

// ── decompose_into_solids ────────────────────────────────────────────────────
json decompose_into_solids(const TopoDS_Shape& shape, const std::string& scope) {
  json parts = json::array();
  size_t i = 0;
  for (TopExp_Explorer ex(shape, TopAbs_SOLID); ex.More(); ex.Next(), ++i) {
    TopoDS_Solid solid = TopoDS::Solid(ex.Current());
    std::string solid_scope = scope + "#body" + std::to_string(i);
    Tessellated t = tessellate_generic(solid, solid_scope);
    double volume;
    gp_Pnt centroid;
    volume_centroid(solid, volume, centroid);
    parts.push_back(json{{"brepBytes", brep_to_base64(solid)},
                         {"centroid", {centroid.X(), centroid.Y(), centroid.Z()}},
                         {"volume", volume},
                         {"faces", t.faces},
                         {"topology", t.topology}});
  }
  return parts;
}

// ── Mass properties ──────────────────────────────────────────────────────────
void volume_centroid(const TopoDS_Shape& shape, double& volume, gp_Pnt& centroid) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props, /*OnlyClosed=*/Standard_False,
                              /*SkipShared=*/Standard_False, /*UseTriangulation=*/Standard_True);
  volume = props.Mass();
  centroid = props.CentreOfMass();
}

void volume_centroid_exact(const TopoDS_Shape& shape, double& volume, gp_Pnt& centroid) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props, /*OnlyClosed=*/Standard_False,
                              /*SkipShared=*/Standard_False, /*UseTriangulation=*/Standard_False);
  volume = props.Mass();
  centroid = props.CentreOfMass();
}

// ── Cylinder-surface canonicalization (edge-preserving) ───────────────────────
// A boolean can leave a cylinder fragmented into faces whose surfaces carry
// OPPOSITE axis directions (a +Y boss meeting a -Y hole wall). The faces SHARE
// their edges (they're adjacent), so the only thing blocking the merge is that
// UnifySameDomain treats +axis vs -axis cylinders as different domains. We re-base
// the non-canonical faces onto a deterministic canonical cylinder surface so all
// coaxial faces are the same domain, then UnifySameDomain merges them into ONE
// face. Crucially this preserves EDGE IDENTITY: BRep_Builder::UpdateEdge ADDS a
// pcurve for the new surface to the EXISTING edge (it does not copy the edge), so
// the shared-edge topology UnifySameDomain depends on stays intact. (The earlier
// BRepBuilderAPI_MakeFace approach copied edges → broke sharing → inverted solids.)
static gp_Dir canonical_dir(const gp_Dir& d) {
  const double e = 1e-9;
  if (d.X() < -e) return d.Reversed();
  if (d.X() > e) return d;
  if (d.Y() < -e) return d.Reversed();
  if (d.Y() > e) return d;
  return (d.Z() < 0) ? d.Reversed() : d;
}
static gp_Dir canonical_perp(const gp_Dir& z) {
  gp_Dir seed = (std::fabs(z.Dot(gp_Dir(1, 0, 0))) < 0.9) ? gp_Dir(1, 0, 0) : gp_Dir(0, 1, 0);
  return gp_Dir(gp_Vec(z).Crossed(gp_Vec(seed)));
}

// Re-base `face` onto `surf` in place: add a pcurve for `surf` to each existing
// edge (UpdateEdge — preserves the edge object) then build a face on `surf`
// reusing the same wires. Returns null on any failure or if the result isn't a
// valid, meshable face (caller keeps the original).
static TopoDS_Face rebase_cyl_face(const TopoDS_Face& face, const Handle(Geom_Surface)& surf) {
  BRep_Builder b;
  const double tol = BRep_Tool::Tolerance(face);
  for (TopExp_Explorer ex(face, TopAbs_EDGE); ex.More(); ex.Next()) {
    TopoDS_Edge e = TopoDS::Edge(ex.Current());
    if (BRep_Tool::Degenerated(e)) return TopoDS_Face();  // seam edge — bail (rare for arcs)
    double f, l;
    Handle(Geom_Curve) c3d = BRep_Tool::Curve(e, f, l);
    if (c3d.IsNull()) return TopoDS_Face();
    Handle(Geom2d_Curve) pc = GeomProjLib::Curve2d(c3d, f, l, surf);
    if (pc.IsNull()) return TopoDS_Face();
    b.UpdateEdge(e, pc, surf, TopLoc_Location(), tol);
  }
  TopoDS_Face nf;
  b.MakeFace(nf, surf, TopLoc_Location(), tol);
  for (TopExp_Explorer wx(face, TopAbs_WIRE); wx.More(); wx.Next()) b.Add(nf, wx.Current());
  nf.Orientation(face.Orientation());
  BRepLib::SameParameter(nf, tol, Standard_True);
  BRepCheck_Analyzer ana(nf);
  if (!ana.IsValid()) return TopoDS_Face();
  return nf;
}

static TopoDS_Shape canonicalize_cyl_faces(const TopoDS_Shape& shape) {
  Handle(ShapeBuild_ReShape) reshape = new ShapeBuild_ReShape();
  bool any = false;
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
    TopoDS_Face face = TopoDS::Face(ex.Current());
    BRepAdaptor_Surface ad(face);
    if (ad.GetType() != GeomAbs_Cylinder) continue;
    gp_Cylinder cyl = ad.Cylinder();
    gp_Dir z = cyl.Axis().Direction();
    gp_Dir cz = canonical_dir(z);
    if (cz.IsEqual(z, 1e-9)) continue;  // already canonical direction → leave it
    gp_Lin axis(cyl.Axis().Location(), cz);
    gp_Pnt loc = ElCLib::Value(ElCLib::Parameter(axis, gp_Pnt(0, 0, 0)), axis);
    gp_Ax3 newPos(loc, cz, canonical_perp(cz));
    Handle(Geom_CylindricalSurface) ns = new Geom_CylindricalSurface(newPos, cyl.Radius());
    TopoDS_Face nf;
    try { nf = rebase_cyl_face(face, ns); }
    catch (const Standard_Failure&) { continue; }
    if (nf.IsNull()) continue;
    reshape->Replace(face, nf);
    any = true;
  }
  return any ? reshape->Apply(shape) : shape;
}

// ── Boolean fuzzy tolerance (bbox-relative) ──────────────────────────────────
double boolean_fuzzy(const TopoDS_Shape& a, const TopoDS_Shape& b) {
  Bnd_Box box;
  BRepBndLib::Add(a, box);
  BRepBndLib::Add(b, box);
  if (box.IsVoid()) return 0.0;
  double xmin, ymin, zmin, xmax, ymax, zmax;
  box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  const double dx = xmax - xmin, dy = ymax - ymin, dz = zmax - zmin;
  const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
  return std::max(diag * 1.0e-6, 1.0e-5);
}

// ── Boolean cleanup (UnifySameDomain) ────────────────────────────────────────
TopoDS_Shape clean_unify(const TopoDS_Shape& shape) {
  // Canonicalize coaxial cylinder surfaces (edge-preserving) so opposite-axis
  // fragments become the same domain and UnifySameDomain merges them into one
  // face. The per-face rebase is geometry-preserving in principle, but on some
  // bodies it flips a face's effective orientation and INVERTS the solid
  // (negative volume → faces render on the wrong side / appear missing). GUARD:
  // keep the canonicalized shape ONLY when it preserves the signed volume; else
  // fall back to the un-canonicalized shape (the seam edge is still dropped from
  // the view by detect_tangent_edges, so the cylinder still reads continuous).
  TopoDS_Shape canon = shape;
  try {
    TopoDS_Shape c = canonicalize_cyl_faces(shape);
    if (!c.IsSame(shape)) {
      double v0 = 0, v1 = 0; gp_Pnt cc;
      volume_centroid_exact(shape, v0, cc);
      volume_centroid_exact(c, v1, cc);
      const double tol = 1e-6 * std::fabs(v0) + 1e-9;
      if (v1 > 0 && std::fabs(v1 - v0) <= tol) canon = c;  // volume preserved → safe
    }
  } catch (const Standard_Failure&) { canon = shape; }
  ShapeUpgrade_UnifySameDomain upgrader(canon, true, true, true);
  upgrader.AllowInternalEdges(false);
  upgrader.Build();
  return upgrader.Shape();
}

}  // namespace kernel
