// USB drives: copying logs onto one, and importing logs from one as soon as
// it's plugged in.
//
// Drives are looked for every few seconds. A drive seen for the first time
// (plugged in, or already in when the app starts) is looked in for logs, in
// its GreybotsDiagnostics-logs folder (this app's copies) and its logs folder
// (a roboRIO's USB stick). Files already imported from a drive, or copied to
// one from here, are remembered (usb/seen.ts) and skipped, as are logs
// already in storage (by name and size, however they got there), so only
// logs not here yet are imported. Imports go through the same
// import as Storage's (one at a time), so a drive that turns up while one is
// running is looked in again once it's done.

import { BrowserWindow, dialog, Notification, utilityProcess, type UtilityProcess } from 'electron';
import { promises as fs } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import { filesOfLogs, usbImportFolders, type UsbAutoImport, type UsbDrive, type UsbStatus, describeUsbImport, usbImportCounts, usbImportFailures } from '@shared/usb';
import { ioLog } from './io-log';
import { mergeExported, type ExportedLog, type UsbExportProgress, type UsbExportSummary } from '@shared/usb';
import { importExtensions } from './import/importer';
import { importStatus, runImport } from './import-service';
import { loadSettings } from './settings-store';
import { signalLogs } from './signals-service';
import { dataDirectory } from './storage';
import { copyLogsToDrive, exportFolderIn } from './usb/copy-to-drive';
import { usbDrives } from './usb/drives';
import { addSeen, loadSeen, seenKey, storedKey, storedLogs } from './usb/seen';
import copyFilesPath from './workers/copy-files?modulePath';

const pollMs = 3000;
const maxDepth = 8;

let drives: UsbDrive[] = [];
let exporting = false;
let exportProgress: UsbExportProgress | null = null;
let lastExport: UsbExportSummary | null = null;
let autoImport: UsbAutoImport | null = null;

// What's been copied to drives since the app opened, newest first: each
// file once per place it went (copied again, it moves to the top). For the
// Log Export page; not kept when the app closes.
let exportedLogs: ExportedLog[] = [];
export function recentExports(): ExportedLog[] {
  return [...exportedLogs];
}

// Drives already looked in since they were plugged in; forgotten when taken
// out, so plugging one in again looks again.
const lookedIn = new Set<string>();
// The drive being copied to: not imported from meanwhile.
let exportingTo = '';

export function usbStatus(): UsbStatus {
  return { drives: [...drives], exporting, progress: exportProgress, lastExport, autoImport };
}

const extensions = new Set(importExtensions);
const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
};

async function logFilesIn(folder: string, depth = 0, out: { path: string; size: number }[] = []) {
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory() && depth < maxDepth) await logFilesIn(path, depth + 1, out);
    else if (entry.isFile() && extensions.has(extensionOf(entry.name))) {
      const stat = await fs.stat(path).catch(() => null);
      if (stat) out.push({ path, size: stat.size });
    }
  }
  return out;
}

const pathOnDrive = (drive: UsbDrive, path: string) => relative(drive.root, path).split(sep).join('/');

function notify(body: string) {
  if (Notification.isSupported()) new Notification({ title: 'Greybots Diagnostics', body }).show();
}

