// One Hoot log, read through owlet: its signals from a scan, and their
// values from exports of just the signals asked for. A whole Hoot log
// converted can be a GB (52 MB of Hoot became 1.09 GB of .wpilog), so only
// what's plotted is exported, and kept, under results/hoot/.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import { hootBus, hootBusLabel, type HootState } from '@shared/hoot';
import { LogSignalSource } from '../signals/log-source';
import { hootCompliancy, type Owlet } from './owlet';

export interface ScannedSignal {
  // As owlet's scan lists it: TalonFX-11/StatorCurrent, or RobotEnable.
  name: string;
  // owlet's signal id, for exporting it.
  id: string;
}

interface Manifest {
  // Which Hoot log, below the data folder (the folder is named by its hash).
  localPath: string;
  // The Hoot log and owlet these were made from; if either changes, they go.
  size: number;
  modified: number;
  owlet: string;
  signals: ScannedSignal[];
  pro: boolean | null;
  // Whether owlet found the end of the log cut off.
  truncated?: boolean;
  // Signal id -> the export file it's in.
  exports: Record<string, string>;
}

const cutOffMessage = 'The end of this Hoot log is cut off (the robot was likely switched off while logging); everything before that is here.';

// The name owlet gives a signal in its .wpilog: device signals under Phoenix6/.
export function exportedName(scanName: string): string {
  return scanName.includes('/') ? `Phoenix6/${scanName}` : scanName;
}

// Signals asked for within this long of each other go in one export: each
// export reads the whole Hoot log, so one for five signals beats five.
const batchMs = 250;

