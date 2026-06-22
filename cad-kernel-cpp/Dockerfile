# syntax=docker/dockerfile:1.7
# C++ CAD kernel on OCCT 8.0 (native — no Rust, no opencascade-rs/FFI).
#
# The OCCT 8.0 build below is byte-identical to cad-kernel/Dockerfile's so
# BuildKit reuses the already-compiled layer instead of recompiling OCCT.

# ---- builder ----
# Same base + apt + OCCT build as the Rust kernel image, purely so the
# (hours-long) OCCT 8.0 layer is a cache hit. We don't use the Rust toolchain.
FROM rust:1.85-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      cmake clang pkg-config git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

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

# C++ kernel deps + build (this part is new; OCCT layer above stays cached).
RUN apt-get update && apt-get install -y --no-install-recommends \
      nlohmann-json3-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY CMakeLists.txt ./
COPY src ./src
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build build -j"$(nproc)" \
 && cp build/cad-kernel /build/cad-kernel

# ---- runtime ----
FROM debian:bookworm-slim
# OCCT libs were built with X11 present (HAVE_XLIB), so some toolkits link
# libX11 even with Visualization disabled — provide the runtime lib.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libstdc++6 libx11-6 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/lib/ /usr/local/lib/
RUN ldconfig
COPY --from=builder /build/cad-kernel /usr/local/bin/cad-kernel

ENV CAD_KERNEL_ADDR=0.0.0.0:9876
EXPOSE 9876
ENTRYPOINT ["/usr/local/bin/cad-kernel"]
