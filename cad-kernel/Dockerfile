# syntax=docker/dockerfile:1.7
# Multi-stage build for the Rust + OCCT CAD kernel sidecar.
#
# Stage 1 ("builder") installs the full OCCT dev toolchain + cxx bridge
# dependencies and compiles a release binary. Stage 2 copies just the
# binary into a slim runtime image with OCCT shared libs only.
#
# First build is slow because opencascade-rs has to compile cxx bridge
# code against OCCT — expect 25-40 minutes cold. Subsequent builds reuse
# the BuildKit cache mounts below (registry/git/target) and finish in
# seconds-to-minutes for small source changes. The syntax directive at
# the top opts into BuildKit so the `--mount=type=cache` syntax works.

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
# Vendored opencascade + opencascade-sys — patched to expose OCCT's
# closed-revolution constructor (no-angle BRepPrimAPI_MakeRevol overload).
# Upstream opencascade-rs always passes an angle (2π for "full"), which
# OCCT treats as a partial revolve and leaves the profile edges as
# visible seams. See vendor/opencascade-rs/crates/opencascade-sys/src/b_rep_prim_api.rs.
COPY vendor ./vendor

# BuildKit cache mounts: persist Cargo's downloaded crates + git deps +
# the `target/` incremental compilation directory across builds. After
# `cargo build` finishes we copy the binary OUT of the cache (cache mounts
# don't get baked into the resulting image layer) into /build/cad-kernel,
# which IS in the builder layer for the runtime stage to COPY --from.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/target,id=cad-kernel-target \
    cargo build --release && \
    cp /build/target/release/cad-kernel /build/cad-kernel

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

COPY --from=builder /build/cad-kernel /usr/local/bin/cad-kernel

# Listen on all interfaces inside the container so other compose services
# (the Node backend) can reach the kernel over the compose network.
ENV CAD_KERNEL_ADDR=0.0.0.0:9876
ENV RUST_LOG=info
EXPOSE 9876

ENTRYPOINT ["/usr/local/bin/cad-kernel"]
