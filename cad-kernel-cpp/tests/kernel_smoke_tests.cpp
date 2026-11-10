// Assert-based geometry smoke tests (REQ 904), run during the Docker image
// build — a geometry regression fails the build, so a broken kernel can never
// be published. Exercises ops through their real JSON contracts.
//
// Cases:
//   1. buildExtrude:  10x10 square x 5  → volume 500
//   2. buildBoolean:  cut a 4x4x5 block out of (1) → volume 420
//   3. buildSweep:    Ø15 tube on an L-path with bend radius == tube radius
//                     (the pinched-elbow case, NAMING 46-48 regressions) —
//                     must build with a properly curved elbow (volume check)
//   4. buildShell:    hollow (3) 2mm removing the end cap — exercises the
//                     pinched-torus clearance workaround (used to segfault)
//   5. bodyVolume:    exact volume/centroid backs all of the above
//   8. buildShell on a box with a counterbored through hole: ByJoin returns
//                     an invalid solid; the hole-tube fallback must give the
//                     analytic volume (REQ 1020)
//   9. fillet corner refit: r5 round over r3 corners comes back creased; the
//                     refit must make a 2mm shell of it tight (REQ 1021)

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>

#include <nlohmann/json.hpp>

#include "../src/geom_io.hpp"
#include "../src/op_extrude.hpp"
#include "../src/op_boolean.hpp"
#include "../src/op_revolve_sweep.hpp"
#include "../src/op_shell_blend.hpp"
#include "../src/server_limits.hpp"
#include "../src/blend_corner_refit.hpp"
#include "../src/shell_hole_fallback.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>

#include <algorithm>
#include <fstream>
#include <sys/stat.h>
#include <unistd.h>

using json = nlohmann::json;

static int g_failures = 0;

#define CHECK(cond, ...)                                                   \
  do {                                                                     \
    if (!(cond)) {                                                         \
      std::fprintf(stderr, "FAIL %s:%d: ", __FILE__, __LINE__);            \
      std::fprintf(stderr, __VA_ARGS__);                                   \
      std::fprintf(stderr, "\n");                                          \
      g_failures++;                                                        \
    }                                                                      \
  } while (0)

static json plane_xy() {
  return json{
      {"xAxis", {1, 0, 0}}, {"yAxis", {0, 1, 0}},
      {"normal", {0, 0, 1}}, {"origin", {0, 0, 0}},
  };
}

static json line(double x1, double y1, double x2, double y2) {
  return json{{"kind", "line"},
              {"start", {{"x", x1}, {"y", y1}}},
              {"end", {{"x", x2}, {"y", y2}}}};
}

static json square(double cx, double cy, double half) {
  return json::array({
      line(cx - half, cy - half, cx + half, cy - half),
      line(cx + half, cy - half, cx + half, cy + half),
      line(cx + half, cy + half, cx - half, cy + half),
      line(cx - half, cy + half, cx - half, cy - half),
  });
}

static double volume_of(const std::string& brep_b64) {
  json v = kernel::op_bodyVolume(json{{"aBrep", brep_b64}});
  return v.at("volume").get<double>();
}


// ── Naming helpers (case 10) ────────────────────────────────────────────────
static json line_sid(double x1, double y1, double x2, double y2, const char* sid) {
  json l = line(x1, y1, x2, y2);
  l["sid"] = sid;
  return l;
}

// Ids of planar faces with outward normal n at offset d (n·origin == d).
static std::vector<std::string> plane_face_ids(const json& res, double nx, double ny, double nz, double d) {
  std::vector<std::string> out;
  for (const auto& f : res.at("faces")) {
    if (!f.contains("surface") || f["surface"].value("kind", "") != "plane") continue;
    const auto& n = f["surface"]["normal"];
    const auto& o = f["surface"]["origin"];
    const double dot = n[0].get<double>() * nx + n[1].get<double>() * ny + n[2].get<double>() * nz;
    const double off = o[0].get<double>() * nx + o[1].get<double>() * ny + o[2].get<double>() * nz;
    if (dot > 0.999 && std::fabs(off - d) < 1e-6) out.push_back(f.at("faceId").get<std::string>());
  }
  return out;
}

