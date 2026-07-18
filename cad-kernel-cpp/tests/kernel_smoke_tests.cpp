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

  if (g_failures > 0) {
    std::fprintf(stderr, "kernel smoke tests: %d FAILURE(S)\n", g_failures);
    return 1;
  }
  std::printf("kernel smoke tests OK (extrude, boolean, pinched sweep, pinched shell)\n");
  return 0;
}