// Imports a drive's new logs. Resolves to false when it has to wait (an
// import or a copy to it is running), to be tried again.
async function importFromDrive(drive: UsbDrive): Promise<boolean> {
  if (importStatus().running || exportingTo === drive.root) return false;
  const settings = await loadSettings();
  const directory = dataDirectory(settings);

  const found: { path: string; size: number }[] = [];
  let hasFolder = false;
  for (const name of usbImportFolders) {
    const folder = join(drive.root, name);
    if (!(await fs.stat(folder).then((s) => s.isDirectory(), () => false))) continue;
    hasFolder = true;
    await logFilesIn(folder, 0, found);
  }
  // A drive with no logs folder isn't anything to do with logs: said nothing.
  if (!hasFolder) return true;

  // Not imported: files imported from a drive before, or copied to one from
  // here, and logs already in storage however they got there.
  const seen = await loadSeen(directory);
  const stored = await storedLogs(directory);
  const unseen = found.filter((file) => !seen.has(seenKey(pathOnDrive(drive, file.path), file.size)));
  const fresh = unseen.filter((file) => !stored.has(storedKey(basename(file.path), file.size)));
  for (const file of unseen) if (!fresh.includes(file)) ioLog({ area: 'usb-import', op: 'import', outcome: 'skip', path: file.path, bytes: file.size, message: 'already here' });
  for (const file of found) if (!unseen.includes(file)) ioLog({ area: 'usb-import', op: 'import', outcome: 'skip', path: file.path, bytes: file.size, message: 'imported from (or copied to) a drive before' });
  // Those already here are remembered too, so the next look skips them sooner.
  await addSeen(directory, unseen.filter((file) => !fresh.includes(file)).map((file) => seenKey(pathOnDrive(drive, file.path), file.size)));
  const at = new Date().toISOString();
  if (fresh.length === 0) {
    autoImport = { drive: drive.label, at, state: 'nothing', message: 'No logs on it that aren\'t already here.', counts: { loaded: 0, skipped: found.length, failed: 0 } };
    return true;
  }

  autoImport = { drive: drive.label, at, state: 'importing', message: `Importing ${fresh.length} new log file${fresh.length === 1 ? '' : 's'}…` };
  const result = await runImport(fresh.map((f) => f.path), settings.teamNumber, { pathBase: drive.root, source: `USB drive ${drive.label}`, area: 'usb-import' });
  if (typeof result === 'string') {
    // Another import started first: tried again next time round.
    if (importStatus().running) return false;
    autoImport = { drive: drive.label, at: new Date().toISOString(), state: 'error', message: result };
    return true;
  }

  // Remembered unless it failed (a damaged file, or the drive pulled out
  // part way), so those are tried again next time it's plugged in.
  const sizes = new Map(fresh.map((f) => [f.path, f.size]));
  await addSeen(directory, result.files
    .filter((f) => f.outcome !== 'error' && sizes.has(f.from))
    .map((f) => seenKey(pathOnDrive(drive, f.from), sizes.get(f.from)!)));
  const message = describeUsbImport(result);
  const counts = usbImportCounts(result, found.length - fresh.length);
  // The drive gone by the end, with files not brought in: taken out part way.
  const gone = !(await fs.stat(drive.root).then(() => true, () => false));
  autoImport = { drive: drive.label, at: result.finishedAt, state: gone && counts.failed > 0 ? 'interrupted' : 'done', message, counts, failures: usbImportFailures(result) };
  notify(`From USB drive ${drive.label}: ${message}`);
  return true;
}

async function poll() {
  try {
    drives = await usbDrives();
  } catch (error) {
    console.error('Looking for USB drives:', error);
    return;
  }
  const roots = new Set(drives.map((d) => d.root));
  for (const root of [...lookedIn]) if (!roots.has(root)) lookedIn.delete(root);

  const settings = await loadSettings();
  if (!settings.usbAutoImport) return;
  for (const drive of drives) {
    if (lookedIn.has(drive.root)) continue;
    const done = await importFromDrive(drive).catch((error) => {
      autoImport = { drive: drive.label, at: new Date().toISOString(), state: 'error', message: (error as Error).message };
      return true;
    });
    if (done) lookedIn.add(drive.root);
  }
}

let started = false;
export function watchUsbDrives() {
  if (started) return;
  started = true;
  const next = () => setTimeout(() => poll().finally(next), pollMs);
  poll().finally(next);
}

