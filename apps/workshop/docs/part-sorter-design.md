# Part sorter: design

A Workshop page that helps a student sort a pile of hardware. They point a phone at the parts (all bolts, or all gears) spread on a plain surface and take a snapshot. The page groups the parts by type and highlights the **physically largest type** first. The student pulls those out into a bin and snaps again. When none of that type is left, the page moves on to the next largest, in a new color, until the pile is sorted.

Everything runs **on the phone**. There's no server and nothing is uploaded.

This document records the decisions made so far, what the sample photos showed, and the risks still open.

## What it does

- **One kind per pile.** The student picks Bolts or Gears first, so each kind can use its own measurements.
- **"Same type"** means:
  - Bolts: same length and shank diameter.
  - Gears: same outside diameter and tooth count, and the same bore shape (hex or round) where that can be told apart.
  - Thread pitch (10-24 vs 10-32) can't be seen in a photo, so those are grouped together.
- **No markers, no real sizes.** The parts go on any plain surface. Sizes are only relative to each other in the image, so groups are shown by **color and count** ("Group 2 of 5 · 12 left") rather than names like "1/4-20 x 1".
- **Snap, sort, snap again.** Finding parts in a dense pile takes the phone about a second (see below), so the page works from snapshots rather than live video:
  1. **Scan:** the first snapshot finds and groups the parts. The groups are **locked** from then on, so colors don't swap as the pile shrinks.
  2. The current group is highlighted on the photo. The student takes those parts out of view.
  3. **Check:** another snapshot. Each part found is matched to its locked group, allowing for the phone being a bit closer or further than before. If none of the current group is left, the page moves on with a short message and a vibration. If some are left, they're highlighted again.
  4. Skip and Back override it, and Rescan starts over.
- **Dense, touching piles are the normal case,** as in the sample photos. A part the page can't measure (half buried, standing on end) is outlined in yellow as "?" rather than guessed.
- **Phones, handheld or on a stand.** A stand gives the steadiest results.
- Everyone with Workshop access can use it, from the nav. Nothing is saved, so it has no tables and no migrations.

## How it finds parts

### What the sample photos showed

Eight photos of dense bolt piles on a scratched shop floor (about 150 bolts each, many touching) were run through three ways of finding the parts. The same C++ measured and grouped the results.

| Finder | Parts measured and grouped per photo | "?" per photo | Runs on a phone? |
| --- | --- | --- | --- |
| Classical OpenCV (threshold, split at notches and along skeletons) | 40–50 | 55–83 | Yes |
| SAM 2 tiny (Meta, Apache-2.0) | 75–95 | 60–90 | Barely: tens of MB, seconds per photo |
| SAM 2 large | **105–123** | **21–57** | No: about 900 MB, 28 s per photo on a cloud GPU |
| The small network below (first, full-resolution version), trained on SAM large's masks of 6 photos, on the 2 it never saw | **111–118** | **13–16** | Yes, but slow on a CPU: 2 MB |
| The same at half resolution (the one the page uses), on the same 2 | **102–114** | **16–26** | Yes: 1 MB, 0.15 s on a desktop GPU, 0.7 s on 4 desktop CPU threads |

The classical finder fails on dense piles. Touching bolts merge, floor scratches and stains look like parts, and glints on heads punch holes in them. SAM large finds almost every bolt separately, including touching ones, and ignores glints. But it's far too big for a phone.

### The approach: SAM teaches a small network

SAM 2 large is used **once, offline**, to label the training photos. A small network trained on those labels runs on the phone. Nobody has to draw outlines by hand.

```
training photos ─► SAM 2 large (Colab GPU) ─► masks ─► seg.py targets ─► fg + core maps
                                                                              │
                                     seg.py train (Colab GPU) ◄───────────────┘
                                              │
                                              ▼
                       seg.onnx (about 0.25 M weights, 1 MB) ─► committed, loaded by the page
```

**The network** (`apps/workshop/vision/tools/seg.py`) is a small U-Net with five levels, wide enough to see a whole long bolt. It works at half the photo's resolution and scales its maps back up (`--arch half`): about 0.25 M weights, 1 MB. The first version worked at full resolution (`--arch full`, 0.5 M weights) and was 4× slower; see the timings below. It predicts two maps for each pixel:
- **fg:** part or not. A scratch, a stain or the bench is not. A glint on a head is.
- **core:** the middle of a part, well inside its edge. Touching parts touch at their edges, not their middles, so each part gets its own core.

