# Multi-stage build for the Rust + OCCT CAD kernel sidecar.
#
# Stage 1 ("builder") installs the full OCCT dev toolchain + cxx bridge
# dependencies and compiles a release binary. Stage 2 copies just the
# binary into a slim runtime image with OCCT shared libs only.
#
# First build is slow because opencascade-rs has to compile cxx bridge
# code against OCCT — expect 10-15 minutes cold. Subsequent builds
# benefit from cargo's incremental cache, but Docker layer caching
# requires Cargo.toml/Cargo.lock to be unchanged.

# ---- builder ----
# Rust 1.85+ required: opencascade-rs pulls a transitive hashbrown >= 0.17
# which uses edition 2024, stabilized in 1.85.
FROM rust:1.85-bookworm AS builder

# OCCT 7.7.x dev headers + the cxx toolchain (cmake/clang/pkg-config)
# required by opencascade-rs to compile the C++ bridge.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libocct-foundation-dev \
      libocct-modeling-data-dev \
      libocct-modeling-algorithms-dev \
      libocct-ocaf-dev \
      libocct-data-exchange-dev \
      cmake clang pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY tests ./tests

RUN cargo build --release

# ---- runtime ----
FROM debian:bookworm-slim

# OCCT runtime shared libs only. Using the -dev packages here keeps the
# apt invocation simple (they pull in the runtime .so files plus headers
# we don't need). Swap to the version-suffixed runtime-only packages
# later if image size becomes a concern — the -dev variants add ~50MB
# of headers.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libocct-foundation-dev \
      libocct-modeling-data-dev \
      libocct-modeling-algorithms-dev \
      libocct-ocaf-dev \
      libocct-data-exchange-dev \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/target/release/cad-kernel /usr/local/bin/cad-kernel

# Listen on all interfaces inside the container so other compose services
# (the Node backend) can reach the kernel over the compose network.
ENV CAD_KERNEL_ADDR=0.0.0.0:9876
ENV RUST_LOG=info
EXPOSE 9876

ENTRYPOINT ["/usr/local/bin/cad-kernel"]
