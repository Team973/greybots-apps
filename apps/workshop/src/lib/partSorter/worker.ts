// The Part sorter's worker: runs the part-finding network (ONNX Runtime Web,
// on the GPU where the browser allows, else WASM) and the C++ module
// (part-sorter.wasm) that turns its maps into measured, grouped parts. See
// apps/workshop/docs/part-sorter-design.md.
/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import createPartSorter, { type PartSorterModule } from './part-sorter.js';
import sorterWasmUrl from './part-sorter.wasm?url';
import modelUrl from './seg.onnx?url';
import type { FromWorker, PartKind, Provider, ReadyInfo, SorterResult, ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };

// A 4:3 camera frame at the working size (client.ts workSize).
const WARM_SIZE = [1280, 960];

let session: ort.InferenceSession | null = null;
let info: ReadyInfo | null = null;
let sorter: PartSorterModule | null = null;

function post(message: FromWorker) {
  self.postMessage(message);
}

// ONNX Runtime's own default: half the cores, at most 4. Threads need the
// page to be cross-origin isolated (vercel.json sets that for this page).
function defaultThreads() {
  return self.crossOriginIsolated ? Math.min(4, Math.ceil((navigator.hardwareConcurrency || 1) / 2)) : 1;
}

async function load(kind: PartKind, prefer?: Provider, threads?: number) {
  if (!session) {
    const t0 = performance.now();
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, threads ?? defaultThreads()) : 1;
    const model = new Uint8Array(await (await fetch(modelUrl)).arrayBuffer());
    // The GPU when there is one; otherwise the CPU, which works everywhere.
    type Adapter = { info?: { vendor?: string; architecture?: string; device?: string; description?: string } };
    const webgpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu;
    const adapter = webgpu && prefer !== 'wasm' ? await webgpu.requestAdapter().catch(() => null) : null;
    let provider: Provider = 'wasm';
    if (adapter) {
      try {
        session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'] });
        provider = 'webgpu';
      } catch {
        session = null;
      }
    }
    if (!session) session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
    // The GPU compiles its shaders on the first run at each photo size, which
    // takes seconds on a phone: do it now, for the camera's sizes held either
    // way, rather than on the first Scan.
    if (provider === 'webgpu') {
      for (const [w, h] of [WARM_SIZE, [WARM_SIZE[1], WARM_SIZE[0]]]) {
        const out = await session.run({ image: new ort.Tensor('float32', new Float32Array(3 * w * h), [1, 3, h, w]) });
        out.logits.dispose();
      }
    }
    if (!sorter) sorter = await createPartSorter({ locateFile: () => sorterWasmUrl });
    const a = adapter?.info;
    const gpu = a ? [a.vendor, a.architecture, a.device, a.description].filter(Boolean).join(' ') : undefined;
    info = { provider, threads: ort.env.wasm.numThreads ?? 1, loadMs: performance.now() - t0, gpu: provider === 'webgpu' ? gpu || 'unknown' : undefined };
  }
  sorter!._sorter_init(kind === 'gears' ? 1 : 0);
}

// The network: the photo (RGBA, its sides multiples of 32) in, two maps out
// (part or not, and parts' middles), each 0-255.
async function findParts(rgba: Uint8ClampedArray, width: number, height: number) {
  const t0 = performance.now();
  const n = width * height;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    input[i] = rgba[4 * i] / 255;
    input[n + i] = rgba[4 * i + 1] / 255;
    input[2 * n + i] = rgba[4 * i + 2] / 255;
  }
  const t1 = performance.now();
  const outputs = await session!.run({ image: new ort.Tensor('float32', input, [1, 3, height, width]) });
  const logits = outputs.logits.data as Float32Array;
  const t2 = performance.now();
  const fg = new Uint8Array(n);
  const core = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    fg[i] = 255 / (1 + Math.exp(-logits[i]));
    core[i] = 255 / (1 + Math.exp(-logits[n + i]));
  }
  outputs.logits.dispose();
  const t3 = performance.now();
  return { fg, core, prepMs: t1 - t0 + (t3 - t2), modelMs: t2 - t1 };
}

function sort(mode: 'scan' | 'check', rgba: Uint8ClampedArray, width: number, height: number, fg: Uint8Array, core: Uint8Array): SorterResult {
  const m = sorter!;
  const n = width * height;
  const pRgba = m._malloc(4 * n);
  const pFg = m._malloc(n);
  const pCore = m._malloc(n);
  try {
    m.HEAPU8.set(rgba, pRgba);
    m.HEAPU8.set(fg, pFg);
    m.HEAPU8.set(core, pCore);
    const json = m.UTF8ToString(m._sorter_run(mode === 'scan' ? 0 : 1, pRgba, width, height, pFg, pCore));
    return JSON.parse(json) as SorterResult;
  } finally {
    m._free(pRgba);
    m._free(pFg);
    m._free(pCore);
  }
}

// One job at a time, in order: a scan's groups must be locked before a check.
let queue = Promise.resolve();

function onMessage(event: MessageEvent<ToWorker>) {
  const msg = event.data;
  queue = queue.then(async () => {
    try {
      if (msg.type === 'init') {
        await load(msg.kind, msg.prefer, msg.threads);
        post({ type: 'ready', ...info! });
      } else {
        const rgba = new Uint8ClampedArray(msg.rgba);
        const { fg, core, prepMs, modelMs } = await findParts(rgba, msg.width, msg.height);
        const t0 = performance.now();
        const result = sort(msg.mode, rgba, msg.width, msg.height, fg, core);
        post({ type: 'result', id: msg.id, result, timings: { prepMs, modelMs, sorterMs: performance.now() - t0 } });
      }
    } catch (err) {
      post({ type: 'error', id: msg.type === 'run' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
    }
  });
}

// With threads, ONNX Runtime starts its thread workers from this same script
// (named "em-pthread"); its own code answers their messages there.
if (!self.name.startsWith('em-pthread')) self.onmessage = onMessage;