static const json* face_by_id(const json& res, const std::string& id) {
  for (const auto& f : res.at("faces")) {
    if (f.at("faceId").get<std::string>() == id) return &f;
  }
  return nullptr;
}

// Topology edge running from (x, y0, z) to (x, y1, z), either direction.
static std::string edge_id_at(const json& res, double x, double y0, double y1, double z) {
  for (const auto& e : res.at("topology").at("edges")) {
    const auto& a = e["endpoints"][0];
    const auto& b = e["endpoints"][1];
    auto at = [&](const json& p, double y) {
      return std::fabs(p[0].get<double>() - x) < 1e-6 && std::fabs(p[1].get<double>() - y) < 1e-6 &&
             std::fabs(p[2].get<double>() - z) < 1e-6;
    };
    if ((at(a, y0) && at(b, y1)) || (at(a, y1) && at(b, y0))) return e.at("id").get<std::string>();
  }
  return "";
}

static std::vector<std::string> ids_with(const json& res, const char* needle) {
  std::vector<std::string> out;
  for (const auto& f : res.at("faces")) {
    const std::string id = f.at("faceId").get<std::string>();
    if (id.find(needle) != std::string::npos) out.push_back(id);
  }
  std::sort(out.begin(), out.end());
  return out;
}

static json pocket(const char* id, double cx, double cy, double hx, double hy, double z0, double depth) {
  json pl = plane_xy();
  pl["origin"] = {0, 0, z0};
  return kernel::op_buildExtrude(json{
      {"featureId", id},
      {"profile", json::array({line(cx - hx, cy - hy, cx + hx, cy - hy), line(cx + hx, cy - hy, cx + hx, cy + hy),
                               line(cx + hx, cy + hy, cx - hx, cy + hy), line(cx - hx, cy + hy, cx - hx, cy - hy)})},
      {"plane", pl},
      {"distance", depth},
  });
}

static json cut_into(const char* id, const json& body, const json& tool) {
  return kernel::op_buildBoolean(json{{"featureId", id}, {"op", "cut"}, {"bodyId", "B"},
                                      {"aBrep", body.at("brepBytes")}, {"bBrep", tool.at("brepBytes")}});
}

