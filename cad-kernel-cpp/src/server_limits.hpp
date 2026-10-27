// Server resource limits (REQ 963 / REQ 964). Kept out of main.cpp so the
// smoke tests can exercise them.
#pragma once

#include <cstddef>
#include <string>

namespace kernel {

// Largest accepted JSON-RPC request line, in bytes
// (CAD_KERNEL_MAX_REQUEST_BYTES, default 512 MiB). A client that sends more
// without a newline gets an error and is disconnected, instead of growing the
// connection buffer until the container runs out of memory.
std::size_t max_request_bytes();

// Address-space limit applied to each forked operation child, in bytes
// (CAD_KERNEL_CHILD_MEM_MB, default 8192; 0 disables). An op that would
// exceed it fails with bad_alloc → a clean JSON-RPC error, not an OOM kill
// of the whole kernel container.
std::size_t child_address_space_bytes();

// Apply child_address_space_bytes() to the calling process (the fork child).
void apply_child_memory_limit();

// Delete stale `cad-export-*` temp files in `dir` (REQ 964) — exports killed
// at the op timeout never reach their unlink. Returns the number removed.
int sweep_stale_exports(const std::string& dir);

// The directory export temp files live in ($TMPDIR or /tmp).
std::string export_temp_dir();

}  // namespace kernel
