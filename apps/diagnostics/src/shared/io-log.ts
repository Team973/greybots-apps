// The transfer log: one line for every file operation while logs move in
// or out (each file downloaded from the robot, imported, copied to a drive
// or zipped, and each one skipped or failed, with why), and the steps
// around them (logging in to the robot, pausing its code). Shown on the
// Debug page, newest first, and kept in a file to tail.
//
// Nothing here may touch Node or the DOM.

export type IoArea = 'robot' | 'driver-station' | 'usb-import' | 'import' | 'usb-export' | 'zip';

export const ioAreaLabels: Record<IoArea, string> = {
  robot: 'Download from bot',
  'driver-station': 'Driver Station logs',
  'usb-import': 'USB import',
  import: 'Import',
  'usb-export': 'USB export',
  zip: 'Event zip'
};

// What happened: done, nothing to do (here already, too old), or failed.
export type IoOutcome = 'ok' | 'skip' | 'fail';

export interface IoLogEntry {
  // Counts up from 1 while the app runs, so the page asks for what's new.
  seq: number;
  at: string;
  area: IoArea;
  // What was done: 'download', 'copy', 'import', 'connect', 'pause', ...
  op: string;
  outcome: IoOutcome;
  // The file (or host) it was done to.
  path?: string;
  bytes?: number;
  ms?: number;
  // Why it was skipped or failed, or more about it.
  message?: string;
}

export type IoLogInput = Omit<IoLogEntry, 'seq' | 'at'>;

// One line of the log file: tab-separated, so it reads in a terminal.
export function ioLogLine(entry: IoLogEntry): string {
  return [
    entry.at,
    entry.area,
    entry.op,
    entry.outcome.toUpperCase(),
    entry.path ?? '',
    entry.bytes === undefined ? '' : `${entry.bytes} B`,
    entry.ms === undefined ? '' : `${Math.round(entry.ms)} ms`,
    (entry.message ?? '').replace(/\s+/g, ' ')
  ].join('\t');
}

export interface IoLogFilter {
  area: IoArea | null;
  // Failed only, or failed and skipped.
  outcomes: IoOutcome[] | null;
  text: string;
}

export function filterIoLog(entries: IoLogEntry[], filter: IoLogFilter): IoLogEntry[] {
  const text = filter.text.trim().toLowerCase();
  const outcomes = filter.outcomes ? new Set(filter.outcomes) : null;
  return entries.filter((entry) => (!filter.area || entry.area === filter.area) &&
    (!outcomes || outcomes.has(entry.outcome)) &&
    (!text || [entry.op, entry.path ?? '', entry.message ?? ''].some((part) => part.toLowerCase().includes(text))));
}

export interface IoLogPage {
  entries: IoLogEntry[];
  // The newest seq there is, to ask after next time.
  latest: number;
  // Where the log file is.
  file: string;
}