int main() {
  // 1. Extrude a 10x10 square by 5 → 500 mm³.
  json extrude = kernel::op_buildExtrude(json{
      {"featureId", "t1"},
      {"profile", square(0, 0, 5)},
      {"plane", plane_xy()},
      {"distance", 5.0},
  });
  const std::string box = extrude.at("brepBytes").get<std::string>();
  double v1 = volume_of(box);
  CHECK(std::fabs(v1 - 500.0) < 1e-6, "extrude volume: want 500, got %.9f", v1);

  // 2. Cut a centered 4x4x5 block → 500 - 80 = 420 mm³.
  json tool = kernel::op_buildExtrude(json{
      {"featureId", "t2"},
      {"profile", square(0, 0, 2)},
      {"plane", plane_xy()},
      {"distance", 5.0},
  });
  json cut = kernel::op_buildBoolean(json{
      {"featureId", "t3"},
      {"op", "cut"},
      {"aBrep", box},
      {"bBrep", tool.at("brepBytes").get<std::string>()},
  });
  double v2 = volume_of(cut.at("brepBytes").get<std::string>());
  CHECK(std::fabs(v2 - 420.0) < 1e-6, "boolean cut volume: want 420, got %.9f", v2);

  // 3. Pinched-elbow sweep (bend radius == tube radius, the NAMING 46-48
  //    regression family): Ø15 circle along up-18 / quarter-bend-7.5 /
  //    out-18. Correct volume ≈ two 18mm legs + a quarter horn-torus elbow.
  const double c45 = std::cos(M_PI / 4.0), s45 = std::sin(M_PI / 4.0);
  json sweep = kernel::op_buildSweep(json{
      {"featureId", "t4"},
      {"profile", json::array({json{{"kind", "circle"},
                                    {"center", {{"x", 0}, {"y", 0}}},
                                    {"radius", 7.5}}})},
      {"holes", json::array()},
      {"profilePlane", plane_xy()},
      {"pathEdges", json::array({
          json{{"kind", "line"}, {"start", {0, 0, 0}}, {"end", {0, 0, 18}}},
          json{{"kind", "arc"},
               {"start", {0, 0, 18}},
               {"mid", {7.5 - 7.5 * c45, 0, 18 + 7.5 * s45}},
               {"end", {7.5, 0, 25.5}}},
          json{{"kind", "line"}, {"start", {7.5, 0, 25.5}}, {"end", {25.5, 0, 25.5}}},
      })},
  });
  const std::string tube = sweep.at("brepBytes").get<std::string>();
  double v3 = volume_of(tube);
  CHECK(std::fabs(v3 - 8443.5948) < 1.0,
        "pinched sweep volume: want ~8443.59, got %.4f (flat-chamfer elbow regression?)", v3);
  CHECK(sweep.at("faces").size() == 5,
        "pinched sweep faces: want 5, got %zu", sweep.at("faces").size());

  // 4. Shell the pinched tube 2mm removing the end cap — exercised the
  //    clearance workaround; used to SEGFAULT the whole kernel process.
  json shell = kernel::op_buildShell(json{
      {"featureId", "t5"},
      {"aBrep", tube},
      {"faces", json::array({json{{"centroid", {25.5, 0, 25.5}},
                                  {"normal", {1, 0, 0}}}})},
      {"thickness", -2.0},
      {"tolerance", 1.0e-3},
  });
  CHECK(shell.at("faces").size() == 9,
        "pinched-tube shell faces: want 9, got %zu", shell.at("faces").size());
  double v4 = volume_of(shell.at("brepBytes").get<std::string>());
  CHECK(v4 > 0 && v4 < v3, "shell volume must be positive and below the solid's (got %.4f)", v4);

  // 6. REQ 964 — stale export temp files are swept; other files are kept.
  {
    char tmpl[] = "/tmp/kernel-sweep-XXXXXX";
    const char* dir = mkdtemp(tmpl);
    CHECK(dir != nullptr, "mkdtemp failed");
    if (dir) {
      std::ofstream(std::string(dir) + "/cad-export-1-stl-0.stl") << "x";
      std::ofstream(std::string(dir) + "/cad-export-2-step-1.step") << "x";
      std::ofstream(std::string(dir) + "/keep-me.txt") << "x";
      int removed = kernel::sweep_stale_exports(dir);
      CHECK(removed == 2, "sweep removed %d files, want 2", removed);
      struct stat st{};
      CHECK(stat((std::string(dir) + "/keep-me.txt").c_str(), &st) == 0, "sweep must keep unrelated files");
      unlink((std::string(dir) + "/keep-me.txt").c_str());
      rmdir(dir);
    }
  }

  // 8. REQ 1020 — hole-tube shell fallback. A 40x40x20 box with a through
  //    counterbored hole, hollowed 2mm inward with the bottom removed: the
  //    hole becomes a 2mm tube. ByJoin returns an invalid solid here (26222);
  //    the fallback must be valid with the analytic volume:
  //    body 31597.9 − (cavity 36·36·18 − grown hole inside it) where the
  //    grown hole is r4 to z14 then r6 (square shoulder, as SolidWorks):
  //    π·16·14 + π·36·4 = 1156.1  →  9426.0.
  {
    TopoDS_Shape hole = BRepAlgoAPI_Fuse(
        BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 20, -1), gp_Dir(0, 0, 1)), 2.0, 22.0).Shape(),
        BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 20, 16), gp_Dir(0, 0, 1)), 4.0, 5.0).Shape());
    TopoDS_Shape body = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(40, 40, 20).Shape(), hole);
    TopTools_ListOfShape bottom;
    for (TopExp_Explorer e(body, TopAbs_FACE); e.More(); e.Next()) {
      BRepAdaptor_Surface a(TopoDS::Face(e.Current()));
      if (a.GetType() == GeomAbs_Plane && std::fabs(a.Plane().Location().Z()) < 1e-9 &&
          std::fabs(a.Plane().Axis().Direction().Z()) > 0.99) bottom.Append(e.Current());
    }
    CHECK(bottom.Extent() == 1, "hole box: want 1 bottom face, got %d", bottom.Extent());
    auto vol = [](const TopoDS_Shape& s) { GProp_GProps g; BRepGProp::VolumeProperties(s, g); return g.Mass(); };
    TopoDS_Shape alt = shell_with_hole_tubes(body, bottom, -2.0, 1e-3);
    CHECK(!alt.IsNull(), "hole-tube shell fallback returned null");
    if (!alt.IsNull()) {
      CHECK(BRepCheck_Analyzer(alt).IsValid(), "hole-tube shell fallback result is invalid");
      CHECK(std::fabs(vol(alt) - 9426.0) < 1.0, "hole-tube shell volume: want ~9426, got %.4f", vol(alt));
    }
  }

  // 9. REQ 1021 — creased fillet corners. A 40x30x17 box with r3 vertical
  //    corners, top edges rounded r5: OCCT's corner patches meet their
  //    neighbours ~2.8° off tangent, so a 2mm ByJoin shell opens 0.10mm gaps
  //    at them. After the refit the worst shell edge tolerance must be tight.
  {
    TopoDS_Shape box = BRepPrimAPI_MakeBox(40, 30, 17).Shape();
    BRepFilletAPI_MakeFillet corners(box);
    for (TopExp_Explorer e(box, TopAbs_EDGE); e.More(); e.Next()) {
      BRepAdaptor_Curve c(TopoDS::Edge(e.Current()));
      if (c.GetType() == GeomAbs_Line && std::fabs(c.Line().Direction().Z()) > 0.99) {
        corners.Add(3.0, TopoDS::Edge(e.Current()));
      }
    }
    const TopoDS_Shape rounded = corners.Shape();
    auto plane_at = [](const TopoDS_Shape& s, double z) {
      for (TopExp_Explorer e(s, TopAbs_FACE); e.More(); e.Next()) {
        BRepAdaptor_Surface a(TopoDS::Face(e.Current()));
        if (a.GetType() == GeomAbs_Plane && std::fabs(a.Plane().Location().Z() - z) < 1e-9 &&
            std::fabs(a.Plane().Axis().Direction().Z()) > 0.99) return TopoDS::Face(e.Current());
      }
      return TopoDS_Face();
    };
    BRepFilletAPI_MakeFillet top_round(rounded);
    for (TopExp_Explorer e(BRepTools::OuterWire(plane_at(rounded, 17)), TopAbs_EDGE); e.More(); e.Next()) {
      top_round.Add(5.0, TopoDS::Edge(e.Current()));
    }
    const TopoDS_Shape filleted = top_round.Shape();
    auto shell_tol = [&](const TopoDS_Shape& s) {
      TopTools_ListOfShape open;
      open.Append(plane_at(s, 0));
      BRepOffsetAPI_MakeThickSolid mts;
      mts.MakeThickSolidByJoin(s, open, -2.0, 1e-3);
      double worst = 0;
      for (TopExp_Explorer e(mts.Shape(), TopAbs_EDGE); e.More(); e.Next()) {
        worst = std::max(worst, BRep_Tool::Tolerance(TopoDS::Edge(e.Current())));
      }
      return worst;
    };
    const TopoDS_Shape refit = refit_creased_blend_corners(filleted);
    CHECK(!refit.IsSame(filleted), "fillet corner refit left the creased corners alone");
    CHECK(BRepCheck_Analyzer(refit).IsValid(), "fillet corner refit result is invalid");
    const double before = shell_tol(filleted), after = shell_tol(refit);
    CHECK(before > 0.05, "creased-corner shell: expected OCCT's ~0.1mm gaps, got %.4g", before);
    CHECK(after < 0.02, "refit-corner shell: worst edge tolerance %.4g mm (want < 0.02)", after);
  }

  // 10. Topological naming (REQs 1035–1039). A 20x10x5 box whose walls carry
  //     sketch segment ids, cut by a pocket A (x=+5) and then a pocket C at a
  //     SMALLER x (-7) — the positional scheme renumbered every face after C.
  {
    json box = kernel::op_buildExtrude(json{
        {"featureId", "nb"},
        {"profile", json::array({line_sid(-10, -5, 10, -5, "S"), line_sid(10, -5, 10, 5, "R"),
                                 line_sid(10, 5, -10, 5, "N"), line_sid(-10, 5, -10, -5, "W")})},
        {"plane", plane_xy()},
        {"distance", 5.0},
    });
    const json a = cut_into("ta", box, pocket("pa", 5, 0, 1, 1, 3, 3));
    const json ac = cut_into("tc", a, pocket("pc", -7, 0, 1, 1, 3, 3));

    std::vector<std::string> names;
    kernel::brep_from_base64(ac.at("brepBytes").get<std::string>(), &names);
    size_t brep_faces = 0;
    for (TopExp_Explorer ex(kernel::brep_from_base64(ac.at("brepBytes").get<std::string>()), TopAbs_FACE); ex.More(); ex.Next()) ++brep_faces;
    CHECK(names.size() == brep_faces && brep_faces > 0, "naming trailer: %zu names for %zu faces", names.size(), brep_faces);

    const auto top_box = plane_face_ids(box, 0, 0, 1, 5), top_a = plane_face_ids(a, 0, 0, 1, 5),
               top_ac = plane_face_ids(ac, 0, 0, 1, 5);
    CHECK(top_box.size() == 1 && top_a.size() == 1 && top_ac.size() == 1, "naming: one top face per stage");
    if (top_box.size() == 1 && top_a.size() == 1 && top_ac.size() == 1) {
      CHECK(top_box[0] == top_a[0] && top_a[0] == top_ac[0], "naming: top face renamed by a cut: %s -> %s -> %s",
            top_box[0].c_str(), top_a[0].c_str(), top_ac[0].c_str());
      CHECK(top_box[0].find("cap-top") != std::string::npos, "naming: top face is the extrude cap-top (%s)", top_box[0].c_str());
    }
    const auto right = plane_face_ids(ac, 1, 0, 0, 10);
    CHECK(right.size() == 1 && right[0].find("\"upstream_refs\":[\"R\"]") != std::string::npos,
          "naming: right wall named after sketch segment R (%s)", right.empty() ? "-" : right[0].c_str());

    const std::string e_a = edge_id_at(a, 10, -5, 5, 5), e_ac = edge_id_at(ac, 10, -5, 5, 5);
    CHECK(!e_a.empty() && e_a == e_ac && e_a.rfind("e:", 0) == 0, "naming: edge id moved by an unrelated cut: %s -> %s",
          e_a.c_str(), e_ac.c_str());

    CHECK(!ids_with(a, "\"body\":\"B\"").empty(), "naming: compose tool walls carry the body qualifier");

    bool legacy_ok = true;
    for (const auto& f : a.at("faces")) {
      legacy_ok = legacy_ok && f.value("legacyId", std::string()).rfind("{\"feature_id\":\"ta\",\"role\":\"side\"", 0) == 0;
    }
    CHECK(legacy_ok, "naming: every face carries its positional legacyId");

    // Split: a slot through the whole width splits the top in two.
    const json slot = cut_into("ts", box, pocket("ps", 0, 0, 1, 7, 3, 3));
    const auto top_s = plane_face_ids(slot, 0, 0, 1, 5);
    CHECK(top_s.size() == 2, "naming split: want 2 top pieces, got %zu", top_s.size());
    if (top_s.size() == 2) {
      const bool plain0 = top_s[0] == top_box[0], plain1 = top_s[1] == top_box[0];
      const std::string& other = plain0 ? top_s[1] : top_s[0];
      CHECK(plain0 != plain1 && other.find("\"split\":\"1\"") != std::string::npos,
            "naming split: pieces %s / %s", top_s[0].c_str(), top_s[1].c_str());
    }

    // Merge: a coplanar neighbor box fused on keeps one top answering to both.
    json box2 = kernel::op_buildExtrude(json{
        {"featureId", "nb2"}, {"profile", square(15, 0, 5)}, {"plane", plane_xy()}, {"distance", 5.0}});
    const json fused = kernel::op_buildBoolean(json{{"featureId", "tf"}, {"op", "fuse"},
                                                    {"aBrep", box.at("brepBytes")}, {"bBrep", box2.at("brepBytes")}});
    const auto top_f = plane_face_ids(fused, 0, 0, 1, 5);
    const auto top_b2 = plane_face_ids(box2, 0, 0, 1, 5);
    CHECK(top_f.size() == 1 && !top_box.empty() && top_f[0] == top_box[0], "naming merge: merged top keeps box's name");
    if (top_f.size() == 1 && top_b2.size() == 1) {
      const json* mf = face_by_id(fused, top_f[0]);
      bool aliased = false;
      if (mf && mf->contains("aliases")) {
        for (const auto& al : (*mf)["aliases"]) aliased = aliased || al.get<std::string>() == top_b2[0];
      }
      CHECK(aliased, "naming merge: merged top lists the fused box's top as an alias");
    }

    // Fillet: the blend face's name doesn't move when an unrelated cut lands elsewhere.
    auto fillet = [](const json& body) {
      return kernel::op_buildEdgeBlend(json{{"featureId", "tr"}, {"kind", "fillet"}, {"value", 1.0},
                                            {"aBrep", body.at("brepBytes")},
                                            {"edges", json::array({json{{"start", {10, -5, 5}}, {"end", {10, 5, 5}}}})}});
    };
    const auto blend_a = ids_with(fillet(a), "\"role\":\"new\""), blend_ac = ids_with(fillet(ac), "\"role\":\"new\"");
    CHECK(blend_a.size() == 1 && blend_a == blend_ac, "naming: fillet face renamed by an unrelated cut (%zu vs %zu)",
          blend_a.size(), blend_ac.size());

    // Shell: inner walls are named after the face they were offset from.
    const json shelled = kernel::op_buildShell(json{{"featureId", "th"}, {"aBrep", box.at("brepBytes")},
                                                    {"faces", json::array({json{{"centroid", {0, 0, 5}}, {"normal", {0, 0, 1}}}})},
                                                    {"thickness", -1.0}});
    CHECK(ids_with(shelled, "\"role\":\"offset\"").size() == 5, "naming shell: want 5 offset walls, got %zu",
          ids_with(shelled, "\"role\":\"offset\"").size());
  }

  // 7. REQ 963 — limit defaults and env overrides.
  CHECK(kernel::max_request_bytes() == 512ull * 1024 * 1024, "default request cap should be 512 MiB");
  setenv("CAD_KERNEL_MAX_REQUEST_BYTES", "1024", 1);
  CHECK(kernel::max_request_bytes() == 1024, "request cap env override");
  unsetenv("CAD_KERNEL_MAX_REQUEST_BYTES");
  setenv("CAD_KERNEL_CHILD_MEM_MB", "0", 1);
  CHECK(kernel::child_address_space_bytes() == 0, "CHILD_MEM_MB=0 disables the child limit");
  unsetenv("CAD_KERNEL_CHILD_MEM_MB");
  CHECK(kernel::child_address_space_bytes() == 8192ull * 1024 * 1024, "default child limit should be 8 GiB");

  if (g_failures > 0) {
    std::fprintf(stderr, "kernel smoke tests: %d FAILURE(S)\n", g_failures);
    return 1;
  }
  std::printf("kernel smoke tests OK (extrude, boolean, pinched sweep, pinched shell, hole-tube shell, fillet corner refit, naming, limits)\n");
  return 0;
}
