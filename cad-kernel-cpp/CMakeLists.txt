cmake_minimum_required(VERSION 3.16)
project(cad_kernel_cpp CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# OCCT 8.0 (installed to /usr/local by the Docker builder) + nlohmann/json.
find_package(OpenCASCADE REQUIRED)
find_package(nlohmann_json REQUIRED)

add_executable(cad-kernel
  src/main.cpp
  src/geom_io.cpp
  src/op_extrude.cpp
  src/op_boolean.cpp
  src/op_revolve_sweep.cpp
  src/op_shell_blend.cpp
  src/op_pattern.cpp
)

target_include_directories(cad-kernel PRIVATE ${OpenCASCADE_INCLUDE_DIR})
target_link_directories(cad-kernel PRIVATE ${OpenCASCADE_LIBRARY_DIR})

# Core OCCT toolkits we'll need as ops land. Linking them now validates the OCCT
# 8.0 link path early; unused ones are harmless.
target_link_libraries(cad-kernel PRIVATE
  nlohmann_json::nlohmann_json
  pthread
  TKernel TKMath
  TKG2d TKG3d TKGeomBase TKBRep
  TKTopAlgo TKGeomAlgo TKPrim TKShHealing TKMesh
  TKBO TKBool TKFillet TKOffset TKFeat
  TKXSBase TKDESTEP TKDESTL
)
