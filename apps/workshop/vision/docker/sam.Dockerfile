# Trying SAM 2 (Meta, Apache-2.0) for finding parts: its masks go to the C++
# measuring and grouping (sorter_cli --labels). Also runs tools/seg.py
# (targets, predict; training wants a GPU: tools/seg_colab.ipynb). CPU only.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git curl libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
RUN SAM2_BUILD_CUDA=0 pip install --no-cache-dir "git+https://github.com/facebookresearch/sam2.git@2b90b9f5ceec907a1c18123530e92e794ad901a4" \
    && pip install --no-cache-dir opencv-python-headless numpy onnx onnxscript onnxruntime
RUN mkdir -p /models && curl -fsSL -o /models/sam2.1_hiera_tiny.pt \
    https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
WORKDIR /src
