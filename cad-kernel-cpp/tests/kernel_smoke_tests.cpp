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
  std::printf("kernel smoke tests OK (extrude, boolean, pinched sweep, pinched shell, hole-tube shell, fillet corner refit, limits)\n");
  return 0;
}