The C++ then grows each core outward to the edge of fg (a watershed over the photo). That splits touching parts along the line between them, and the result goes to the same measuring and grouping as before. Feeding SAM's own maps through this step gives 116 parts grouped on a photo where SAM's masks gave 123, so splitting by cores loses little.

**Scratches and reflections** are handled by what the network learns, not by thresholds. The training targets are cleaned first (`seg.py targets`):
- **Bench:** masks thinner than a shank (scratches) and masks smaller than a head (specks) count as bench.
- **Ignored in training:** masks cut off by the photo's edge (a hose, a bin) and low-contrast blotches (stains). SAM's guesses there aren't good enough to teach either way, so those pixels are left out of training.
- **Kept:** low-contrast masks shaped like a bolt (long, about a head wide, solid), so silver bolts on a gray floor still count.
- **Augmentations during training:** any rotation, 0.7–1.4× scale, white balance, brightness, contrast, gamma, blur and noise. These stand in for different phones, lighting and heights.

### On the phone

Per snapshot:
1. Take a frame from the rear camera and shrink it to 1280 px on the long side. Bolt shanks are only about 16 px wide at that size, so it can't go much smaller: on a sample photo, 1024 px grouped 107 parts where 1280 px grouped 113, and 768 px only 89.
2. **The network** in ONNX Runtime Web. It uses WebGPU where the phone has it, and WASM with SIMD otherwise, on up to 4 threads. Measured for a 1280 × 960 photo, the network alone:

   | | Full-resolution network | Half-resolution network (used) |
   | --- | --- | --- |
   | Native, one CPU thread | 1.16 s | 0.29–0.34 s |
   | Desktop Chrome, WebGPU (Intel integrated GPU) | 1.1–4 s | 0.13–0.19 s |
   | Desktop Chrome, WASM, one thread | 10–13 s | 1.8–2.3 s |
   | Desktop Chrome, WASM, 4 threads | — | 0.7–0.95 s |

   On the GPU, the first run at each photo size compiles shaders (1–2 s on a desktop), so the worker runs the network once on a blank frame of each camera orientation while the page loads. **Real phones are still to be measured;** the page's speed test does that (below).
3. **The C++ module** (OpenCV `core` + `imgproc` compiled to WASM): cores to parts, measuring, grouping or matching to the locked groups. 130–170 ms natively; 0.4–0.9 s in desktop Chrome, slowest on the first photo. With the network on the GPU, this is now the largest step, followed by turning the photo into the network's input and back (0.15–0.3 s, plain JavaScript).

**Download, first visit only** (gzip; cached after): ONNX Runtime's WebGPU build 6.9 MB, the C++ module 0.6 MB, the network 1–2 MB.

Both run in one Web Worker, so the page never freezes. The model and the module are fetched only on this page, and are cached after the first visit.

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Finding parts | The small U-Net, in ONNX Runtime Web (MIT) | Dense piles need a learned finder (above). ORT Web runs the same ONNX file on WebGPU or WASM. |
| Labels for training | SAM 2.1 large (Apache-2.0), on a free Colab GPU | No hand labeling. 28 s per photo, offline only. |
| Training | PyTorch on Colab (`tools/seg_colab.ipynb`) | About 10 minutes per run on a T4. Retrain when new photos are added. |
| Measuring, grouping, matching | C++ against OpenCV, compiled to WASM | One call per snapshot. The same code runs natively over the sample photos for tuning. About 2–3 MB with only `core` and `imgproc`. |

**C++ → WASM vs opencv.js** (the earlier trade study still holds for this part):
- opencv.js is the same OpenCV compiled to WASM, but stock it's about 8–10 MB with no SIMD.
- It needs dozens of JS↔WASM calls per photo, and every `Mat` has to be freed by hand.
- A trimmed C++ build is about a quarter of the size, uses SIMD, and is one call with no manual memory bookkeeping.

**Alternative for running the network:** OpenCV's own `dnn` module can load the same ONNX file inside the C++ module. That makes one download and one call, but adds a few MB and has no WebGPU. ORT Web is the starting choice; if its runtime download turns out too large on phones, `dnn` is the fallback. This is decided by measurements in milestone 2.

