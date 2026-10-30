import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import type { SignalLogFile, SignalLogSummary } from '@shared/ipc';
import { parseLogName } from '@shared/offload';
import type { Settings } from '@shared/settings';
import { groupSignals, type SignalRange, type SignalSeries } from '@shared/signals';
import { loadIndex } from './offload/offload-index';
import { LogSignalSource } from './signals/log-source';
import { dataDirectory } from './storage';

// The log open for reading. One at a time: a log is held in memory whole,
// and a big one is tens of MB. `version` notices a file replaced since.
let open: { localPath: string; version: string; source: LogSignalSource } | null = null;

// How deep under logs/ to look: logs/<robot>/<day>/<source>/<file>, and a
// little more for files put there by hand.
const maxDepth = 6;

async function findLogs(directory: string, relative: string[], depth: number): Promise<{ path: string[]; size: number; modified: Date }[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: { path: string[]; size: number; modified: Date }[] = [];
  for (const entry of entries) {
    const path = [...relative, entry.name];
    if (entry.isDirectory() && depth < maxDepth) {
      found.push(...(await findLogs(join(directory, entry.name), path, depth + 1)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.wpilog')) {
      const stat = await fs.stat(join(directory, entry.name)).catch(() => null);
      if (stat) found.push({ path, size: stat.size, modified: stat.mtime });
    }
  }
  return found;
}

// Every WPILib data log in the data folder's logs/, newest first: those the
// offload pulled, and any put there by hand. The offload index adds what it
// knows (the match); the rest comes from the file's name and times.
export async function signalLogs(settings: Settings): Promise<SignalLogFile[]> {
  const directory = dataDirectory(settings);
  const index = await loadIndex(directory);
  const offloaded = new Map(Object.values(index.files).map((file) => [file.localPath, file]));

  const files = (await findLogs(join(directory, 'logs'), ['logs'], 0)).map(({ path, size, modified }) => {
    const localPath = path.join('/');
    const name = path[path.length - 1];
    const parsed = parseLogName(name);
    const known = offloaded.get(localPath);
    return {
      localPath,
      name,
      // logs/<robot>/..., or '' for a file right in logs/.
      robot: known?.robot ?? (path.length > 2 ? path[1] : ''),
      size,
      recorded: (parsed.recorded ?? (known ? new Date(known.modified) : modified)).toISOString(),
      match: known?.match ?? parsed.match
    };
  });
  files.sort((a, b) => b.recorded.localeCompare(a.recorded));
  return files;
}

async function openSource(settings: Settings, localPath: string): Promise<LogSignalSource> {
  const path = join(dataDirectory(settings), ...localPath.split('/'));
  const version = async () => {
    const stat = await fs.stat(path);
    return `${stat.size}:${stat.mtimeMs}`;
  };

  // The log already open, unchanged: every read while zooming lands here.
  if (open?.localPath === localPath && open.version === (await version().catch(() => ''))) return open.source;

  // Only data logs in the data folder: the window names the file, and it
  // mustn't be able to have any file on the computer read.
  const file = (await signalLogs(settings)).find((log) => log.localPath === localPath);
  if (!file) throw new Error('That log is not in the data folder.');

  const bytes = await fs.readFile(path);
  open = null;
  const source = new LogSignalSource(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  open = { localPath, version: await version(), source };
  return source;
}

// DogLog queues values for a background thread to write. When the queue is
// full, new values are dropped, and DogLog logs how full it is: each time
// its free space reached 0 is a stretch where values are missing.
function dogLogWarnings(source: LogSignalSource): string[] {
  const key = source.catalog().find((s) => s.key.endsWith('DogLog/QueueRemainingCapacity'))?.key;
  const free = key ? source.read(key) : null;
  if (!free || !free.stats) return [];
  const values = free.values as Float64Array;
  let times = 0;
  for (let i = 0; i < values.length; i++) if (values[i] === 0 && (i === 0 || values[i - 1] !== 0)) times += 1;
  if (times === 0) return [];
  return [
    `DogLog's queue filled up ${times === 1 ? 'once' : `${times} times`} (it holds ${free.stats.max}), so some values were dropped then. ` +
      "A bigger logEntryQueueCapacity in the robot code's DogLogOptions stops this."
  ];
}

export async function openSignalLog(settings: Settings, localPath: string): Promise<SignalLogSummary> {
  const source = await openSource(settings, localPath);
  const signals = source.catalog();
  return {
    localPath,
    duration: source.lastTime - source.firstTime,
    startedAt: source.startedAt,
    truncated: source.truncated,
    signals,
    groups: groupSignals(signals),
    warnings: dogLogWarnings(source)
  };
}

export async function readSignal(settings: Settings, localPath: string, key: string, range: SignalRange): Promise<SignalSeries | null> {
  return (await openSource(settings, localPath)).read(key, range);
}
