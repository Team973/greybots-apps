// Copying logs onto a USB drive (or any folder): each file to the same place
// below a GreybotsDiagnostics-logs folder as it has below the data folder, so
// importing the folder on another computer files each log where it was. A
// file already there at the same size is left alone, so copying again only
// adds what's new. Each file is written beside its place and renamed into it
// when whole, so a drive pulled out mid-copy leaves no half logs behind, and
// keeps its last-changed time, which an import falls back on for its day.

import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { formatBytes } from '@shared/bytes';
import { usbExportFolder, type UsbExportProgress, type UsbExportSummary } from '@shared/usb';

export const exportReadme = `Logs copied from Greybots Diagnostics.

Plug this drive into a computer running Greybots Diagnostics and they're
imported on their own (or import this folder on its Storage page). Each log
is filed under its team, day and kind there, as it was here; logs already
there are skipped.

Don't rename or edit the files inside it.
`;

// The folder logs go in: the chosen one's GreybotsDiagnostics-logs, unless
// that's the one chosen.
export function exportFolderIn(destination: string): string {
  return basename(destination) === usbExportFolder ? destination : join(destination, usbExportFolder);
}

type Result = Omit<UsbExportSummary, 'startedAt' | 'finishedAt'>;

const exists = (path: string) => fs.access(path).then(() => true, () => false);

// Each file is copied by the system's own file copy (CopyFile on Windows,
// what Explorer uses), which is as fast as the drive allows: it sizes the
// file once and writes in big pieces, where writing it ourselves to a USB
// drive (which Windows writes to without caching, so it can be pulled out)
// slowed to a crawl. It doesn't say how far it's got, so while a file is
// copied its progress is estimated at the speed so far, never past its end,
// and made true when it's done. The speed people are shown is only ever
// from files done (bytesCopied over the time since copyingSince).

// Before anything's been copied, a guess at a USB drive's speed.
const guessBytesPerSecond = 20 * 1024 * 1024;
const estimateEveryMs = 250;

export function estimateFileBytes(elapsedMs: number, bytesPerSecond: number, size: number): number {
  return Math.max(0, Math.min(Math.floor(size * 0.99), Math.floor((elapsedMs / 1000) * bytesPerSecond)));
}

export interface CopyOptions {
  // Cancels the copy: the file being copied is stopped (if `copyFile` can be)
  // and its part removed; files done stay.
  signal?: AbortSignal;
  // How one file is copied; the app's runs in a process of its own, so a
  // cancel stops it part way (usb-service.ts). Rejects when cancelled.
  copyFile?: (from: string, to: string) => Promise<void>;
}

export async function copyLogsToDrive(
  dataDirectory: string,
  files: string[],
  destination: string,
  onProgress: (progress: UsbExportProgress) => void,
  // Each file once copied (or found already there): its path below the
  // drive's export folder's parent, and its size.
  onFile: (pathFromDestination: string, size: number) => void = () => {},
  options: CopyOptions = {}
): Promise<Result> {
  const { signal } = options;
  const copyOne = options.copyFile ?? ((from: string, to: string) => fs.copyFile(from, to));
  const folder = exportFolderIn(destination);
  const result: Result = { destination: folder, copied: 0, skipped: 0, bytes: 0, failed: [], problem: '', cancelled: false };

  const sources: { path: string; size: number; modified: Date }[] = [];
  for (const path of files) {
    const stat = await fs.stat(join(dataDirectory, ...path.split('/'))).catch(() => null);
    if (stat?.isFile()) sources.push({ path, size: stat.size, modified: stat.mtime });
    else result.failed.push({ path, message: 'Not in the data folder any more.' });
  }

  const progress: UsbExportProgress = {
    filesDone: 0,
    filesTotal: sources.length,
    bytesDone: 0,
    bytesTotal: sources.reduce((total, s) => total + s.size, 0),
    bytesCopied: 0,
    copyingSince: null,
    current: ''
  };
  onProgress({ ...progress });

  try {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(join(folder, 'README.txt'), exportReadme, 'utf-8');
  } catch (error) {
    result.problem = `Can't write to ${destination}: ${(error as Error).message}`;
    return result;
  }

  // Said up front rather than part way through, when it can be told.
  const free = await fs.statfs(folder).then((s) => s.bavail * s.bsize, () => null);
  const needed = await (async () => {
    let total = 0;
    for (const source of sources) {
      const there = await fs.stat(join(folder, ...source.path.split('/'))).catch(() => null);
      if (there?.size !== source.size) total += source.size;
    }
    return total;
  })();
  if (free !== null && needed > free) {
    result.problem = `Not enough room on the drive: the logs need ${formatBytes(needed)} and it has ${formatBytes(free)} free.`;
    return result;
  }

  const prefix = basename(folder);
  // Smallest first: a file done is what the speed is measured from, so a
  // big Hoot log first would leave it unknown for minutes.
  sources.sort((a, b) => a.size - b.size);
  for (const source of sources) {
    if (signal?.aborted) {
      result.cancelled = true;
      break;
    }
    progress.current = source.path;
    onProgress({ ...progress });
    const target = join(folder, ...source.path.split('/'));
    try {
      const there = await fs.stat(target).catch(() => null);
      if (there?.size === source.size) {
        result.skipped += 1;
      } else {
        await fs.mkdir(dirname(target), { recursive: true });
        const part = `${target}.part`;
        try {
          progress.copyingSince ??= new Date().toISOString();
          const started = Date.now();
          const since = Date.parse(progress.copyingSince);
          const speed = progress.bytesCopied > 0 && started > since ? (progress.bytesCopied / (started - since)) * 1000 : guessBytesPerSecond;
          const estimating = setInterval(() => {
            onProgress({ ...progress, bytesDone: progress.bytesDone + estimateFileBytes(Date.now() - started, speed, source.size) });
          }, estimateEveryMs);
          try {
            await copyOne(join(dataDirectory, ...source.path.split('/')), part);
            if (signal?.aborted) throw new Error('Cancelled.');
          } finally {
            clearInterval(estimating);
          }
          await fs.utimes(part, source.modified, source.modified);
          await fs.rm(target, { force: true });
          await fs.rename(part, target);
        } catch (error) {
          // A copy just stopped can hold the file for a moment.
          await fs.rm(part, { force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
          throw error;
        }
        result.copied += 1;
        result.bytes += source.size;
        progress.bytesCopied += source.size;
      }
      onFile(`${prefix}/${source.path}`, source.size);
    } catch (error) {
      if (signal?.aborted) {
        result.cancelled = true;
        break;
      }
      // The drive full, or gone (taken out), stops the copy; anything else
      // is just this file.
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
        result.problem = 'The drive is full.';
        break;
      }
      if (!(await exists(folder))) {
        result.problem = `The drive stopped taking files (${(error as Error).message}). Was it taken out?`;
        break;
      }
      result.failed.push({ path: source.path, message: (error as Error).message });
    }
    progress.filesDone += 1;
    progress.bytesDone += source.size;
    onProgress({ ...progress });
  }
  return result;
}
