// Topological face naming (REQs 1035–1039). See
// docs/cad-system/kernel/topological-naming-plan.md.
//
// A face's name is a PersistentName JSON string. Names ride inside every BRep
// payload (a trailer after the BinTools bytes, aligned with
// TopExp::MapShapes(shape, TopAbs_FACE) order), and each op hands its result a
// fresh FaceNaming via name_result(): faces that keep any part of an input face
// inherit its name; new faces are named from what created them.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include <NCollection_DataMap.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>

namespace kernel {

// Structured persistent name. Encoded field order: feature_id, role,
// sub_index, instance?, body?, split?, upstream_refs.
struct NameParts {
  std::string feature_id;
  std::string role;
  uint32_t sub_index = 0;
  std::string instance;  // pattern / copy instance path, e.g. "f7#2" or "f9#1/f7#2"
  std::string body;      // body a compose tool face was cut/fused into
  std::string split;     // piece path when an op split the face, e.g. "1" or "1.2"
  std::vector<std::string> refs;
};
NameParts parse_name(const std::string& name);
std::string encode_name(const NameParts& parts);
// 12 hex chars of FNV-1a 64 — bounded-length references to other names.
std::string short_hash(const std::string& s);

// Names (and merge aliases) of the faces of one shape, keyed by face identity.
class FaceNaming {
 public:
  void set(const TopoDS_Shape& face, const std::string& name);
  void add_alias(const TopoDS_Shape& face, const std::string& alias);
  const std::string* find(const TopoDS_Shape& face) const;
  const std::vector<std::string>* aliases(const TopoDS_Shape& face) const;
  bool empty() const { return names_.IsEmpty(); }
  // Names aligned with TopExp::MapShapes(shape, TopAbs_FACE); "" = unnamed.
  std::vector<std::string> aligned(const TopoDS_Shape& shape) const;

 private:
  NCollection_DataMap<TopoDS_Shape, std::string, TopTools_ShapeMapHasher> names_;
  NCollection_DataMap<TopoDS_Shape, std::vector<std::string>, TopTools_ShapeMapHasher> aliases_;
};

// A named op input. `body` / `instance` qualify every name it donates.
struct NameSource {
  TopoDS_Shape shape;
  std::vector<std::string> names;  // aligned with MapShapes(shape, FACE); may be empty
  std::string body;
  std::string instance;
};

struct NamingOptions {
  // Shell wall thickness (> 0 enables the offset rule: a new wall that is the
  // offset of input face X is named after X).
  double offset = 0.0;
};

// Name every face of `result`. New faces use `scope` as their feature_id.
FaceNaming name_result(const TopoDS_Shape& result, const std::vector<NameSource>& inputs,
                       const std::string& scope, const NamingOptions& opts = {});

// Make names unique within `shape`: faces sharing a name become split pieces
// (the largest keeps the plain name).
void resolve_duplicate_names(const TopoDS_Shape& shape, FaceNaming& naming);

// A point strictly inside the face (not its centroid, which can fall in a
// hole or off a curved face).
gp_Pnt face_interior_point(const TopoDS_Face& face);

// BRep payload trailer: [brep bytes][names JSON][u64 LE length]["LWNAMES1"].
void append_name_trailer(std::string& bytes, const std::vector<std::string>& names);
// Strips a trailer from `bytes` if present and returns its names (else empty).
std::vector<std::string> strip_name_trailer(std::vector<unsigned char>& bytes);

}  // namespace kernel