export class HootLog {
  readonly bus: string;
  readonly label: string;
  state: HootState = 'opening';
  message = '';
  private manifest: Manifest | null = null;
  private owletPath = '';
  private loaded = new Map<string, LogSignalSource>();
  private pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }[]>();
  private batchTimer: ReturnType<typeof setTimeout> | undefined;
  private opening: Promise<void> | null = null;

  constructor(
    private owlet: Owlet,
    readonly localPath: string,
    private path: string,
    private cacheDirectory: string,
    private onProgress: (percent: number | null, signals: number) => void
  ) {
    const name = localPath.slice(localPath.lastIndexOf('/') + 1);
    this.bus = hootBus(name);
    this.label = `Hoot ${hootBusLabel(this.bus)}`;
  }

  get signals(): ScannedSignal[] {
    return this.manifest?.signals ?? [];
  }

  get pro(): boolean | null {
    return this.manifest?.pro ?? null;
  }

  // Finds owlet for this log, and lists its signals (cached after the first
  // time). Sets `state` and `message` rather than throwing. Callers at the
  // same time share one open: two would each clear the cache folder.
  open(licenseAccepted: boolean): Promise<void> {
    this.opening ??= this.openOnce(licenseAccepted).finally(() => { this.opening = null; });
    return this.opening;
  }

  private async openOnce(licenseAccepted: boolean): Promise<void> {
    if (!licenseAccepted) {
      this.state = 'license';
      this.message = "Accept CTRE's licence in Settings to read Hoot logs.";
      return;
    }
    try {
      const compliancy = await hootCompliancy(this.path);
      if (compliancy < 6) throw new Error('This Hoot log is from before Phoenix 2024, which owlet can no longer read.');
      const owletPath = await this.owlet.pathFor(compliancy);
      if (!owletPath) {
        this.state = 'owlet';
        this.message = `This Hoot log needs owlet for compliancy ${compliancy}. Download owlet in Settings while online.`;
        return;
      }
      this.owletPath = owletPath;

      const stat = await fs.stat(this.path);
      const owletName = owletPath.slice(owletPath.search(/owlet-[^\\/]*$/));
      const saved = await this.readManifest();
      if (saved && saved.localPath === this.localPath && saved.size === stat.size && saved.modified === stat.mtimeMs && saved.owlet === owletName) {
        this.manifest = saved;
      } else {
        // New, changed, or a different owlet: start again.
        await fs.rm(this.cacheDirectory, { recursive: true, force: true });
        await fs.mkdir(this.cacheDirectory, { recursive: true });
        const signals = parseScan(await this.owlet.run(this.owletPath, [this.path, '--scan']));
        if (signals.length === 0) throw new Error('owlet found no signals in this Hoot log.');
        const pro = await this.owlet.run(this.owletPath, [this.path, '--check-pro'])
          .then((output) => !/\bnot\b/i.test(output))
          .catch(() => null);
        this.manifest = { localPath: this.localPath, size: stat.size, modified: stat.mtimeMs, owlet: owletName, signals, pro, exports: {} };
        await this.writeManifest();
      }
      this.state = 'ready';
      this.message = this.manifest.pro === false
        ? 'No Phoenix Pro device in this log, so owlet only exports some of its signals.'
        : this.manifest.truncated ? cutOffMessage : '';
    } catch (error) {
      this.state = 'error';
      this.message = (error as Error).message;
    }
  }

  // The export holding a signal, exporting it first if need be.
  async sourceFor(id: string): Promise<LogSignalSource> {
    if (this.state !== 'ready' || !this.manifest) throw new Error(this.message || "This Hoot log can't be read.");
    if (!this.manifest.exports[id]) await this.requestExport(id);
    const file = this.manifest.exports[id];
    let source = this.loaded.get(file);
    if (!source) {
      const bytes = await fs.readFile(join(this.cacheDirectory, file)).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        // Gone (deleted by hand, or a crash mid-export): export again.
        for (const [signal, name] of Object.entries(this.manifest!.exports)) if (name === file) delete this.manifest!.exports[signal];
        await this.writeManifest();
        return null;
      });
      if (!bytes) return this.sourceFor(id);
      // Hoot times as they are (seconds since the Hoot log started).
      source = new LogSignalSource(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0);
      this.loaded.set(file, source);
    }
    return source;
  }

  private requestExport(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, [...(this.pending.get(id) ?? []), { resolve, reject }]);
      clearTimeout(this.batchTimer);
      this.batchTimer = setTimeout(() => this.exportPending(), batchMs);
    });
  }

  private async exportPending() {
    const batch = new Map(this.pending);
    this.pending.clear();
    const ids = [...batch.keys()].filter((id) => !this.manifest!.exports[id]);
    const finish = (error?: Error) => {
      for (const waiters of batch.values()) for (const waiter of waiters) error ? waiter.reject(error) : waiter.resolve();
    };
    if (ids.length === 0) return finish();

    // The owlet this log was opened with was replaced by a newer one: open
    // again with it (which starts the cache afresh).
    if (!(await fs.stat(this.owletPath).catch(() => null))) {
      this.state = 'opening';
      await this.open(true);
      if ((this.state as HootState) !== 'ready') return finish(new Error(this.message));
    }

    const file = `e${Object.keys(this.manifest!.exports).length + 1}-${Date.now() % 100000}.wpilog`;
    const output = join(this.cacheDirectory, file);
    try {
      this.onProgress(0, ids.length);
      await this.owlet.run(this.owletPath, [this.path, output, '-f', 'wpilog', '-s', ids.join(',')],
        (percent) => this.onProgress(percent, ids.length)).catch(async (error: Error) => {
        // A Hoot log cut off at the end (the robot switched off while
        // logging) makes owlet fail after it's written everything before
        // that. What it wrote is used.
        const written = await fs.stat(output).catch(() => null);
        if (!written || written.size === 0 || !/read to end of input/i.test(error.message)) throw error;
        this.message = cutOffMessage;
        this.manifest!.truncated = true;
      });
      for (const id of ids) this.manifest!.exports[id] = file;
      await this.writeManifest();
      finish();
    } catch (error) {
      finish(new Error(`owlet couldn't export from ${this.label}: ${(error as Error).message}`));
    } finally {
      this.onProgress(null, 0);
    }
  }

  private async readManifest(): Promise<Manifest | null> {
    try {
      return JSON.parse(await fs.readFile(join(this.cacheDirectory, 'manifest.json'), 'utf-8')) as Manifest;
    } catch {
      return null;
    }
  }

  private async writeManifest() {
    const path = join(this.cacheDirectory, 'manifest.json');
    await fs.writeFile(`${path}.tmp`, JSON.stringify(this.manifest), 'utf-8');
    await fs.rename(`${path}.tmp`, path);
  }
}

// owlet --scan prints one signal a line: `TalonFX-11/StatorCurrent:   6f30b00`.
export function parseScan(output: string): ScannedSignal[] {
  const signals: ScannedSignal[] = [];
  for (const line of output.split(/\r?\n/)) {
    const found = /^(\S.*?):\s+([0-9a-f]+)\s*$/i.exec(line);
    if (found) signals.push({ name: found[1], id: found[2] });
  }
  return signals;
}
