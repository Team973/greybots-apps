# Native build of the part sorter (sorter_cli), for tuning on sample photos.
FROM debian:bookworm-slim
RUN echo 'Acquire::Retries "10";' > /etc/apt/apt.conf.d/80retries \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       build-essential cmake ninja-build libopencv-core-dev libopencv-imgproc-dev libopencv-imgcodecs-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
