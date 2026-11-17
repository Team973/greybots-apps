# Builds the part sorter's C++ to WebAssembly: a pinned Emscripten, and
# OpenCV's core and imgproc built for it (static, SIMD, no threads).
# scripts/build-part-sorter.sh uses this image.
FROM emscripten/emsdk:3.1.64

ARG OPENCV_VERSION=4.10.0
RUN apt-get update && apt-get install -y --no-install-recommends ninja-build \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL --retry 8 --retry-all-errors -o /tmp/opencv.tar.gz https://github.com/opencv/opencv/archive/refs/tags/${OPENCV_VERSION}.tar.gz \
    && mkdir -p /src && tar -xzf /tmp/opencv.tar.gz -C /src && rm /tmp/opencv.tar.gz
RUN emcmake cmake -S /src/opencv-${OPENCV_VERSION} -B /tmp/opencv-build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/opt/opencv-wasm \
        -DCMAKE_C_FLAGS="-msimd128" -DCMAKE_CXX_FLAGS="-msimd128" \
        -DBUILD_LIST=core,imgproc \
        -DBUILD_SHARED_LIBS=OFF \
        -DCV_ENABLE_INTRINSICS=ON -DCPU_BASELINE= -DCPU_DISPATCH= \
        -DCV_TRACE=OFF -DWITH_PTHREADS_PF=OFF -DWITH_ITT=OFF -DWITH_IPP=OFF -DWITH_OPENCL=OFF \
        -DWITH_EIGEN=OFF -DWITH_LAPACK=OFF -DWITH_OPENMP=OFF -DWITH_TBB=OFF -DWITH_ADE=OFF \
        -DWITH_PROTOBUF=OFF -DWITH_QUIRC=OFF -DWITH_FFMPEG=OFF -DWITH_GTK=OFF -DWITH_JPEG=OFF -DWITH_PNG=OFF \
        -DWITH_TIFF=OFF -DWITH_WEBP=OFF -DWITH_OPENJPEG=OFF -DWITH_JASPER=OFF -DWITH_OPENEXR=OFF -DWITH_IMGCODEC_HDR=OFF \
        -DBUILD_ZLIB=ON -DBUILD_opencv_apps=OFF -DBUILD_TESTS=OFF -DBUILD_PERF_TESTS=OFF -DBUILD_EXAMPLES=OFF \
        -DBUILD_DOCS=OFF -DBUILD_JAVA=OFF -DBUILD_opencv_python3=OFF -DBUILD_opencv_js=OFF \
    && cmake --build /tmp/opencv-build \
    && cmake --install /tmp/opencv-build \
    && rm -rf /tmp/opencv-build
WORKDIR /repo
