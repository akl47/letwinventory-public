// Topological face naming — see naming.hpp and
// docs/cad-system/kernel/topological-naming-plan.md.
#include "naming.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>

#include <nlohmann/json.hpp>

#include <BOPTools_AlgoTools3D.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <IntTools_Context.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Cone.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Lin.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Sphere.hxx>
#include <gp_Torus.hxx>
#include <gp_Vec.hxx>

namespace kernel {

using nlohmann::json;

// ── Name encoding ───────────────────────────────────────────────────────────
NameParts parse_name(const std::string& name) {
  NameParts p;
  json j = json::parse(name, nullptr, /*allow_exceptions=*/false);
  if (!j.is_object()) {
    p.feature_id = name;
    return p;
  }
  p.feature_id = j.value("feature_id", std::string());
  p.role = j.value("role", std::string());
  if (j.contains("sub_index") && j["sub_index"].is_number_unsigned()) p.sub_index = j["sub_index"].get<uint32_t>();
  p.instance = j.value("instance", std::string());
  p.body = j.value("body", std::string());
  p.split = j.value("split", std::string());
  if (j.contains("upstream_refs") && j["upstream_refs"].is_array()) {
    for (const auto& r : j["upstream_refs"]) {
      if (r.is_string()) p.refs.push_back(r.get<std::string>());
    }
  }
  return p;
}

std::string encode_name(const NameParts& p) {
  // Fixed field order (nlohmann sorts object keys, so build the string by hand).
  std::ostringstream os;
  os << "{\"feature_id\":" << json(p.feature_id).dump() << ",\"role\":" << json(p.role).dump()
     << ",\"sub_index\":" << p.sub_index;
  if (!p.instance.empty()) os << ",\"instance\":" << json(p.instance).dump();
  if (!p.body.empty()) os << ",\"body\":" << json(p.body).dump();
  if (!p.split.empty()) os << ",\"split\":" << json(p.split).dump();
  os << ",\"upstream_refs\":" << json(p.refs).dump() << "}";
  return os.str();
}

std::string short_hash(const std::string& s) {
  uint64_t h = 1469598103934665603ULL;
  for (unsigned char c : s) {
    h ^= c;
    h *= 1099511628211ULL;
  }
  char buf[17];
  std::snprintf(buf, sizeof buf, "%016llx", static_cast<unsigned long long>(h));
  return std::string(buf, 12);
}

// ── FaceNaming ──────────────────────────────────────────────────────────────
void FaceNaming::set(const TopoDS_Shape& face, const std::string& name) {
  if (names_.IsBound(face)) names_.ChangeFind(face) = name;
  else names_.Bind(face, name);
}

void FaceNaming::add_alias(const TopoDS_Shape& face, const std::string& alias) {
  if (!aliases_.IsBound(face)) aliases_.Bind(face, std::vector<std::string>());
  std::vector<std::string>& v = aliases_.ChangeFind(face);
  if (std::find(v.begin(), v.end(), alias) == v.end()) v.push_back(alias);
}

const std::string* FaceNaming::find(const TopoDS_Shape& face) const { return names_.Seek(face); }

const std::vector<std::string>* FaceNaming::aliases(const TopoDS_Shape& face) const {
  return aliases_.Seek(face);
}

std::vector<std::string> FaceNaming::aligned(const TopoDS_Shape& shape) const {
  TopTools_IndexedMapOfShape faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  std::vector<std::string> out;
  out.reserve(faces.Extent());
  for (int i = 1; i <= faces.Extent(); ++i) {
    const std::string* n = find(faces(i));
    out.push_back(n ? *n : std::string());
  }
  return out;
}

// ── BRep trailer ────────────────────────────────────────────────────────────
namespace {
constexpr char TRAILER_MAGIC[8] = {'L', 'W', 'N', 'A', 'M', 'E', 'S', '1'};
}

void append_name_trailer(std::string& bytes, const std::vector<std::string>& names) {
  const std::string payload = json(names).dump();
  bytes += payload;
  uint64_t len = payload.size();
  for (int i = 0; i < 8; ++i) bytes.push_back(static_cast<char>((len >> (8 * i)) & 0xFF));
  bytes.append(TRAILER_MAGIC, 8);
}

std::vector<std::string> strip_name_trailer(std::vector<unsigned char>& bytes) {
  if (bytes.size() < 16 || std::memcmp(bytes.data() + bytes.size() - 8, TRAILER_MAGIC, 8) != 0) return {};
  uint64_t len = 0;
  for (int i = 0; i < 8; ++i) len |= static_cast<uint64_t>(bytes[bytes.size() - 16 + i]) << (8 * i);
  if (len > bytes.size() - 16) return {};
  const size_t start = bytes.size() - 16 - static_cast<size_t>(len);
  json j = json::parse(bytes.begin() + start, bytes.end() - 16, nullptr, /*allow_exceptions=*/false);
  bytes.resize(start);
  std::vector<std::string> names;
  if (j.is_array()) {
    for (const auto& n : j) names.push_back(n.is_string() ? n.get<std::string>() : std::string());
  }
  return names;
}

// ── name_result ─────────────────────────────────────────────────────────────
namespace {

struct FaceInfo {
  TopoDS_Face face;
  Bnd_Box box;
  GeomAbs_SurfaceType type = GeomAbs_OtherSurface;
  gp_Pnt inner;
  double area = 0.0;
};

FaceInfo face_info(const TopoDS_Face& f, const Handle(IntTools_Context)& ctx) {
  FaceInfo fi;
  fi.face = f;
  BRepBndLib::Add(f, fi.box);
  fi.type = BRepAdaptor_Surface(f).GetType();
  GProp_GProps g;
  BRepGProp::SurfaceProperties(f, g);
  fi.area = g.Mass();
  gp_Pnt2d uv;
  bool ok = false;
  try {
    ok = BOPTools_AlgoTools3D::PointInFace(f, fi.inner, uv, ctx) == 0;
  } catch (const Standard_Failure&) {
    ok = false;
  }
  if (!ok) fi.inner = g.CentreOfMass();
  return fi;
}

// Lexicographic order on a point, quantized so tessellation noise can't flip it.
bool point_less(const gp_Pnt& a, const gp_Pnt& b) {
  auto q = [](double v) { return std::llround(v * 1.0e6); };
  if (q(a.X()) != q(b.X())) return q(a.X()) < q(b.X());
  if (q(a.Y()) != q(b.Y())) return q(a.Y()) < q(b.Y());
  return q(a.Z()) < q(b.Z());
}

bool parallel(const gp_Dir& a, const gp_Dir& b) { return a.IsParallel(b, 1.0e-6); }

// Same underlying surface, ignoring orientation and trimming.
bool same_surface(const FaceInfo& a, const FaceInfo& b, double tol) {
  if (a.type != b.type) return false;
  BRepAdaptor_Surface sa(a.face), sb(b.face);
  switch (a.type) {
    case GeomAbs_Plane: {
      gp_Pln pa = sa.Plane(), pb = sb.Plane();
      return parallel(pa.Axis().Direction(), pb.Axis().Direction()) &&
             pa.Distance(pb.Location()) <= tol;
    }
    case GeomAbs_Cylinder: {
      gp_Cylinder ca = sa.Cylinder(), cb = sb.Cylinder();
      return parallel(ca.Axis().Direction(), cb.Axis().Direction()) &&
             gp_Lin(ca.Axis()).Distance(cb.Axis().Location()) <= tol &&
             std::fabs(ca.Radius() - cb.Radius()) <= tol;
    }
    case GeomAbs_Cone: {
      gp_Cone ca = sa.Cone(), cb = sb.Cone();
      return parallel(ca.Axis().Direction(), cb.Axis().Direction()) &&
             ca.Apex().Distance(cb.Apex()) <= tol &&
             std::fabs(ca.SemiAngle() - cb.SemiAngle()) <= 1.0e-6;
    }
    case GeomAbs_Sphere: {
      gp_Sphere ca = sa.Sphere(), cb = sb.Sphere();
      return ca.Location().Distance(cb.Location()) <= tol && std::fabs(ca.Radius() - cb.Radius()) <= tol;
    }
    case GeomAbs_Torus: {
      gp_Torus ca = sa.Torus(), cb = sb.Torus();
      return parallel(ca.Axis().Direction(), cb.Axis().Direction()) &&
             ca.Location().Distance(cb.Location()) <= tol &&
             std::fabs(ca.MajorRadius() - cb.MajorRadius()) <= tol &&
             std::fabs(ca.MinorRadius() - cb.MinorRadius()) <= tol;
    }
    default:
      return true;  // freeform: decided by the on-surface + normal checks in overlaps()
  }
}

// Unit normal of `f`'s surface at the projection of `p`; false if p is off it.
bool normal_near(const TopoDS_Face& f, const gp_Pnt& p, const Handle(IntTools_Context)& ctx,
                 double max_dist, gp_Dir& n, double* dist = nullptr) {
  GeomAPI_ProjectPointOnSurf& proj = ctx->ProjPS(f);
  proj.Perform(p);
  if (!proj.IsDone() || proj.NbPoints() == 0) return false;
  if (dist) *dist = proj.LowerDistance();
  if (proj.LowerDistance() > max_dist) return false;
  double u, v;
  proj.LowerDistanceParameters(u, v);
  BRepAdaptor_Surface s(f, /*restriction=*/Standard_False);
  gp_Pnt pt;
  gp_Vec du, dv;
  s.D1(u, v, pt, du, dv);
  gp_Vec nv = du.Crossed(dv);
  if (nv.Magnitude() < 1.0e-12) return false;
  n = gp_Dir(nv);
  return true;
}

// a's region and b's region overlap on the shared surface.
bool overlaps(const FaceInfo& a, const FaceInfo& b, const Handle(IntTools_Context)& ctx, double tol) {
  auto inside = [&](const FaceInfo& from, const FaceInfo& into) {
    if (!ctx->IsValidPointForFace(from.inner, into.face, tol)) return false;
    if (from.type == GeomAbs_Plane || from.type == GeomAbs_Cylinder || from.type == GeomAbs_Cone ||
        from.type == GeomAbs_Sphere || from.type == GeomAbs_Torus) return true;
    gp_Dir n1, n2;
    return normal_near(from.face, from.inner, ctx, tol, n1) && normal_near(into.face, from.inner, ctx, tol, n2) &&
           parallel(n1, n2);
  };
  return inside(a, b) || inside(b, a);
}

// `out` is a wall offset by `dist` from input face `in` (shell inner/outer wall).
bool is_offset_of(const FaceInfo& out, const FaceInfo& in, double dist, const Handle(IntTools_Context)& ctx,
                  double tol) {
  double d = 0.0;
  gp_Dir n_in;
  if (!normal_near(in.face, out.inner, ctx, dist * 2.0 + tol, n_in, &d)) return false;
  if (std::fabs(d - dist) > tol * 10.0) return false;
  gp_Dir n_out;
  if (!normal_near(out.face, out.inner, ctx, tol, n_out) || !parallel(n_in, n_out)) return false;
  // The foot of the offset must land inside the source face.
  GeomAPI_ProjectPointOnSurf& proj = ctx->ProjPS(in.face);
  proj.Perform(out.inner);
  return ctx->IsValidPointForFace(proj.NearestPoint(), in.face, tol);
}

std::string qualify(const std::string& name, const NameSource& src) {
  if (src.body.empty() && src.instance.empty()) return name;
  NameParts p = parse_name(name);
  if (!src.body.empty()) p.body = src.body;
  if (!src.instance.empty()) p.instance = p.instance.empty() ? src.instance : src.instance + "/" + p.instance;
  return encode_name(p);
}

}  // namespace

gp_Pnt face_interior_point(const TopoDS_Face& face) {
  Handle(IntTools_Context) ctx = new IntTools_Context();
  return face_info(face, ctx).inner;
}

void resolve_duplicate_names(const TopoDS_Shape& shape, FaceNaming& naming) {
  TopTools_IndexedMapOfShape faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  std::map<std::string, std::vector<int>> by_name;
  std::set<std::string> taken;
  for (int i = 1; i <= faces.Extent(); ++i) {
    const std::string* n = naming.find(faces(i));
    if (n) {
      by_name[*n].push_back(i);
      taken.insert(*n);
    }
  }
  Handle(IntTools_Context) ctx = new IntTools_Context();
  for (auto& [name, idx] : by_name) {
    if (idx.size() < 2) continue;
    std::vector<FaceInfo> info;
    for (int i : idx) info.push_back(face_info(TopoDS::Face(faces(i)), ctx));
    std::vector<size_t> order(idx.size());
    for (size_t k = 0; k < order.size(); ++k) order[k] = k;
    std::sort(order.begin(), order.end(), [&](size_t a, size_t b) {
      if (std::fabs(info[a].area - info[b].area) > 1.0e-9 * std::max(1.0, info[a].area))
        return info[a].area > info[b].area;
      return point_less(info[a].inner, info[b].inner);
    });
    NameParts base = parse_name(name);
    int next = 1;
    for (size_t k = 1; k < order.size(); ++k) {
      std::string candidate;
      do {
        NameParts p = base;
        p.split = (base.split.empty() ? "" : base.split + ".") + std::to_string(next++);
        candidate = encode_name(p);
      } while (taken.count(candidate));
      taken.insert(candidate);
      naming.set(faces(idx[order[k]]), candidate);
    }
  }
}

FaceNaming name_result(const TopoDS_Shape& result, const std::vector<NameSource>& inputs,
                       const std::string& scope, const NamingOptions& opts) {
  Handle(IntTools_Context) ctx = new IntTools_Context();
  Bnd_Box whole;
  BRepBndLib::Add(result, whole);
  double tol = 1.0e-4;
  if (!whole.IsVoid()) tol = std::max(tol, std::sqrt(whole.SquareExtent()) * 1.0e-6);

  // Named input faces, in priority order (earlier sources win merges).
  struct InFace {
    FaceInfo info;
    std::string name;
    size_t prio;
  };
  std::vector<InFace> in;
  for (size_t s = 0; s < inputs.size(); ++s) {
    TopTools_IndexedMapOfShape faces;
    TopExp::MapShapes(inputs[s].shape, TopAbs_FACE, faces);
    if (static_cast<int>(inputs[s].names.size()) != faces.Extent()) continue;  // unnamed source
    for (int i = 1; i <= faces.Extent(); ++i) {
      if (inputs[s].names[i - 1].empty()) continue;
      in.push_back({face_info(TopoDS::Face(faces(i)), ctx), qualify(inputs[s].names[i - 1], inputs[s]), s});
    }
  }

  TopTools_IndexedMapOfShape out_faces;
  TopExp::MapShapes(result, TopAbs_FACE, out_faces);
  const int n_out = out_faces.Extent();
  std::vector<FaceInfo> out(n_out);
  for (int i = 0; i < n_out; ++i) out[i] = face_info(TopoDS::Face(out_faces(i + 1)), ctx);

  FaceNaming naming;
  std::vector<bool> named(n_out, false);

  // 1. Inherit: same surface + overlapping region.
  for (int i = 0; i < n_out; ++i) {
    std::vector<const InFace*> hits;
    for (const InFace& f : in) {
      if (out[i].box.IsOut(f.info.box)) continue;
      if (!same_surface(out[i], f.info, tol)) continue;
      if (!overlaps(out[i], f.info, ctx, tol)) continue;
      hits.push_back(&f);
    }
    if (hits.empty()) continue;
    std::sort(hits.begin(), hits.end(), [](const InFace* a, const InFace* b) {
      return a->prio != b->prio ? a->prio < b->prio : a->name < b->name;
    });
    naming.set(out_faces(i + 1), hits[0]->name);
    for (size_t k = 1; k < hits.size(); ++k) {
      if (hits[k]->name != hits[0]->name) naming.add_alias(out_faces(i + 1), hits[k]->name);
    }
    named[i] = true;
  }

  // 2. Offset rule (shell walls).
  if (opts.offset > 0.0) {
    for (int i = 0; i < n_out; ++i) {
      if (named[i]) continue;
      for (const InFace& f : in) {
        if (!is_offset_of(out[i], f.info, opts.offset, ctx, tol)) continue;
        NameParts p;
        p.feature_id = scope;
        p.role = "offset";
        p.refs = {short_hash(f.name)};
        naming.set(out_faces(i + 1), encode_name(p));
        named[i] = true;
        break;
      }
    }
  }

  // 3. Neighbors, to a fixpoint: a new face is named by the named faces around it.
  TopTools_IndexedDataMapOfShapeListOfShape edge_faces;
  TopExp::MapShapesAndAncestors(result, TopAbs_EDGE, TopAbs_FACE, edge_faces);
  std::vector<std::set<int>> adj(n_out);
  for (int e = 1; e <= edge_faces.Extent(); ++e) {
    std::vector<int> fs;
    for (const TopoDS_Shape& f : edge_faces(e)) {
      int idx = out_faces.FindIndex(f);
      if (idx > 0) fs.push_back(idx - 1);
    }
    for (int a : fs) {
      for (int b : fs) {
        if (a != b) adj[a].insert(b);
      }
    }
  }
  for (bool progress = true; progress;) {
    progress = false;
    std::vector<std::pair<int, std::vector<std::string>>> round;
    for (int i = 0; i < n_out; ++i) {
      if (named[i]) continue;
      std::set<std::string> refs;
      for (int j : adj[i]) {
        if (named[j]) refs.insert(short_hash(*naming.find(out_faces(j + 1))));
      }
      if (!refs.empty()) round.push_back({i, std::vector<std::string>(refs.begin(), refs.end())});
    }
    for (auto& [i, refs] : round) {
      NameParts p;
      p.feature_id = scope;
      p.role = "new";
      p.refs = refs;
      naming.set(out_faces(i + 1), encode_name(p));
      named[i] = true;
      progress = true;
    }
  }

  // 4. Last resort: positional within the feature.
  std::vector<int> rest;
  for (int i = 0; i < n_out; ++i) {
    if (!named[i]) rest.push_back(i);
  }
  std::sort(rest.begin(), rest.end(), [&](int a, int b) { return point_less(out[a].inner, out[b].inner); });
  for (size_t k = 0; k < rest.size(); ++k) {
    NameParts p;
    p.feature_id = scope;
    p.role = "side";
    p.sub_index = static_cast<uint32_t>(k);
    naming.set(out_faces(rest[k] + 1), encode_name(p));
  }

  resolve_duplicate_names(result, naming);
  return naming;
}

}  // namespace kernel
