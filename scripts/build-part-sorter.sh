#!/bin/bash
# Builds the Workshop part sorter's WebAssembly module from
# apps/workshop/vision (C++ and OpenCV) in a pinned Emscripten image, and
# writes it where the page imports it from:
#   apps/workshop/src/lib/partSorter/part-sorter.js, part-sorter.wasm
#   apps/workshop/src/lib/partSorter/part-sorter.stamp  (hash of the inputs)
# The output is committed, so Vercel and the dev server never need Emscripten.
#
#   scripts/build-part-sorter.sh          build
#   scripts/build-part-sorter.sh --check  exit 1 if the committed build is stale
#
# Needs Docker. The first run builds the image (OpenCV for WASM), which takes
# a while; later runs take seconds.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
vision=apps/workshop/vision
out=apps/workshop/src/lib/partSorter
image=greybots-part-sorter-wasm

# The inputs: the C++, its CMake file and the image it's built in.
stamp() {
  find "$vision/src" "$vision/CMakeLists.txt" "$vision/docker/wasm.Dockerfile" -type f -print0 \
    | LC_ALL=C sort -z | xargs -0 cat | sha256sum | cut -d' ' -f1
}

if [ "${1:-}" = "--check" ]; then
  if [ "$(stamp)" = "$(cat "$out/part-sorter.stamp" 2>/dev/null)" ]; then
    echo "part-sorter module is up to date."
    exit 0
  fi
  echo "part-sorter module is out of date: run scripts/build-part-sorter.sh and commit the result."
  exit 1
fi

if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker build -f "$vision/docker/wasm.Dockerfile" -t "$image" "$vision/docker"
fi

# Git Bash on Windows rewrites paths that start with /; keep them as written.
root="$(pwd -W 2>/dev/null || pwd)"
MSYS_NO_PATHCONV=1 docker run --rm -v "$root":/repo -w /repo/$vision "$image" bash -c "
  emcmake cmake -S . -B build-wasm -G Ninja -DOpenCV_DIR=/opt/opencv-wasm/lib/cmake/opencv4 >/dev/null &&
  cmake --build build-wasm"

mkdir -p "$out"
cp "$vision/build-wasm/part-sorter.js" "$vision/build-wasm/part-sorter.wasm" "$out/"
stamp > "$out/part-sorter.stamp"
ls -l "$out"/part-sorter.*
