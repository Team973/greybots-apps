// Zipping an event's logs (event-zip.ts says which) into one file, where the
// person picks. Written beside it as .part and renamed once done, so a zip
// cancelled or cut short doesn't look whole. One at a time.

import { app, BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import {
  eventZipEntryName,
  eventZipFiles,
  eventZipName,
  logsForEventZip,
  type EventZipOptions,
  type EventZipProgress,
  type EventZipStatus,
  type EventZipSummary
} from '@shared/event-zip';
import { runKinds } from '@shared/usb';
import { writeZip } from './export/zip-writer';
import { loadSettings } from './settings-store';
import { signalLogs } from './signals-service';
import { dataDirectory } from './storage';

let running = false;
let progress: EventZipProgress | null = null;
let last: EventZipSummary | null = null;
let cancel: AbortController | null = null;

export function eventZipStatus(): EventZipStatus {
  return { running, progress, last };
}

export function cancelEventZip(): void {
  cancel?.abort();
}

// What came from the page, checked.
function cleanOptions(raw: Partial<EventZipOptions> | null | undefined): EventZipOptions {
  const known = new Set<string>(runKinds.map((r) => r.kind));
  return {
    event: String(raw?.event ?? '').trim(),
    robot: typeof raw?.robot === 'string' && raw.robot.trim() ? raw.robot.trim() : null,
    kinds: Array.isArray(raw?.kinds) ? raw.kinds.filter((k) => known.has(String(k))) : [],
    hoots: raw?.hoots !== false,
    driverStation: raw?.driverStation !== false
  };
}

// Asks where to save it, then writes it. Resolves to how it went, a reason
// it didn't start, or null if the person cancelled the save dialog.
export async function saveEventZip(raw: Partial<EventZipOptions>): Promise<EventZipSummary | string | null> {
  if (running) return 'A zip is already being made.';
  const options = cleanOptions(raw);
  if (!options.event) return 'Choose an event.';
  const settings = await loadSettings();
  const directory = dataDirectory(settings);
  const files = eventZipFiles(logsForEventZip(await signalLogs(settings), options), options);
  if (files.length === 0) return 'No logs to zip.';

  const window = BrowserWindow.getFocusedWindow();
  const dialogOptions: Electron.SaveDialogOptions = {
    title: `Save ${options.event}'s logs`,
    defaultPath: join(app.getPath('downloads'), eventZipName(options.event, options.robot)),
    filters: [{ name: 'Zip files', extensions: ['zip'] }]
  };
  const chosen = window ? await dialog.showSaveDialog(window, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
  if (chosen.canceled || !chosen.filePath) return null;
  const path = /\.zip$/i.test(chosen.filePath) ? chosen.filePath : `${chosen.filePath}.zip`;
  return zipTo(path, directory, files.map((file) => file.path), options);
}

async function zipTo(path: string, directory: string, files: string[], options: EventZipOptions): Promise<EventZipSummary> {
  running = true;
  cancel = new AbortController();
  const part = `${path}.part`;
  const sizes = await Promise.all(files.map((file) => fs.stat(join(directory, file)).then((s) => s.size, () => 0)));
  const bytesTotal = sizes.reduce((a, b) => a + b, 0);
  progress = { filesDone: 0, filesTotal: files.length, bytesDone: 0, bytesTotal, current: '' };
  const inputs = files.map((file) => ({ from: join(directory, ...file.split('/')), name: eventZipEntryName(options.event, options.robot, file) }));
  const fromPath = new Map(inputs.map((input, i) => [input.from, files[i]]));
  try {
    const result = await writeZip(part, inputs, {
      signal: cancel.signal,
      onProgress: (p) => { progress = { ...p, filesTotal: files.length, bytesTotal }; }
    });
    await fs.rename(part, path);
    last = {
      path,
      files: result.files,
      bytesIn: result.bytesIn,
      bytesOut: result.bytesOut,
      finishedAt: new Date().toISOString(),
      cancelled: false,
      missing: result.missing.map((from) => fromPath.get(from) ?? from)
    };
  } catch (error) {
    await fs.rm(part, { force: true }).catch(() => {});
    const cancelled = cancel.signal.aborted;
    last = {
      path,
      files: 0,
      bytesIn: progress?.bytesDone ?? 0,
      bytesOut: 0,
      finishedAt: new Date().toISOString(),
      cancelled,
      problem: cancelled ? undefined : (error as Error).message,
      missing: []
    };
  } finally {
    running = false;
    progress = null;
    cancel = null;
  }
  return last;
}
