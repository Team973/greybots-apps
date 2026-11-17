// The page's side of the Part sorter worker: start it, and run photos through
// it one at a time.
import type { FromWorker, PartKind, Provider, ReadyInfo, SorterResult, Timings, ToWorker } from './protocol';

// The network and the C++ want the photo at this size on its long side, with
// both sides multiples of 32 (the network halves it five times).
export const WORK_SIZE = 1280;

export function workSize(width: number, height: number, size = WORK_SIZE) {
  const s = Math.min(1, size / Math.max(width, height));
  const round32 = (v: number) => Math.max(32, Math.round((v * s) / 32) * 32);
  return { width: round32(width), height: round32(height) };
}

export interface ClientOptions {
  // 'wasm' skips the GPU; threads sets ONNX Runtime's CPU threads.
  prefer?: Provider;
  threads?: number;
}

// Long enough for a first download on a slow connection.
const THREAD_TIMEOUT_MS = 60_000;

type Pending ={ resolve: (r: { result: SorterResult; timings: Timings }) => void; reject: (e: Error) => void };

export class PartSorterClient {
  private worker!: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private ready: Promise<ReadyInfo>;

  constructor(kind: PartKind, options: ClientOptions = {}) {
    const threaded = options.threads !== 1 && globalThis.crossOriginIsolated;
    let first = this.start(kind, options);
    // Threads can fail, or hang starting, where isolation is only partly
    // supported; one thread always works.
    if (threaded) first = Promise.race([first, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out starting threads.')), THREAD_TIMEOUT_MS))]);
    this.ready = first.catch((err) => {
      if (!threaded) throw err;
      this.worker.terminate();
      return this.start(kind, { ...options, threads: 1 });
    });
  }

  private start(kind: PartKind, options: ClientOptions) {
    // Named, so ONNX Runtime's thread workers (started from the same script)
    // can tell they aren't this one.
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'part-sorter' });
    const ready = new Promise<ReadyInfo>((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const msg = event.data;
        if (msg.type === 'ready') {
          const { type: _type, ...info } = msg;
          resolve(info);
        } else if (msg.type === 'result') {
          this.pending.get(msg.id)?.resolve({ result: msg.result, timings: msg.timings });
          this.pending.delete(msg.id);
        } else if (msg.id === undefined) reject(new Error(msg.message));
        else {
          this.pending.get(msg.id)?.reject(new Error(msg.message));
          this.pending.delete(msg.id);
        }
      };
      this.worker.onerror = (event) => reject(new Error(event.message || 'The part finder failed to load.'));
    });
    this.send({ type: 'init', kind, prefer: options.prefer, threads: options.threads });
    return ready;
  }

  // What the network runs on, once it's loaded.
  whenReady() {
    return this.ready;
  }

  // Restarts with no locked groups (a rescan, or the other kind of part).
  reset(kind: PartKind) {
    this.send({ type: 'init', kind });
  }

  run(mode: 'scan' | 'check', image: ImageData) {
    const id = this.nextId++;
    const rgba = image.data.buffer as ArrayBuffer;
    return new Promise<{ result: SorterResult; timings: Timings }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ type: 'run', id, mode, width: image.width, height: image.height, rgba }, [rgba]);
    });
  }

  dispose() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Stopped.'));
    this.pending.clear();
  }

  private send(msg: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }
}

// Draws any image source at the working size (`size` on its long side), for
// the worker.
export function grab(source: CanvasImageSource, width: number, height: number, size = WORK_SIZE): ImageData {
  const out = workSize(width, height, size);
  const canvas = new OffscreenCanvas(out.width, out.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return ctx.getImageData(0, 0, out.width, out.height);
}
