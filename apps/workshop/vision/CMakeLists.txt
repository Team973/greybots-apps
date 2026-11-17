cmake_minimum_required(VERSION 3.16)
project(part_sorter CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

if(EMSCRIPTEN)
  # The WebAssembly module for the Workshop page (docker/wasm.Dockerfile,
  # scripts/build-part-sorter.sh). OpenCV is the image's static core and
  # imgproc, built with SIMD.
  find_package(OpenCV REQUIRED COMPONENTS core imgproc)
  set(WASM_FLAGS -O3 -msimd128)
  add_executable(part-sorter src/sorter.cpp src/wasm.cpp)
  target_include_directories(part-sorter PRIVATE src ${OpenCV_INCLUDE_DIRS})
  target_compile_options(part-sorter PRIVATE ${WASM_FLAGS} -Wall -Wextra)
  target_link_libraries(part-sorter PRIVATE opencv_core opencv_imgproc)
  target_link_options(part-sorter PRIVATE ${WASM_FLAGS}
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createPartSorter -sENVIRONMENT=worker
    -sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=0 -sINCOMING_MODULE_JS_API=locateFile
    -sEXPORTED_FUNCTIONS=_malloc,_free,_sorter_init,_sorter_run
    -sEXPORTED_RUNTIME_METHODS=HEAPU8,UTF8ToString)
  set_target_properties(part-sorter PROPERTIES SUFFIX ".js")
else()
  # OpenCV's CMake package where there is one; otherwise the libraries
  # directly (Debian's per-module packages don't ship the CMake files).
  find_package(OpenCV QUIET COMPONENTS core imgproc imgcodecs)
  if(OpenCV_FOUND)
    set(SORTER_INCLUDES ${OpenCV_INCLUDE_DIRS})
    set(SORTER_LIBS opencv_core opencv_imgproc)
    set(CLI_LIBS opencv_imgcodecs)
  else()
    find_path(SORTER_INCLUDES opencv2/core.hpp PATH_SUFFIXES opencv4 REQUIRED)
    find_library(CV_CORE opencv_core REQUIRED)
    find_library(CV_IMGPROC opencv_imgproc REQUIRED)
    find_library(CV_IMGCODECS opencv_imgcodecs REQUIRED)
    set(SORTER_LIBS ${CV_CORE} ${CV_IMGPROC})
    set(CLI_LIBS ${CV_IMGCODECS})
  endif()

  add_library(sorter STATIC src/sorter.cpp)
  target_include_directories(sorter PUBLIC src ${SORTER_INCLUDES})
  target_link_libraries(sorter PUBLIC ${SORTER_LIBS})
  target_compile_options(sorter PRIVATE -Wall -Wextra)

  add_executable(sorter_cli tools/sorter_cli.cpp)
  target_link_libraries(sorter_cli PRIVATE sorter ${CLI_LIBS})
endif()
