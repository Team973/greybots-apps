// The Part sorter's speed test: runs one photo through the network on each
// processor the phone has (GPU; CPU with threads; CPU with one thread) at a
// few photo sizes, and reports how long each step takes and what it found.
// For choosing the defaults from real phones; see
// apps/workshop/docs/part-sorter-design.md.
import { PartSorterClient, grab, type ClientOptions } from './client';
import type { PartKind, ReadyInfo, Timings } from './protocol';

export const TEST_SIZES = [1280, 1024, 768];
const TIMED_RUNS = 2;

export interface SpeedRow {
  setup: string;
  size: string;
  // The first run, which includes the GPU compiling its shaders.
  firstMs: number;
  // The mean of the timed runs after it.
  prepMs: number;
  modelMs: number;
  sorterMs: number;
  totalMs: number;
  parts: number;
  grouped: number;
  unknown: number;
  groups: number;
}

export interface SpeedReport {
  when: string;
  device: Record<string, string | number | boolean | undefined>;
  setups: (ReadyInfo & { setup: string })[];
  rows: SpeedRow[];
  errors: string[];
}

export function deviceInfo() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    cores: nav.hardwareConcurrency,
    memoryGB: nav.deviceMemory,
    crossOriginIsolated: globalThis.crossOriginIsolated,
    webgpu: 'gpu' in nav,
    screen: `${screen.width}x${screen.height}@${devicePixelRatio}`
  };
}

// "downloaded 4.6 MB in 9000 ms (or: from the cache), started in 3000 ms"
export const describeLoad = (info: ReadyInfo) =>
  `${info.cached ? 'read from the cache' : `downloaded ${(info.bytes / 1e6).toFixed(1)} MB`} in ${Math.round(info.downloadMs)} ms, started in ${Math.round(info.startMs)} ms`;

const describe = (info: ReadyInfo) => (info.provider === 'webgpu' ? 'GPU' : `CPU ×${info.threads}`);

export async function runSpeedTest(kind: PartKind, photo: ImageBitmap, onProgress: (text: string) => void): Promise<SpeedReport> {
  const report: SpeedReport = { when: new Date().toISOString(), device: deviceInfo(), setups: [], rows: [], errors: [] };
  const options: ClientOptions[] = [{}, { prefer: 'wasm' }];
  if (globalThis.crossOriginIsolated && navigator.hardwareConcurrency > 1) options.push({ prefer: 'wasm', threads: 1 });

  const seen = new Set<string>();
  for (const option of options) {
    onProgress(`Loading ${option.prefer === 'wasm' ? 'the CPU' : 'the default'} setup…`);
    const client = new PartSorterClient(kind, option);
    try {
      const info = await client.whenReady();
      const setup = describe(info);
      // No GPU: the default setup is the CPU one; don't test it twice.
      if (seen.has(setup)) continue;
      seen.add(setup);
      report.setups.push({ setup, ...info });
      for (const size of TEST_SIZES) {
        onProgress(`${setup}, ${size} px…`);
        const image = () => grab(photo, photo.width, photo.height, size);
        const t0 = performance.now();
        const first = await client.run('scan', image());
        const firstMs = performance.now() - t0;
        const sum: Timings = { prepMs: 0, modelMs: 0, sorterMs: 0 };
        let last = first;
        for (let k = 0; k < TIMED_RUNS; k++) {
          last = await client.run('scan', image());
          sum.prepMs += last.timings.prepMs / TIMED_RUNS;
          sum.modelMs += last.timings.modelMs / TIMED_RUNS;
          sum.sorterMs += last.timings.sorterMs / TIMED_RUNS;
        }
        const unknown = last.result.parts.filter((p) => p.group < 0).length;
        report.rows.push({
          setup,
          size: `${last.result.width}x${last.result.height}`,
          firstMs,
          ...sum,
          totalMs: sum.prepMs + sum.modelMs + sum.sorterMs,
          parts: last.result.parts.length,
          grouped: last.result.parts.length - unknown,
          unknown,
          groups: last.result.groups.length
        });
      }
    } catch (err) {
      report.errors.push(`${JSON.stringify(option)}: ${err instanceof Error ? err.message : err}`);
    } finally {
      client.dispose();
    }
  }
  return report;
}

// Plain text, to paste into a message or an issue.
export function formatReport(report: SpeedReport) {
  const ms = (v: number) => String(Math.round(v)).padStart(6);
  const lines = [
    `Part sorter speed test, ${report.when}`,
    ...Object.entries(report.device).map(([k, v]) => `${k}: ${v}`),
    ...report.setups.map((s) => `${s.setup}: ${describeLoad(s)}${s.gpu ? `, ${s.gpu}` : ''}`),
    '',
    'setup    size        first   prep  model   sort  total  parts grouped  ?  groups'
  ];
  for (const r of report.rows) {
    lines.push(
      `${r.setup.padEnd(8)} ${r.size.padEnd(9)} ${ms(r.firstMs)} ${ms(r.prepMs)} ${ms(r.modelMs)} ${ms(r.sorterMs)} ${ms(r.totalMs)}  ${String(r.parts).padStart(5)} ${String(r.grouped).padStart(7)} ${String(r.unknown).padStart(3)} ${String(r.groups).padStart(6)}`
    );
  }
  if (report.errors.length) lines.push('', 'Errors:', ...report.errors);
  return lines.join('\n');
}
