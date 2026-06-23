// cad-kernel (C++) — native OCCT 8.0 CAD kernel service.
//
// Speaks the SAME line-delimited JSON-RPC 2.0 protocol over TCP as the previous
// Rust kernel, so the Node backend + Angular frontend are unchanged. This is the
// scaffold milestone: TCP server + thread-per-connection + watchdog + `ping`.
// Geometry ops (buildExtrude/buildBoolean/…) land incrementally against the
// parity checklist in docs/cad-system/cpp-kernel-plan.md.

#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <unistd.h>

#include <nlohmann/json.hpp>
#include <Standard_Version.hxx>

#include "op_extrude.hpp"
#include "op_boolean.hpp"
#include "op_revolve_sweep.hpp"
#include "op_shell_blend.hpp"
#include "op_pattern.hpp"

using json = nlohmann::json;

// ── Build markers (mirror the Rust kernel fields the backend/editor read) ──────
static constexpr const char* KERNEL_BUILD = "cpp-10";
// 30: native C++/OCCT 8.0 kernel; binary BinTools BReps invalidate the old
// text-BRep cache (must match NAMING_VERSION in backend cadRegenService.js).
// 31: tessellation normal off-by-one fix (zero-normal last node → dark
// triangles + isFlat=false on planar faces); invalidates cpp-1 cache rows.
// 32: tessellation normals now orientation-aware (negated on REVERSED faces)
// so they face outward — sketches on a reversed face no longer face inward.
// 33: topology edges deduped by identity (TopExp_Explorer double-counts shared
// edges → orphan duplicate edges, spurious in edge-select); each edge once now.
// 34: (superseded) tried boolean SetFuzzyValue + SimplifyResult to merge
// coaxial cylinder fragments — didn't work, reverted.
// 35: (superseded) canonicalize-cylinder-surfaces-then-unify — unified the axis
// directions but the face rebuild copied boundary edges, breaking the sharing
// UnifySameDomain needs (patches went non-adjacent → unmerged, net worse).
// Reverted.
// 36: back to plain UnifySameDomain (topologically correct baseline).
// 37: detect_tangent_edges drops the shared edge between two CO-CYLINDRICAL faces
// (same axis line + radius, any axis direction) as a co-domain seam.
// 38: clean_unify MERGES coaxial cylinder faces (edge-preserving rebase + unify).
// 39: VOLUME-PRESERVATION GUARD on that rebase — on some bodies (part 586) the
// rebase flipped a face's orientation and inverted the solid (negative volume →
// faces on the wrong side / missing). Now the canonicalized shape is kept only
// when it preserves the signed volume; otherwise the un-canonicalized shape is
// used (seam edge still dropped from view, so cylinder still reads continuous).
// 40: boolean ops (fuse/cut/common) now run with a bbox-scaled FUZZY tolerance,
// so a tool wall rebuilt from a solved sketch that lands ~3e-5 mm off the body's
// coincident wall merges into one face instead of leaving a duplicate coincident
// face (part 586 cut: side#0 full-height wall + side#1 cut-band wall overlapping).
// 41: edge fillet at/over the FULL-ROUND limit (radius consumes the wall, OCCT's
// rolling-ball builder degenerates) auto-steps the radius down minutely until it
// builds — the largest real round OCCT can make (sub-micron flat) instead of
// failing. SolidWorks/OnShape full-round parity within kernel limits.
// 42: same_cylinder (tangent-edge classifier) loosened to treat the two
// near-coaxial same-radius fillet halves of a full round as one cylinder, so the
// seam line between them is dropped from the view (display-only — no geometry
// change). Genuinely distinct cylinders differ by far more than the tolerances.
// 43: drop edges of sub-micron SLIVER faces (the flat remnant a full round leaves
// between its two halves) so the seam line around it does not render. Display-only.
// 44/45: split-cylinder fix, two parts.
//  (a) clean_unify no longer hands back an INVALID solid. When a bore is extended
//      by a coaxial same-Ø cut, UnifySameDomain meets two opposite-axis cylinder
//      walls it cannot merge and, in bailing, flags one face UnorientableShape —
//      corrupting the whole (previously valid) solid and breaking downstream
//      fillets/booleans. clean_unify now keeps the un-unified (valid) shape.
//  (b) tessellate_generic presents coaxial + same-radius + adjacent cylinder
//      faces (which OCCT can't geometrically merge across the opposite-axis split)
//      as ONE face in its output, so the wall reads/selects as a single face. The
//      BRep keeps both faces; only the tessellation the UI sees is unified.
static constexpr int NAMING_SCHEMA_VERSION = 45;