// Copies the logs (by id, as the log list has them) into a
// GreybotsDiagnostics-logs folder in `destination`. Resolves when done, to
// what happened or why it didn't start.
export async function exportToUsb(logIds: string[], destination: string): Promise<UsbExportSummary | string> {
  if (exporting) return 'Logs are already being copied.';
  if (!destination) return 'Choose a drive or folder to copy to.';
  if (logIds.length === 0) return 'No logs to copy.';
  exporting = true;
  const startedAt = new Date().toISOString();
  const drive = drives.find((d) => destination === d.root || destination.startsWith(d.root));
  exportingTo = drive?.root ?? '';
  try {
    const settings = await loadSettings();
    const directory = dataDirectory(settings);
    const wanted = new Set(logIds);
    const logs = (await signalLogs(settings)).filter((log) => wanted.has(log.id));
    const copiedKeys: string[] = [];
    // Each file on the drive now, for the Log Export page's list.
    const exported: ExportedLog[] = [];
    const exportFolder = exportFolderIn(destination);
    const cancel = new AbortController();
    const copier = await startCopier();
    cancelExport = () => {
      cancel.abort();
      copier.stop();
    };
    const result = await copyLogsToDrive(directory, filesOfLogs(logs), destination,
      (progress) => { exportProgress = progress; },
      // Copied to a drive's root: known there, so plugging it in here again
      // doesn't import them back.
      (path, size) => {
        if (drive && destination === drive.root) copiedKeys.push(seenKey(path, size));
        // The path below the export folder is its path in the data folder.
        exported.push({ localPath: path.slice(path.indexOf('/') + 1), size, at: new Date().toISOString(), destination: exportFolder });
      },
      {
        signal: cancel.signal,
        copyFile: (from, to) => copier.copy(from, to),
        onIo: (entry) => ioLog({ area: 'usb-export', op: 'copy', ...entry })
      })
      .finally(() => copier.stop());
    await addSeen(directory, copiedKeys).catch(() => {});
    exportedLogs = mergeExported(exportedLogs, exported.reverse());
    lastExport = { startedAt, finishedAt: new Date().toISOString(), ...result };
    return lastExport;
  } finally {
    exporting = false;
    exportProgress = null;
    exportingTo = '';
    cancelExport = null;
  }
}

// --- Copying in a process of its own, so a cancel stops a file part way ---

interface Copier {
  copy(from: string, to: string): Promise<void>;
  stop(): void;
}

async function startCopier(): Promise<Copier> {
  const child: UtilityProcess = utilityProcess.fork(copyFilesPath, [], { serviceName: 'Greybots Diagnostics: copy logs' });
  const waiting = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  let nextId = 0;
  let ended = false;
  child.on('message', (reply: { id: number; error?: string; code?: string }) => {
    const job = waiting.get(reply.id);
    if (!job) return;
    waiting.delete(reply.id);
    if (reply.error === undefined) job.resolve();
    else job.reject(Object.assign(new Error(reply.error), { code: reply.code }));
  });
  child.on('exit', () => {
    ended = true;
    for (const job of waiting.values()) job.reject(new Error('The copy was stopped.'));
    waiting.clear();
  });
  await new Promise<void>((resolve) => child.once('spawn', () => resolve()));
  return {
    copy(from, to) {
      if (ended) return Promise.reject(new Error('The copy was stopped.'));
      const id = nextId++;
      return new Promise<void>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        child.postMessage({ id, from, to });
      });
    },
    stop() {
      if (!ended) child.kill();
    }
  };
}

let cancelExport: (() => void) | null = null;

// Stops the copy to a drive: the file being copied is stopped part way and
// removed; the ones done stay on the drive.
export function cancelUsbExport(): void {
  cancelExport?.();
}

// A folder picker, for copying somewhere that isn't listed as a drive.
export async function chooseUsbFolder(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = { title: 'Choose where to copy the logs', properties: ['openDirectory', 'createDirectory'] };
  const window = BrowserWindow.getFocusedWindow();
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
}
