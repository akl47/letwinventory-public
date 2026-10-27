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

# Build toolchain. OCCT 8.0 is NOT in Debian apt (Bookworm ships 7.6.3), so we
# build it from source below. clang/cmake/git required; OCCT 8.0 needs C++17.
RUN apt-get update && apt-get install -y --no-install-recommends \
      cmake clang pkg-config git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---- OCCT 8.0.0 from source ----
# Built in its own layer (before our source is COPYed) so it stays cached
# across kernel-code iterations. We only need the modeling + data-exchange +
# application-framework modules the cxx bridge links (see OCCT_LIBS in
# opencascade-sys/build.rs); Visualization/Draw/VTK/FreeType/Tk are disabled to
# cut build time and runtime deps. OCCT 8.0 brings the boolean-fuse infinite-loop
# fix and UnifySameDomain face-unification improvements we need.
ARG OCCT_TAG=V8_0_0
RUN git clone --depth 1 --branch ${OCCT_TAG} \
      https://github.com/Open-Cascade-SAS/OCCT.git /tmp/occt-src \
 && cmake -S /tmp/occt-src -B /tmp/occt-build \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/usr/local \
      -DBUILD_LIBRARY_TYPE=Shared \
      -DUSE_VTK=OFF -DUSE_FREETYPE=OFF -DUSE_TK=OFF \
      -DUSE_OPENGL=OFF -DUSE_GLES2=OFF -DUSE_FREEIMAGE=OFF \
      -DUSE_TBB=OFF -DUSE_RAPIDJSON=OFF -DUSE_DRACO=OFF \
      -DBUILD_MODULE_Draw=OFF -DBUILD_MODULE_Visualization=OFF \
      -DBUILD_DOC_Overview=OFF \
 && cmake --build /tmp/occt-build --target install -j"$(nproc)" \
 && rm -rf /tmp/occt-src /tmp/occt-build \
 && ldconfig

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

# OCCT 8.0 runtime shared libs are copied from the builder (we built them from
# source there — they're not in apt). libstdc++6 provides the C++ runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

# OCCT 8.0 shared objects + the kernel binary.
COPY --from=builder /usr/local/lib/ /usr/local/lib/
RUN ldconfig
COPY --from=builder /build/cad-kernel /usr/local/bin/cad-kernel

# Listen on all interfaces inside the container so other compose services
# (the Node backend) can reach the kernel over the compose network.
ENV CAD_KERNEL_ADDR=0.0.0.0:9876
ENV RUST_LOG=info
EXPOSE 9876

ENTRYPOINT ["/usr/local/bin/cad-kernel"]