**Licenses:** everything above is MIT, BSD or Apache-2.0. Ultralytics YOLO is AGPL, so it is avoided.

### Build choices

- **OpenCV 4.x, only `core` and `imgproc`,** built as static libraries with `-O3 -msimd128`. Every browser the page supports has WASM SIMD: Chrome 91, Safari 16.4, Firefox 89.
- **The C++ module has no threads; ONNX Runtime has up to 4.** Threads need the page to be cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`). `vercel.json` sends those for `/part-sorter` (and `/assets/`, for its workers) only, since isolation blocks cross-origin images without CORP headers elsewhere. Isolation only takes hold on a full page load, so the router loads the page afresh going into or out of the Part sorter. Where threads fail to start, the worker falls back to one.
- **Built in a pinned `emscripten/emsdk` Docker image** (`scripts/build-part-sorter.sh`), so a laptop build matches CI.
  - The output (`part-sorter.js`, `.wasm`) and `seg.onnx` are **committed** under `apps/workshop/src/lib/partSorter/`.
  - A stamp file holds the hash of the sources they were built from.
  - Vercel and the dev server never need Emscripten or PyTorch. CI rebuilds the module and fails if the stamp is out of date.

## Measuring and grouping (`apps/workshop/vision/src/sorter.cpp`)

1. **Parts** come from the network's maps (`labelsFromMaps`), or for testing from SAM's masks (`detectFromLabels`).
   - Parts cut off by the photo's edge, and anything too thin or too small to be a part, are dropped.
   - A typical part width (`headPx`) is the median short side of the long, thin parts.
2. **Measure each bolt**, in pixels.
   - Rotate it to its main axis.
   - Read the width all along it, softened at the edges so the threads' sawtooth doesn't skew it.
   - Length: head included.
   - Head width: the wider end.
   - Shank diameter: the median width along the shank.
   - A part whose numbers can't be a single bolt is "?". That means one standing on end, a shank with no head, or a "head" far wider than anyone's.
3. **Group** with mean shift on log length and log diameter. Within about 7% on length and 9% on diameter counts as the same type. Groups are ordered by volume (length × diameter²), largest first.
4. **Check snapshots:** a 1-D search finds the scale (the phone a bit closer or further) that best fits the parts to the parts seen at the scan. Each part then goes with most of its five nearest scan parts, which reproduces the scan's group edges (matching to each group's median moved about 1 in 7 bolts to a neighboring group). A part near none of them is "?".
5. **Gears** (milestone 4): outside diameter; tooth count, from the strongest repeating bump in the outline's radius; bore diameter and shape. The network learns gears the same way, from SAM-labeled gear photos.

## The page (`apps/workshop/src/views/PartSorterView.vue`)

- **Start:** Bolts or Gears, then the camera (rear).
- **Scan:**
  - "Hold the phone above the parts" and a Scan button.
  - A spinner while it works, about 1–2 s.
  - The photo with every group in its color, then straight on to group 1.
- **Sorting:**
  - The snapshot with an overlay. The current group is filled in its color, the other parts are dim, and "?" parts have a dashed yellow outline.
  - A header: "Group 2 of 5 · 12 left", the group's color, and a bar showing its size next to the largest group.
  - **Check** (snap again), Skip, Back and Rescan.
  - The live camera shows between snapshots, so the student can aim.
  - The screen is kept awake (Wake Lock), and there's a torch toggle where the phone has one.
- If the camera is blocked or missing, or the browser lacks WASM SIMD, the page says so and what to do.
- **Save photo** shares (on phones) or downloads the photo and the result drawn on it, so photos it gets wrong can go into training.
- **Speed and details** (collapsed): the device, what the network runs on, each snapshot's timings, and a **speed test**. The test runs the last photo on the GPU, on the CPU with threads and on one thread, at 1280, 1024 and 768 px, and reports each step's time and what was found. **Copy details** puts all of it on the clipboard to send back.

## Code layout

```
apps/workshop/vision/              The C++ project (CMake) and the training tools.
  src/sorter.h, sorter.cpp         Measuring, grouping, matching; cores to parts.
  src/wasm.cpp                     The WASM build's bindings (embind).
  tools/sorter_cli.cpp             Native: runs it over photos (--maps, --labels),
                                   writes the page's view as PNGs and a JSON summary.
  tools/sam_masks.py               SAM 2 masks for training photos.
  tools/sam_colab.ipynb            Runs sam_masks.py on a Colab GPU.
  tools/seg.py                     Training targets, training, and running the network.
  tools/seg_colab.ipynb            Runs the training on a Colab GPU.
  docker/                          Native build image; SAM/PyTorch CPU image.