// ── Operation watchdog ─────────────────────────────────────────────────────────
// An uncancellable OCCT hang (infinite-loop boolean/mesh) can't be interrupted
// from here, so a thread force-exits the process if a handler runs past the
// timeout. The supervisor (Docker restart: unless-stopped) brings up a clean
// kernel and the in-flight RPC fails with a disconnect rather than wedging.
static std::atomic<uint64_t> g_op_deadline_ms{0};

static uint64_t now_ms() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}
static uint64_t op_timeout_ms() {
  if (const char* v = std::getenv("CAD_KERNEL_OP_TIMEOUT_MS")) {
    char* end = nullptr;
    long ms = std::strtol(v, &end, 10);
    if (end != v && ms > 0) return static_cast<uint64_t>(ms);
  }
  return 60000;
}
static void start_watchdog() {
  std::thread([] {
    for (;;) {
      std::this_thread::sleep_for(std::chrono::milliseconds(1000));
      uint64_t deadline = g_op_deadline_ms.load(std::memory_order_relaxed);
      if (deadline != 0 && now_ms() > deadline) {
        std::fprintf(stderr,
                     "[watchdog] a kernel handler ran past %llu ms with no result "
                     "— aborting process for supervisor restart\n",
                     static_cast<unsigned long long>(op_timeout_ms()));
        std::fflush(stderr);
        std::_Exit(13);
      }
    }
  }).detach();
}
struct OpGuard {
  uint64_t deadline;
  OpGuard() : deadline(now_ms() + op_timeout_ms()) {
    g_op_deadline_ms.store(deadline, std::memory_order_relaxed);
  }
  ~OpGuard() {
    uint64_t expected = deadline;
    g_op_deadline_ms.compare_exchange_strong(expected, 0, std::memory_order_relaxed);
  }
};

// ── JSON-RPC dispatch ──────────────────────────────────────────────────────────
static json make_error(const json& id, int code, const std::string& message) {
  return json{{"jsonrpc", "2.0"}, {"id", id}, {"error", {{"code", code}, {"message", message}}}};
}
static json make_ok(const json& id, json result) {
  return json{{"jsonrpc", "2.0"}, {"id", id}, {"result", std::move(result)}};
}

static json handle_method(const std::string& method, const json& params) {
  if (method == "ping") {
    return json{{"ok", true},
                {"build", KERNEL_BUILD},
                {"namingSchemaVersion", NAMING_SCHEMA_VERSION},
                {"occt", OCC_VERSION_COMPLETE}};
  }
  if (method == "buildExtrude")        return kernel::op_buildExtrude(params);
  if (method == "buildLoft")           return kernel::op_buildLoft(params);
  if (method == "buildBoolean")        return kernel::op_buildBoolean(params);
  if (method == "buildRevolve")        return kernel::op_buildRevolve(params);
  if (method == "buildSweep")          return kernel::op_buildSweep(params);
  if (method == "buildShell")          return kernel::op_buildShell(params);
  if (method == "buildEdgeBlend")      return kernel::op_buildEdgeBlend(params);
  if (method == "buildPattern")        return kernel::op_buildPattern(params);
  if (method == "buildFeaturePattern") return kernel::op_buildFeaturePattern(params);
  if (method == "buildToolPattern")    return kernel::op_buildToolPattern(params);
  if (method == "bodyVolume")          return kernel::op_bodyVolume(params);
  if (method == "exportStl")           return kernel::op_exportStl(params);
  if (method == "exportStep")          return kernel::op_exportStep(params);
  throw std::runtime_error("method not implemented: " + method);
}

