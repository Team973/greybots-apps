// The transfer log (shared/io-log.ts): kept in memory for the Debug page
// (the latest few thousand lines) and appended to io.log in the app's logs
// folder, to tail while a transfer runs. The file starts again (the old one
// kept as io.1.log) once it passes a size.

import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import { ioLogLine, type IoLogEntry, type IoLogInput, type IoLogPage } from '@shared/io-log';

const keep = 5000;
const maxFileBytes = 10 * 1024 * 1024;

const entries: IoLogEntry[] = [];
let seq = 0;
let pending: string[] = [];
let writing: Promise<void> | null = null;
let fileBytes: number | null = null;

export const ioLogFile = () => join(app.getPath('logs'), 'io.log');

export function ioLog(input: IoLogInput): void {
  const entry: IoLogEntry = { seq: ++seq, at: new Date().toISOString(), ...input };
  entries.push(entry);
  if (entries.length > keep) entries.splice(0, entries.length - keep);
  pending.push(`${ioLogLine(entry)}\n`);
  writing ??= flush();
}

// Appends what's waiting, a batch at a time, so a burst of lines is one write.
async function flush(): Promise<void> {
  try {
    const file = ioLogFile();
    while (pending.length) {
      const text = pending.join('');
      pending = [];
      if (fileBytes === null) {
        await fs.mkdir(app.getPath('logs'), { recursive: true });
        fileBytes = await fs.stat(file).then((s) => s.size, () => 0);
      }
      if (fileBytes > maxFileBytes) {
        await fs.rename(file, join(app.getPath('logs'), 'io.1.log')).catch(() => {});
        fileBytes = 0;
      }
      await fs.appendFile(file, text);
      fileBytes += Buffer.byteLength(text);
    }
  } catch (error) {
    // The log is a help, never a reason for a transfer to fail.
    console.error('Writing the transfer log:', error);
    pending = [];
  } finally {
    writing = null;
  }
}

// Lines after `after` (all kept, from 0), oldest first.
export function ioLogSince(after: number): IoLogPage {
  const start = entries.findIndex((entry) => entry.seq > after);
  return { entries: start === -1 ? [] : entries.slice(start), latest: seq, file: ioLogFile() };
}

// A timer for an operation: ioLog it once it's done, with how long it took.
export function ioTimer(): () => number {
  const start = performance.now();
  return () => performance.now() - start;
}
