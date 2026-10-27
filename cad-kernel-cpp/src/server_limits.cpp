#include "server_limits.hpp"

#include <cstdlib>
#include <cstring>
#include <dirent.h>
#include <sys/resource.h>
#include <unistd.h>

namespace kernel {

static long env_long(const char* name, long fallback) {
  if (const char* v = std::getenv(name)) {
    char* end = nullptr;
    long n = std::strtol(v, &end, 10);
    if (end != v && n >= 0) return n;
  }
  return fallback;
}

std::size_t max_request_bytes() {
  long n = env_long("CAD_KERNEL_MAX_REQUEST_BYTES", 512L * 1024 * 1024);
  return n > 0 ? static_cast<std::size_t>(n) : static_cast<std::size_t>(512L * 1024 * 1024);
}

std::size_t child_address_space_bytes() {
  long mb = env_long("CAD_KERNEL_CHILD_MEM_MB", 8192);
  return static_cast<std::size_t>(mb) * 1024 * 1024;
}

void apply_child_memory_limit() {
  std::size_t bytes = child_address_space_bytes();
  if (bytes == 0) return;
  rlimit rl{};
  rl.rlim_cur = static_cast<rlim_t>(bytes);
  rl.rlim_max = static_cast<rlim_t>(bytes);
  setrlimit(RLIMIT_AS, &rl);  // best-effort: failure leaves the op unbounded
}

std::string export_temp_dir() {
  const char* dir = std::getenv("TMPDIR");
  return (dir && *dir) ? std::string(dir) : std::string("/tmp");
}

int sweep_stale_exports(const std::string& dir) {
  DIR* d = opendir(dir.c_str());
  if (!d) return 0;
  int removed = 0;
  static const char kPrefix[] = "cad-export-";
  while (dirent* e = readdir(d)) {
    if (std::strncmp(e->d_name, kPrefix, sizeof(kPrefix) - 1) != 0) continue;
    std::string path = dir + "/" + e->d_name;
    if (unlink(path.c_str()) == 0) removed++;
  }
  closedir(d);
  return removed;
}

}  // namespace kernel