// Parse one request line → response string (or empty for notifications).
static std::string dispatch(const std::string& line) {
  json req;
  try {
    req = json::parse(line);
  } catch (const std::exception& e) {
    return make_error(nullptr, -32700, std::string("parse error: ") + e.what()).dump();
  }
  json id = req.contains("id") ? req["id"] : json(nullptr);
  bool is_notification = !req.contains("id") || req["id"].is_null();
  std::string method = req.value("method", "");
  json params = req.contains("params") ? req["params"] : json::object();

  json response;
  try {
    OpGuard guard;  // arm watchdog for the duration of this handler
    json result = handle_method(method, params);
    response = make_ok(id, std::move(result));
  } catch (const std::exception& e) {
    response = make_error(id, -32603, e.what());
  }
  if (is_notification) return std::string();
  return response.dump();
}

// ── TCP server (thread-per-connection) ─────────────────────────────────────────
// One thread per connection so a long/blocking OCCT op on one connection never
// stops `ping` on another — this is what kept the editor's heartbeat alive while
// a build runs (the bug the Rust kernel's single async runtime hit).
static void handle_connection(int fd) {
  int one = 1;
  setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
  std::string buf;
  char chunk[8192];
  for (;;) {
    ssize_t n = recv(fd, chunk, sizeof(chunk), 0);
    if (n <= 0) break;
    buf.append(chunk, static_cast<size_t>(n));
    size_t pos;
    while ((pos = buf.find('\n')) != std::string::npos) {
      std::string line = buf.substr(0, pos);
      buf.erase(0, pos + 1);
      if (line.empty()) continue;
      std::string resp = dispatch(line);
      if (!resp.empty()) {
        resp.push_back('\n');
        size_t off = 0;
        while (off < resp.size()) {
          ssize_t w = send(fd, resp.data() + off, resp.size() - off, MSG_NOSIGNAL);
          if (w <= 0) { close(fd); return; }
          off += static_cast<size_t>(w);
        }
      }
    }
  }
  close(fd);
}

static void parse_addr(const std::string& addr, std::string& host, int& port) {
  host = "0.0.0.0";
  port = 9876;
  auto colon = addr.rfind(':');
  if (colon == std::string::npos) {
    if (!addr.empty()) host = addr;
    return;
  }
  host = addr.substr(0, colon);
  if (host.empty()) host = "0.0.0.0";
  port = std::stoi(addr.substr(colon + 1));
}

int main() {
  std::ios::sync_with_stdio(false);
  start_watchdog();

  std::string addr = "0.0.0.0:9876";
  if (const char* a = std::getenv("CAD_KERNEL_ADDR")) addr = a;
  std::string host;
  int port;
  parse_addr(addr, host, port);

  int srv = socket(AF_INET, SOCK_STREAM, 0);
  if (srv < 0) { std::perror("socket"); return 1; }
  int one = 1;
  setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

  sockaddr_in sa{};
  sa.sin_family = AF_INET;
  sa.sin_port = htons(static_cast<uint16_t>(port));
  sa.sin_addr.s_addr = (host == "0.0.0.0") ? INADDR_ANY : inet_addr(host.c_str());
  if (bind(srv, reinterpret_cast<sockaddr*>(&sa), sizeof(sa)) < 0) { std::perror("bind"); return 1; }
  if (listen(srv, 64) < 0) { std::perror("listen"); return 1; }

  std::fprintf(stderr, "starting cad-kernel (C++) build=%s occt=%s addr=%s\n",
               KERNEL_BUILD, OCC_VERSION_COMPLETE, addr.c_str());
  std::fflush(stderr);

  for (;;) {
    int fd = accept(srv, nullptr, nullptr);
    if (fd < 0) continue;
    std::thread(handle_connection, fd).detach();
  }
}
