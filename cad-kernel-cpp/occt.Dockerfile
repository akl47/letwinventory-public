# OCCT 8.0 base image for the C++ CAD kernel.
#
# OCCT takes hours to compile, so it lives in its own image, published to GHCR
# by .github/workflows/publish-occt.yml and pinned by tag in ./Dockerfile.
# Kernel builds (CI PRs, publish-kernel, local compose) then only compile the
# kernel sources — no dependence on a build-cache hit.
#
# Rebuilt only when this file changes. To bump OCCT: change OCCT_TAG, bump the
# image tag in publish-occt.yml AND ./Dockerfile's OCCT_IMAGE together.

# buildpack-deps is the toolchain the old rust:*-bookworm base was built on
# (gcc/g++, make, X11 headers) — same compiler OCCT was previously built with.
FROM buildpack-deps:bookworm

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
