// cad-kernel (C++) — native OCCT 8.0 CAD kernel service.
//
// Speaks the SAME line-delimited JSON-RPC 2.0 protocol over TCP as the previous
// Rust kernel, so the Node backend + Angular frontend are unchanged. This is the
// scaffold milestone: TCP server + thread-per-connection + watchdog + `ping`.
// Geometry ops (buildExtrude/buildBoolean/…) land incrementally against the
// parity checklist in docs/cad-system/cpp-kernel-plan.md.

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>

#include <arpa/inet.h>
#include <cerrno>
#include <csignal>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/wait.h>
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
// cpp-15: connection cap (CAD_KERNEL_MAX_CONNECTIONS, default 32) — pairs with
//     the backend's connection POOL (REQ 903) that unlocked cross-model
//     concurrency; the cap bounds thread/fd exhaustion from a runaway client.
//     No geometry change — NAMING stays 48.
static constexpr const char* KERNEL_BUILD = "cpp-15";
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
// cpp-12: whole-shape parallel meshing (ensure_meshed) replaces per-face
//     meshers — faster, and watertight (shared edges discretized once). This is
//     tessellation-only (face names + ordering unchanged), so NAMING stays 45 —
//     old per-face mesh-cache rows stay valid; new regens mesh whole-shape.
// 46: sweep transition mode Transformed → RightCorner. At a G0 path corner the
//     default translated the section without rotating it, so the post-corner leg
//     degenerated into a zero-thickness sheet (model 45 L-path sweep). RightCorner
//     mitres the junction like SolidWorks. Different topology on cornered paths —
//     bump invalidates the degenerate sweep cache rows.
// 47: sweeps whose profile exactly reaches a path bend's center of curvature
//     (horn-torus elbow, major == minor — model 45 filleted path) are HEALED
//     (heal_pinched_bends): BRepMesh strip-meshes the exact horn (elbow renders
//     as a flat chamfer, not an arc) but handles the spindle side perfectly, so
//     the surface is swapped for a twin with major = minor*(1-1e-12) (sub-
//     picometre, far below tolerance) with pcurves re-registered. Onshape
//     builds this geometry; parity means rendering it, not refusing it. Bump
//     invalidates v46 rows holding the degenerate strip tessellation.
// cpp-13: fork isolation — every geometry op runs in a forked child, so OCCT
//     hard crashes (SIGSEGV on offsetting a pinched body) and hangs fail ONLY
//     that op with a clean JSON-RPC error; the server no longer dies/restarts.
//     Behavior-only (successful outputs unchanged) — NAMING stays 47.
// 48: pinched-elbow sweeps made fully workable (Onshape parity, model 45):
//     (a) sweep retries with the profile circle's parameter origin rotated when
//     the tube seam lands on the pinch — the degenerate null-curve seam was what
//     strip-meshed the elbow AND segfaulted BRepOffset; with the seam elsewhere
//     the exact-horn elbow meshes and offsets cleanly (the 1e-12 spindle heal
//     is now only a fallback). (b) buildShell gives near-exact pinched tori
//     0.1 µm of clearance (pcurve-preserving swap) so ByJoin can hollow them —
//     both OCCT engines refuse the exact horn outright. Bump invalidates v47
//     rows (seam relocation changes sweep tessellation/topology).
static constexpr int NAMING_SCHEMA_VERSION = 48;

