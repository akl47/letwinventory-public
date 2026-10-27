# syntax=docker/dockerfile:1.7
# C++ CAD kernel on OCCT 8.0 (native — no Rust, no opencascade-rs/FFI).

# ---- builder ----
# OCCT 8.0 + toolchain come prebuilt from the base image (occt.Dockerfile,
# published by .github/workflows/publish-occt.yml) — compiling OCCT here took
# hours whenever the build cache missed.
ARG OCCT_IMAGE=ghcr.io/akl47/letwinventory-occt:8.0.0
FROM ${OCCT_IMAGE} AS builder

# C++ kernel deps + build.
RUN apt-get update && apt-get install -y --no-install-recommends \
      nlohmann-json3-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY CMakeLists.txt ./
COPY src ./src
COPY tests ./tests
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build build -j"$(nproc)" \
 && ./build/kernel-tests \
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
