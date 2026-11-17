"""Finds parts with SAM 2 (Meta, Apache-2.0) and writes them as label images
for sorter_cli --labels, to compare against the classical finder.

    python sam_masks.py --out DIR [--work 1280] [--points 32] [--crops 1] photo...

For each photo, at the same working size as sorter_cli (long side --work):
    <name>-labels.png  16-bit, one number per part (0 = none)
    <name>-sam.png     the masks in random colors, for a look
and a line with the mask count and the time taken.

Runs in docker/sam.Dockerfile (CPU, slow) or on a Colab GPU
(tools/sam_colab.ipynb, which carries a copy of this file).
"""

import argparse
import pathlib
import time

import cv2
import numpy as np
import torch
from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
from sam2.build_sam import build_sam2


MODELS = {
    "tiny": ("configs/sam2.1/sam2.1_hiera_t.yaml", "sam2.1_hiera_tiny.pt"),
    "large": ("configs/sam2.1/sam2.1_hiera_l.yaml", "sam2.1_hiera_large.pt"),
}


def prepare(bgr, work):
    # Same as sorter::prepare: shrink so the long side is `work`.
    s = work / max(bgr.shape[:2])
    if s < 1:
        return cv2.resize(bgr, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    return bgr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out-sam")
    ap.add_argument("--work", type=int, default=1280)
    ap.add_argument("--points", type=int, default=32, help="points per side of the prompt grid")
    ap.add_argument("--crops", type=int, default=1, help="crop layers (more finds smaller parts, slower)")
    ap.add_argument("--model", choices=sorted(MODELS), default="tiny",
                    help="tiny is the size that could run in a browser; large shows the best SAM can do")
    ap.add_argument("--checkpoints", default="/models", help="folder with the sam2.1_hiera_*.pt files")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("photos", nargs="+")
    args = ap.parse_args()

    config, checkpoint = MODELS[args.model]
    model = build_sam2(config, str(pathlib.Path(args.checkpoints) / checkpoint), device=args.device)
    generator = SAM2AutomaticMaskGenerator(
        model,
        points_per_side=args.points,
        points_per_batch=64,
        pred_iou_thresh=0.7,
        stability_score_thresh=0.88,
        crop_n_layers=args.crops,
        crop_n_points_downscale_factor=1,
        min_mask_region_area=40,
    )

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(0)
    for photo in args.photos:
        name = pathlib.Path(photo).stem
        work = prepare(cv2.imread(photo, cv2.IMREAD_COLOR), args.work)
        h, w = work.shape[:2]
        t0 = time.time()
        with torch.inference_mode():
            masks = generator.generate(cv2.cvtColor(work, cv2.COLOR_BGR2RGB))
        seconds = time.time() - t0

        # Best masks first; each pixel goes to the first mask that claims it,
        # and a mask that lost most of its pixels to better ones is dropped.
        # Masks covering a big share of the frame are bench, not parts.
        masks.sort(key=lambda m: m["predicted_iou"] * m["stability_score"], reverse=True)
        labels = np.zeros((h, w), np.uint16)
        n = 0
        for m in masks:
            seg = m["segmentation"]
            area = int(seg.sum())
            if area < 40 or area > 0.01 * h * w:
                continue
            free = seg & (labels == 0)
            if free.sum() < 0.6 * area:
                continue
            n += 1
            labels[free] = n
        cv2.imwrite(str(out / f"{name}-labels.png"), labels)

        colors = rng.integers(40, 255, size=(n + 1, 3), dtype=np.uint8)
        colors[0] = 0
        view = (work * 0.4 + colors[labels] * 0.6).astype(np.uint8)
        view[labels == 0] = (work[labels == 0] * 0.5).astype(np.uint8)
        cv2.imwrite(str(out / f"{name}-sam.png"), view)
        print(f"{name}: {len(masks)} masks, {n} kept, {seconds:.1f} s ({args.model}, {args.device})", flush=True)


if __name__ == "__main__":
    main()