apps/workshop/src/lib/partSorter/
  part-sorter.js, .wasm, .stamp    The built C++ module (committed).
  seg.onnx                         The trained network (committed, 1–2 MB).
  worker.ts                        The Web Worker: the network, then the C++.
  client.ts, protocol.ts           The page's side of the worker, and its messages.
  speedTest.ts                     The speed test in Speed and details.
  draw.ts                          Draws a snapshot with the groups' colors.
apps/workshop/src/views/PartSorterView.vue   The page (/part-sorter).
scripts/build-part-sorter.sh       Builds the module in the pinned emsdk image.
```

## Training data and testing

- **The photos stay out of git** (they're the team's, and large). Everything for R&D lives in one ignored folder, `vision/data/`: `photos/`, SAM's masks (`out-sam/`), the training targets (`seg-data/`, `seg-data.zip`), each training run's output (`out-seg*/`), and `sorter_cli`'s output (`out/`). Only the trained `seg.onnx` is committed.
- **More photos are needed.** The eight so far are all bolts on the same floor in the same light. The network will learn that floor. For a model that holds up:
  - 30–50 photos
  - other surfaces (bench top, cardboard, a mat)
  - other lighting, and with and without flash
  - two or three phones
  - piles of each density
  - gears
- **Held-out photos** measure how well it does on photos it hasn't seen. `seg_colab.ipynb` trains once with two photos held out, which shows how good it is, and once on all of them, which gives the model the page uses.
- **Scoring:** each photo's results are compared with SAM large's on the same photo:
  - parts found
  - "?" count
  - the groups' sizes and order
- Later, a hand-checked `labels.json` (the count of each type in each photo) gives a true answer key.

## Milestones

1. **Done:**
   - The C++ measuring and grouping, and `sorter_cli`.
   - The classical finder, kept for comparison only.
   - SAM labeling, training targets, and the training notebook.
2. **Done:** the network trained on SAM large's masks; on two held-out photos it is close to SAM large itself (table above).
3. **The page, in progress:**
   - Done: the WASM build, ONNX Runtime Web, the worker; Scan and highlight on a snapshot, then Check / Skip / Back / Rescan; "Use a photo"; vibration, wake lock, torch.
   - Done: the half-resolution network (4× faster, a little less accurate); ONNX Runtime threads; GPU warm-up; Save photo; the speed test.
   - Next: run the speed test on the team's phones (a Vercel preview), and a sorting session with real bolts, saving the photos it gets wrong. Then choose: the photo size, and whether the C++ or the JavaScript around the network needs work next.
   - More photos when users' feedback shows where it fails.
4. **Gears:** gear photos into the training set, plus the gear measurements.

## Risks

- **Too few training photos.** The network may only work on the floor it was trained on. Mitigated by more varied photos (above) and by holding photos out to check.
- **SAM's mistakes are learned too.** A few stains are labeled as parts, and bolts half under others are labeled short. The cleaning rules catch most of it. Hand-fixing a few masks is possible if needed.
- **Speed on older phones.** If a snapshot takes over about 3 s, the fallbacks are:
  - run the network at a smaller size, with a crop around the pile
  - quantize it to 8 bits
- **Half-buried bolts** measure short and can land in a smaller group. Each Check snapshot re-measures, and they usually come clear as the pile thins.
- **Small bolts in a pile of big ones** were "?" until the thinnest allowed shank was lowered (`Params::minShank`, 0.25 of a typical part's width for the network). They now form their own group.
- **Some dark gray bolts are missed entirely,** by SAM and so by the network. More photos with them, or a hand fix of a few masks, should teach it.
- **Grouping can split one type in two** (for example L 57 and L 44 for what SAM calls one type) or leave lone parts as their own groups. Mean-shift bandwidths, and folding a lone part into a near group, need tuning against a hand-checked answer key.
- **A tilted phone** makes far parts look smaller. The scan asks for a roughly top-down view; a stand avoids it.
- **Thread pitch** isn't distinguished at all (see above).
