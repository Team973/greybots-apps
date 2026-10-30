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
// and a big one is tens of MB.
let open: { localPath: string; source: LogSignalSource } | null = null;

// The offloaded WPILib data logs, newest first.
export async function signalLogs(settings: Settings): Promise<SignalLogFile[]> {
  const index = await loadIndex(dataDirectory(settings));
  const files = Object.values(index.files)
    .filter((file) => file.localPath.endsWith('.wpilog'))
    .map((file) => {
      const name = file.localPath.slice(file.localPath.lastIndexOf('/') + 1);
      const parsed = parseLogName(name);
      return {
        localPath: file.localPath,
        name,
        robot: file.robot,
        size: file.size,
        recorded: (parsed.recorded ?? new Date(file.modified)).toISOString(),
        match: file.match ?? parsed.match
      };
    });
  files.sort((a, b) => b.recorded.localeCompare(a.recorded));
  return files;
}

async function openSource(settings: Settings, localPath: string): Promise<LogSignalSource> {
  if (open?.localPath === localPath) return open.source;

  // Only files the offload put there: the window names the file, and it
  // mustn't be able to have any file on the computer read.
  const known = (await signalLogs(settings)).some((file) => file.localPath === localPath);
  if (!known) throw new Error('That log is not in the data folder.');

  const bytes = await fs.readFile(join(dataDirectory(settings), ...localPath.split('/')));
  open = null;
  const source = new LogSignalSource(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  open = { localPath, source };
  return source;
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
    groups: groupSignals(signals)
  };
}

export async function readSignal(settings: Settings, localPath: string, key: string, range: SignalRange): Promise<SignalSeries | null> {
  return (await openSource(settings, localPath)).read(key, range);
}
