// Messages between the Part sorter page and its worker (worker.ts).

export type PartKind = 'bolts' | 'gears';

export type Provider = 'webgpu' | 'wasm';

export interface SorterGroup {
  // Medians, in pixels of the scan photo.
  length: number;
  diameter: number;
  // In this photo, and at the scan.
  count: number;
  total: number;
}

export interface SorterPart {
  // Index into groups, or -1 for "?" (couldn't be measured or matched).
  group: number;
  // x0, y0, x1, y1, ... in the photo's pixels.
  outline: number[];
}

export interface SorterResult {
  width: number;
  height: number;
  // How much bigger things look than at the scan (checks only).
  scale: number;
  headPx: number;
  groups: SorterGroup[];
  parts: SorterPart[];
}

export interface Timings {
  // Turning the photo into the network's input and its output into maps; the
  // network itself; and the C++ (splitting, measuring, grouping).
  prepMs: number;
  modelMs: number;
  sorterMs: number;
}

// What the worker loaded, for the page's details and speed test.
export interface ReadyInfo {
  provider: Provider;
  // CPU threads ONNX Runtime uses (more than 1 needs cross-origin isolation).
  threads: number;
  // Downloading and starting the network and the C++ module.
  loadMs: number;
  // The GPU, when the browser says.
  gpu?: string;
}

export type ToWorker =
  // prefer: 'wasm' skips the GPU, and threads sets the CPU threads (default:
  // up to 4 when the page is cross-origin isolated), for comparing speeds.
  // Only the first init's prefer and threads count; later ones just reset.
  | { type: 'init'; kind: PartKind; prefer?: Provider; threads?: number }
  // mode: scan finds and locks the groups; check matches to them.
  | { type: 'run'; id: number; mode: 'scan' | 'check'; width: number; height: number; rgba: ArrayBuffer };

export type FromWorker =
  | ({ type: 'ready' } & ReadyInfo)
  | { type: 'result'; id: number; result: SorterResult; timings: Timings }
  | { type: 'error'; id?: number; message: string };
