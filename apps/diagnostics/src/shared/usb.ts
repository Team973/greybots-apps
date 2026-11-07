// Logs to and from USB drives: copying a chosen set of logs onto a drive to
// carry to another computer, and importing logs from a drive as soon as it's
// plugged in. Used by both sides, so nothing here may touch Node or the DOM.

import type { SignalLogFile } from './ipc';
import type { ImportSummary } from './import';
import type { MatchType } from './offload';

// The folder logs are copied into on a drive, keeping the data folder's
// layout below it (logs/frc973/<day>/<source>/<file>), so an import files
// each log under the right team and day again.
export const usbExportFolder = 'GreybotsDiagnostics-logs';

// Where on a plugged-in drive logs are looked for: this app's copies, and
// logs/, where a roboRIO (and CTRE's signal logger) write to a USB stick.
export const usbImportFolders = [usbExportFolder, 'logs'];

// What kind of run a log is: a match on the field (FMS named it), or not
// (pit, test or practice-field runs).
export type RunKind = MatchType | 'none';

export const runKinds: { kind: RunKind; label: string }[] = [
  { kind: 'practice', label: 'Practice matches' },
  { kind: 'qualification', label: 'Qualification matches' },
  { kind: 'elimination', label: 'Playoff matches' },
  { kind: 'none', label: 'Not a match (pit, test)' }
];

export interface UsbExportFilter {
  // An FMS event code (MTTD), or null for every event, and for logs that
  // aren't from a match.
  event: string | null;
  // The kinds of run to take; empty takes none.
  kinds: RunKind[];
  // Only logs recorded in the last this many days; 0 for any age.
  days: number;
}

export const defaultUsbExportFilter: UsbExportFilter = {
  event: null,
  kinds: runKinds.map((r) => r.kind),
  days: 0
};

const dayMs = 24 * 60 * 60 * 1000;

export function logsToExport(logs: SignalLogFile[], filter: UsbExportFilter, now = new Date()): SignalLogFile[] {
  const kinds = new Set(filter.kinds);
  const oldest = filter.days > 0 ? now.getTime() - filter.days * dayMs : -Infinity;
  return logs.filter((log) => {
    if (filter.event && log.match?.event.toUpperCase() !== filter.event.toUpperCase()) return false;
    if (!kinds.has(log.match?.type ?? 'none')) return false;
    const recorded = Date.parse(log.recorded);
    return Number.isNaN(recorded) || recorded >= oldest;
  });
}

// Every file of the logs (data folder paths), once each: a session's data
// log, Hoot logs, and Driver Station logs and events (one Driver Station log
// can belong to several sessions).
export function filesOfLogs(logs: SignalLogFile[]): string[] {
  const files = logs.flatMap((log) => [
    log.localPath,
    ...log.hoots.map((hoot) => hoot.localPath),
    ...log.dsLogs.flatMap((ds) => [ds.localPath, ds.eventsPath])
  ]);
  return [...new Set(files.filter((path): path is string => !!path))];
}

// A drive that can be copied to, or imported from.
export interface UsbDrive {
  // Where it's mounted: E:\ on Windows, /Volumes/NAME on macOS.
  root: string;
  // For people: "E: (KINGSTON)".
  label: string;
}

export interface UsbExportProgress {
  filesDone: number;
  filesTotal: number;
  // Files done, and part of the one being copied, estimated (it can't be
  // told how far a file's got).
  bytesDone: number;
  bytesTotal: number;
  // Bytes of files done copying (not those already there), and since when
  // (ISO): the speed, measured, not estimated. Null before any are copied.
  bytesCopied: number;
  copyingSince: string | null;
  // The file being copied.
  current: string;
}

export interface UsbExportSummary {
  startedAt: string;
  finishedAt: string;
  // The folder the logs went in.
  destination: string;
  copied: number;
  // Already on the drive, the same size.
  skipped: number;
  bytes: number;
  failed: { path: string; message: string }[];
  // Why it stopped early (the drive filled up, was pulled out), or ''.
  problem: string;
  // Stopped by the person; the files done are on the drive.
  cancelled: boolean;
}

export interface UsbAutoImport {
  drive: string;
  at: string;
  // 'importing' while it runs; 'nothing' when the drive had no new logs.
  state: 'importing' | 'done' | 'nothing' | 'error';
  message: string;
}

export interface UsbStatus {
  drives: UsbDrive[];
  exporting: boolean;
  progress: UsbExportProgress | null;
  lastExport: UsbExportSummary | null;
  // The latest import from a plugged-in drive.
  autoImport: UsbAutoImport | null;
}

// A drive's import, in a sentence.
export function describeUsbImport(summary: ImportSummary): string {
  const copied = summary.files.filter((f) => f.outcome === 'copied').length;
  const failed = summary.files.filter((f) => f.outcome === 'conflict' || f.outcome === 'error').length;
  const logs = (n: number) => `${n} log file${n === 1 ? '' : 's'}`;
  return `${logs(copied)} imported${failed ? `, ${failed} not imported` : ''}.`;
}