// ── Operation watchdog ─────────────────────────────────────────────────────────
// Since cpp-13, geometry ops run in a forked child (see run_op_isolated), so
// hangs are handled by the parent killing the child — the server never dies.
// This process-level watchdog remains as a last-resort backstop for a wedge in
// the parent's own dispatch path (should never fire); ops arm it with a margin
// ABOVE the per-op timeout so the child-kill path always wins the race.
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
  explicit OpGuard(uint64_t extra_ms = 0) : deadline(now_ms() + op_timeout_ms() + extra_ms) {
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
  if (method == "buildFuseMany")       return kernel::op_buildFuseMany(params);
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

// ── Fork isolation (cpp-13) ─────────────────────────────────────────────────────
// OCCT can hard-crash (SIGSEGV/abort) on pathological geometry — e.g. offsetting
// a self-touching body — and a signal cannot be converted into a catchable C++
// exception on Linux without rebuilding OCCT with -fnon-call-exceptions. So each
// geometry op runs in a forked child: a crash kills only that child, the parent
// turns the wait status into a normal JSON-RPC error, and the server (and every
// other in-flight op) keeps running. Hangs are handled the same way — the parent
// SIGKILLs the child at the op timeout instead of force-exiting the process.
// The kernel is stateless per op (requests carry their BReps), so the child
// needs nothing from the parent but the COW snapshot of the request. glibc
// (debian base) keeps malloc usable in the child of a multithreaded fork.
static json run_op_isolated(const std::string& method, const json& params) {
  int pfd[2];
  if (pipe(pfd) != 0) {
    // Isolation unavailable — degrade to the old inline behavior.
    return handle_method(method, params);
  }
  pid_t pid = fork();
  if (pid < 0) {
    close(pfd[0]);
    close(pfd[1]);
    return handle_method(method, params);
  }
  if (pid == 0) {
    // Child: run the op, write the outcome JSON, exit. _Exit (not exit) so no
    // parent atexit handlers or shared stdio flushing runs twice. EOF on the
    // pipe (via _Exit closing it) is the message terminator — no framing.
    close(pfd[0]);
    std::string out;
    try {
      json result = handle_method(method, params);
      out = json{{"ok", true}, {"result", std::move(result)}}.dump();
    } catch (const std::exception& e) {
      out = json{{"ok", false}, {"message", std::string(e.what())}}.dump();
    } catch (...) {
      out = json{{"ok", false}, {"message", "unknown kernel exception"}}.dump();
    }
    const char* c = out.data();
    size_t n = out.size();
    while (n > 0) {
      ssize_t w = write(pfd[1], c, n);
      if (w <= 0) _Exit(3);
      c += w;
      n -= static_cast<size_t>(w);
    }
    close(pfd[1]);
    _Exit(0);
  }
  // Parent: read the child's outcome until EOF, enforcing the op timeout.
  close(pfd[1]);
  const uint64_t deadline = now_ms() + op_timeout_ms();
  std::string payload;
  bool timed_out = false;
  for (;;) {
    uint64_t now = now_ms();
    if (now >= deadline) { timed_out = true; break; }
    pollfd pf{pfd[0], POLLIN, 0};
    int pr = poll(&pf, 1, static_cast<int>(std::min<uint64_t>(deadline - now, 1000)));
    if (pr < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (pr == 0) continue;
    char buf[65536];
    ssize_t n = read(pfd[0], buf, sizeof(buf));
    if (n < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (n == 0) break;  // EOF — child finished (or died)
    payload.append(buf, static_cast<size_t>(n));
  }
  if (timed_out) kill(pid, SIGKILL);
  int status = 0;
  waitpid(pid, &status, 0);
  close(pfd[0]);

  if (timed_out) {
    std::fprintf(stderr, "[isolate] %s exceeded %llu ms — worker killed, kernel still up\n",
                 method.c_str(), static_cast<unsigned long long>(op_timeout_ms()));
    std::fflush(stderr);
    throw std::runtime_error(
        method + " timed out after " + std::to_string(op_timeout_ms()) +
        " ms and was cancelled. The kernel is still running; other operations are unaffected.");
  }
  if (!payload.empty()) {
    json out = json::parse(payload, nullptr, /*allow_exceptions=*/false);
    if (!out.is_discarded() && out.is_object()) {
      if (out.value("ok", false)) return out["result"];
      throw std::runtime_error(out.value("message", std::string("kernel operation failed")));
    }
  }
  // No (or garbled) payload: the child died before reporting — a hard crash.
  if (WIFSIGNALED(status)) {
    int sig = WTERMSIG(status);
    const char* name = strsignal(sig);
    std::fprintf(stderr, "[isolate] %s crashed with signal %d (%s) — kernel still up\n",
                 method.c_str(), sig, name ? name : "?");
    std::fflush(stderr);
    throw std::runtime_error(
        method + " crashed inside the geometry kernel (" + (name ? name : "signal") +
        "). The crash was isolated to this operation — the kernel is still running. "
        "This usually means the input geometry hits an OCCT defect (for example "
        "offsetting or filleting a self-touching/pinched body).");
  }
  throw std::runtime_error(
      method + ": kernel worker exited without a result (exit status " +
      std::to_string(WIFEXITED(status) ? WEXITSTATUS(status) : -1) + ").");
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
    json result;
    if (method == "ping") {
      result = handle_method(method, params);  // trivial + latency-sensitive: no fork
    } else {
      // Backstop watchdog armed 15s past the op timeout — the fork-wait's own
      // child-kill is the primary enforcement and must win the race.
      OpGuard guard(15000);
      result = run_op_isolated(method, params);
    }
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
// Connection cap (REQ 903): each accepted connection detaches a thread, so an
// unbounded client (or anything else that can reach the port — the kernel has
// no auth and relies on Docker-network isolation) could exhaust threads/fds.
// The backend pool holds CAD_KERNEL_POOL_SIZE (+1 heartbeat) connections; 32
// leaves generous headroom. Over-cap connections are closed immediately.
static std::atomic<int> g_open_connections{0};
static int max_connections() {
  if (const char* v = std::getenv("CAD_KERNEL_MAX_CONNECTIONS")) {
    char* end = nullptr;
    long n = std::strtol(v, &end, 10);
    if (end != v && n > 0) return static_cast<int>(n);
  }
  return 32;
}

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
  // A worker child killed mid-write (timeout) must not take the parent down
  // via SIGPIPE; socket sends already use MSG_NOSIGNAL.
  signal(SIGPIPE, SIG_IGN);
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

  const int conn_cap = max_connections();
  for (;;) {
    int fd = accept(srv, nullptr, nullptr);
    if (fd < 0) continue;
    if (g_open_connections.load(std::memory_order_relaxed) >= conn_cap) {
      std::fprintf(stderr, "[server] connection cap (%d) reached — rejecting new connection\n", conn_cap);
      std::fflush(stderr);
      close(fd);
      continue;
    }
    g_open_connections.fetch_add(1, std::memory_order_relaxed);
    std::thread([fd] {
      handle_connection(fd);
      g_open_connections.fetch_sub(1, std::memory_order_relaxed);
    }).detach();
  }
}
