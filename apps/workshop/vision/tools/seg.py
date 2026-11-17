"""The small network that finds parts on the phone, trained on SAM 2's masks.

SAM 2 large finds the bolts well but is far too big for a phone. Instead its
masks (tools/sam_masks.py) are the training labels for a small U-Net that
predicts two maps per pixel:
    fg    part or not (a scratch, a stain, the bench: not; a glint on a head: part)
    core  the middle of a part, well inside its edge, so touching parts have
          separate cores
The C++ (sorter_cli --maps) grows each core out to the edge of fg, which
splits touching parts, then measures and groups them as before.

    python seg.py targets --labels out-sam/large --out data photo...
    python seg.py train   --data data [--val IMG_7950,IMG_7953] [--iters 4000]
    python seg.py predict --model data/seg.onnx --out out-seg photo...

train writes data/seg.pt and data/seg.onnx (the model the page loads).
predict runs the ONNX model with onnxruntime, as the phone would, and writes
<name>-fg.png and <name>-core.png at the working size.
"""

import argparse
import pathlib
import time

import cv2
import numpy as np

WORK = 1280  # The long side, as sorter::prepare.


def prepare(bgr, work=WORK):
    s = work / max(bgr.shape[:2])
    if s < 1:
        return cv2.resize(bgr, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    return bgr


# ---------------------------------------------------------------- targets


def head_px(labels):
    # A typical part's width: the median short side of the elongated masks.
    widths = []
    for i in range(1, int(labels.max()) + 1):
        ys, xs = np.nonzero(labels == i)
        if len(xs) < 20:
            continue
        (_, _), (w, h), _ = cv2.minAreaRect(np.column_stack([xs, ys]).astype(np.float32))
        w, h = min(w, h), max(w, h)
        if w > 3 and 1.5 * w <= h <= 8 * w:
            widths.append(w)
    return float(np.median(widths)) if widths else 16.0


IGNORE = 128  # A target pixel the training doesn't score.


def make_targets(labels, work):
    """fg and core (uint8: 0 no, 255 yes, IGNORE don't know) from a SAM label
    image.
      bench:  masks thinner than a shank (scratches) or smaller than a head
              (specks)
      ignore: masks cut off by the photo's edge (a hose, a bin) and masks
              barely different from the bench around them (stains): SAM's
              guesses there aren't good enough to teach either way
      part:   the rest"""
    head = head_px(labels)
    light = cv2.cvtColor(work, cv2.COLOR_BGR2LAB)[:, :, 0].astype(np.float32)
    fg = np.zeros(labels.shape, np.uint8)
    core = np.zeros(labels.shape, np.uint8)
    H, W = labels.shape
    kept = ignored = 0
    ring_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    for i in range(1, int(labels.max()) + 1):
        m = (labels == i).astype(np.uint8)
        area = int(m.sum())
        if area == 0:
            continue
        d = cv2.distanceTransform(m, cv2.DIST_L2, 5)
        # A shank is about head/1.6 wide, so its middle is about head/3 from
        # its edge; a scratch's is a pixel or two.
        if d.max() < 0.2 * head or area < 0.5 * head * head:
            continue
        x, y, w, h = cv2.boundingRect(m)
        ring = cv2.dilate(m, ring_k) - m
        contrast = abs(float(light[m > 0].mean()) - float(np.median(light[(ring > 0) & (labels == 0)] if ((ring > 0) & (labels == 0)).any() else light[ring > 0])))
        # Silver bolts are low contrast too, but shaped like a bolt: long,
        # about a head wide, and solid (a stain is a blotch).
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        c = max(cs, key=cv2.contourArea)
        (_, _), (rw, rh), _ = cv2.minAreaRect(c)
        rw, rh = min(rw, rh), max(rw, rh)
        solidity = area / max(1.0, cv2.contourArea(cv2.convexHull(c)))
        boltlike = 1.8 * rw <= rh <= 8 * rw and 0.6 * head <= rw <= 1.5 * head and solidity > 0.8
        if x == 0 or y == 0 or x + w == W or y + h == H or (contrast < 18 and not boltlike):
            fg[m > 0] = np.maximum(fg[m > 0], IGNORE)
            core[m > 0] = np.maximum(core[m > 0], IGNORE)
            ignored += 1
            continue
        kept += 1
        fg[m > 0] = 255
        # The core: the part shrunk to its middle. 0.45 of the widest point's
        # half-width keeps a shank's core a few pixels wide.
        core[m > 0] = np.where(d[m > 0] >= max(1.5, 0.45 * d.max()), 255, 0)
    return fg, core, head, kept, ignored


def cmd_targets(args):
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for photo in args.photos:
        name = pathlib.Path(photo).stem
        labels = cv2.imread(str(pathlib.Path(args.labels) / f"{name}-labels.png"), cv2.IMREAD_UNCHANGED)
        if labels is None:
            print(f"{name}: no labels, skipped")
            continue
        work = prepare(cv2.imread(photo, cv2.IMREAD_COLOR))
        assert work.shape[:2] == labels.shape, f"{name}: labels aren't at the working size"
        fg, core, head, kept, ignored = make_targets(labels.astype(np.int32), work)
        cv2.imwrite(str(out / f"{name}.jpg"), work, [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(str(out / f"{name}-fg.png"), fg)
        cv2.imwrite(str(out / f"{name}-core.png"), core)
        view = (work * 0.6).astype(np.uint8)
        view[fg == 255] = (0.4 * view[fg == 255] + [0, 120, 0]).astype(np.uint8)
        view[core == 255] = (0, 220, 255)
        view[fg == IGNORE] = (0.4 * view[fg == IGNORE] + [130, 60, 130]).astype(np.uint8)
        cv2.imwrite(str(out / f"{name}-targets.png"), view)
        print(f"{name}: {kept} parts, {ignored} ignored, of {int(labels.max())} masks, head {head:.1f} px")


# ---------------------------------------------------------------- model


# The architectures. "half" (the default) runs at half the photo's
# resolution and scales its maps back up: 4x faster than "full" (0.3 s vs
# 1.2 s on one desktop CPU thread for 1280 x 960), which matters on phones
# without WebGPU, where ONNX Runtime's CPU path is about 9x slower again.
ARCHS = {
    "full": ((16, 32, 48, 64, 96), False),  # About 0.5 M weights.
    "half": ((16, 24, 32, 48, 64), True),  # About 0.25 M weights.
}
MULTIPLE = 32  # The photo's sides must be multiples of this.


def build_model(arch="half"):
    import torch
    from torch import nn

    channels, half = ARCHS[arch]

    def block(i, o, stride=1):
        return nn.Sequential(
            nn.Conv2d(i, o, 3, stride=stride, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True),
            nn.Conv2d(o, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True),
        )

    class UNet(nn.Module):
        # Five levels, down to 1/16 (1/32 for "half"): wide enough to see a
        # whole long bolt.
        def __init__(self):
            super().__init__()
            C = channels
            self.enc = nn.ModuleList([block(3, C[0], 2 if half else 1)] + [block(C[i - 1], C[i]) for i in range(1, len(C))])
            self.dec = nn.ModuleList([block(C[i + 1] + C[i], C[i]) for i in range(len(C) - 1)])
            self.head = nn.Conv2d(C[0], 2, 1)

        def forward(self, x):  # x: N x 3 x H x W, RGB in 0..1, H and W multiples of 32
            skips = []
            for i, e in enumerate(self.enc):
                x = e(x if i == 0 else nn.functional.max_pool2d(x, 2))
                skips.append(x)
            x = skips[-1]
            for i in reversed(range(len(self.dec))):
                x = nn.functional.interpolate(x, scale_factor=2.0, mode="bilinear", align_corners=False)
                x = self.dec[i](torch.cat([x, skips[i]], 1))
            x = self.head(x)  # Logits: fg, core.
            if half:
                x = nn.functional.interpolate(x, scale_factor=2.0, mode="bilinear", align_corners=False)
            return x

    return UNet()


# ---------------------------------------------------------------- training


def load_data(folder, names=None):
    folder = pathlib.Path(folder)
    items = []
    for jpg in sorted(folder.glob("*.jpg")):
        name = jpg.stem
        if names is not None and name not in names:
            continue
        img = cv2.cvtColor(cv2.imread(str(jpg)), cv2.COLOR_BGR2RGB)
        fg = cv2.imread(str(folder / f"{name}-fg.png"), cv2.IMREAD_GRAYSCALE)
        core = cv2.imread(str(folder / f"{name}-core.png"), cv2.IMREAD_GRAYSCALE)
        items.append((name, img, np.stack([fg, core], -1)))
    return items


def augment(img, tgt, size, rng):
    # Distance from the camera, angle, lighting and phone colors vary; the
    # bench and the parts don't.
    s = rng.uniform(0.7, 1.4)
    a = rng.uniform(0, 360)
    h, w = img.shape[:2]
    cx, cy = rng.uniform(0, w), rng.uniform(0, h)
    M = cv2.getRotationMatrix2D((cx, cy), a, s)
    M[:, 2] += (size / 2 - cx, size / 2 - cy)
    im = cv2.warpAffine(img, M, (size, size), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    tg = cv2.warpAffine(tgt, M, (size, size), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_REFLECT)
    if rng.random() < 0.5:
        im, tg = im[:, ::-1], tg[:, ::-1]
    im = im.astype(np.float32) / 255
    im = im * rng.uniform(0.85, 1.15, 3)  # White balance.
    im = (im - 0.5) * rng.uniform(0.7, 1.3) + 0.5 + rng.uniform(-0.15, 0.15)  # Contrast, brightness.
    im = np.clip(im, 0, 1) ** rng.uniform(0.75, 1.35)
    if rng.random() < 0.3:
        im = cv2.GaussianBlur(im, (0, 0), rng.uniform(0.5, 1.5))
    im = im + rng.normal(0, rng.uniform(0, 0.03), im.shape)
    return np.clip(im, 0, 1).astype(np.float32), tg


def loss_fn(logits, tg):
    """BCE + Dice on both maps, skipping the IGNORE pixels. tg is uint8."""
    import torch.nn.functional as F

    known = (tg != IGNORE).float()
    tgt = (tg == 255).float()
    bce = (F.binary_cross_entropy_with_logits(logits, tgt, reduction="none") * known).sum() / known.sum().clamp(min=1)
    p = logits.sigmoid() * known
    inter = (p * tgt).sum((0, 2, 3))
    dice = 1 - (2 * inter + 1) / (p.sum((0, 2, 3)) + (tgt * known).sum((0, 2, 3)) + 1)
    return bce + dice.mean()


def pad_to_multiple(x):
    h, w = x.shape[-2:]
    return (MULTIPLE - h % MULTIPLE) % MULTIPLE, (MULTIPLE - w % MULTIPLE) % MULTIPLE


def run_full(model, img_rgb, device):
    """The two maps (0..1) for a whole image."""
    import torch
    import torch.nn.functional as F

    x = torch.from_numpy(img_rgb.astype(np.float32) / 255).permute(2, 0, 1)[None].to(device)
    ph, pw = pad_to_multiple(x)
    x = F.pad(x, (0, pw, 0, ph), mode="reflect")
    with torch.no_grad():
        y = model(x).sigmoid()[0, :, : img_rgb.shape[0], : img_rgb.shape[1]]
    return y.cpu().numpy()


def cmd_train(args):
    import torch

    torch.manual_seed(0)
    rng = np.random.default_rng(0)
    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    val_names = set(filter(None, args.val.split(",")))
    items = load_data(args.data)
    train = [it for it in items if it[0] not in val_names]
    val = [it for it in items if it[0] in val_names]
    print(f"train on {[n for n, *_ in train]}, check on {[n for n, *_ in val]}, {device}", flush=True)

    model = build_model(args.arch).to(device)
    print(f"{args.arch}: {sum(p.numel() for p in model.parameters()) / 1e6:.2f} M weights", flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.iters, pct_start=max(0.05, 2.5 / args.iters))

    def score():
        # Dice per map on the held-out photos (or the training ones if none).
        model.eval()
        d = np.zeros(2)
        for _, img, tgt in val or train:
            tgt = tgt.transpose(2, 0, 1)
            known = tgt != IGNORE
            y = (run_full(model, img, device) > 0.5) & known
            t = tgt == 255
            d += [2 * (y[c] & t[c]).sum() / max(1, y[c].sum() + t[c].sum()) for c in range(2)]
        model.train()
        return d / len(val or train)

    out = pathlib.Path(args.data)
    best, t0 = -1.0, time.time()
    for it in range(1, args.iters + 1):
        batch = [augment(*train[rng.integers(len(train))][1:], args.size, rng) for _ in range(args.batch)]
        x = torch.from_numpy(np.stack([b[0] for b in batch])).permute(0, 3, 1, 2).to(device)
        t = torch.from_numpy(np.stack([b[1] for b in batch])).permute(0, 3, 1, 2).to(device)
        loss = loss_fn(model(x), t)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if it % args.every == 0 or it == args.iters:
            d = score()
            mark = ""
            if d.mean() > best:
                best = d.mean()
                torch.save(model.state_dict(), out / "seg.pt")
                mark = " *"
            print(f"{it:5d}  loss {loss.item():.3f}  dice fg {d[0]:.3f} core {d[1]:.3f}  {time.time() - t0:.0f} s{mark}", flush=True)

    model.load_state_dict(torch.load(out / "seg.pt", map_location=device))
    model.eval().cpu()
    onnx_path = out / "seg.onnx"
    torch.onnx.export(
        model, torch.zeros(1, 3, 960, 1280), str(onnx_path), input_names=["image"], output_names=["logits"],
        dynamic_axes={"image": {2: "h", 3: "w"}, "logits": {2: "h", 3: "w"}}, opset_version=18,
        dynamo=False,  # The newer exporter can't follow the stride-2 stem with a free photo size.
    )
    # Newer exporters put the weights in a separate .data file; the page wants
    # one file.
    import onnx

    m = onnx.load(str(onnx_path))
    onnx.save(m, str(onnx_path), save_as_external_data=False)
    for extra in out.glob("seg.onnx.data"):
        extra.unlink()
    print(f"wrote {out / 'seg.pt'} and {out / 'seg.onnx'} ({(out / 'seg.onnx').stat().st_size / 1e6:.1f} MB)")


# ---------------------------------------------------------------- predict


def cmd_predict(args):
    import onnxruntime as ort

    sess = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"])
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for photo in args.photos:
        name = pathlib.Path(photo).stem
        work = prepare(cv2.imread(photo, cv2.IMREAD_COLOR))
        h, w = work.shape[:2]
        x = cv2.cvtColor(work, cv2.COLOR_BGR2RGB).astype(np.float32).transpose(2, 0, 1)[None] / 255
        ph, pw = pad_to_multiple(x)
        x = np.pad(x, ((0, 0), (0, 0), (0, ph), (0, pw)), mode="reflect")
        t0 = time.time()
        y = sess.run(None, {"image": x})[0][0, :, :h, :w]
        ms = (time.time() - t0) * 1000
        y = 1 / (1 + np.exp(-y))
        cv2.imwrite(str(out / f"{name}-fg.png"), (y[0] * 255).astype(np.uint8))
        cv2.imwrite(str(out / f"{name}-core.png"), (y[1] * 255).astype(np.uint8))
        view = work.copy()
        view[y[0] > 0.5] = (0.5 * view[y[0] > 0.5] + [0, 90, 0]).astype(np.uint8)
        view[y[1] > 0.5] = (0, 220, 255)
        cv2.imwrite(str(out / f"{name}-maps.png"), view)
        print(f"{name}: {ms:.0f} ms", flush=True)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("targets")
    t.add_argument("--labels", required=True)
    t.add_argument("--out", default="data")
    t.add_argument("photos", nargs="+")
    r = sub.add_parser("train")
    r.add_argument("--data", default="data")
    r.add_argument("--val", default="", help="photo names to hold out, comma separated")
    r.add_argument("--iters", type=int, default=4000)
    r.add_argument("--batch", type=int, default=8)
    r.add_argument("--size", type=int, default=384)
    r.add_argument("--lr", type=float, default=3e-3)
    r.add_argument("--every", type=int, default=250)
    r.add_argument("--device")
    r.add_argument("--arch", choices=sorted(ARCHS), default="half")
    p = sub.add_parser("predict")
    p.add_argument("--model", required=True)
    p.add_argument("--out", default="out-seg")
    p.add_argument("photos", nargs="+")
    args = ap.parse_args()
    {"targets": cmd_targets, "train": cmd_train, "predict": cmd_predict}[args.cmd](args)


if __name__ == "__main__":
    main()
