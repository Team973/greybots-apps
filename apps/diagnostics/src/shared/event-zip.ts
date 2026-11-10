// An event's logs in one zip file, to hand to a teammate or keep: by default
// one team's official field matches at the event (practice, qualification
// and playoff), each with its Hoot logs and Driver Station logs. What goes
// in can be changed: the team (or every team's), which kinds of match, logs not from a match recorded on the
// event's days (pit, practice field), and whether Hoot and Driver Station
// logs go in.
//
// In the zip, files keep their place in the data folder below one folder
// named for the zip (MTTD-frc973-logs/frc973/2026-11-07/roborio/...), so the zip
// imports back (Log Import) to the same team and day.
//
// Nothing here may touch Node or the DOM.

import type { SignalLogFile } from './ipc';
import type { RunKind } from './usb';

export interface EventZipOptions {
  // The FMS event code (MTTD).
  event: string;
  // The robot's folder (frc973), or null for every team's.
  robot: string | null;
  // The kinds of run to take; 'none' is logs not from a match recorded on
  // the event's days.
  kinds: RunKind[];
  hoots: boolean;
  driverStation: boolean;
}

// The official field matches.
export const defaultEventZipKinds: RunKind[] = ['practice', 'qualification', 'elimination'];

export const defaultEventZipOptions = (event: string, robot: string | null = null): EventZipOptions => ({
  event,
  robot,
  kinds: [...defaultEventZipKinds],
  hoots: true,
  driverStation: true
});

const sameEvent = (log: SignalLogFile, event: string) => log.match?.event.toUpperCase() === event.toUpperCase();
const dayMs = 24 * 60 * 60 * 1000;
// Midnight that began a time's day, in this computer's time zone.
const dayStart = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

// The event's days, from the first day one of its matches was recorded to
// the end of the last: [start, end) in ms. Null with no match recorded.
export function eventDays(logs: SignalLogFile[], event: string): [number, number] | null {
  const times = logs.filter((log) => sameEvent(log, event)).map((log) => Date.parse(log.recorded)).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return null;
  const last = dayStart(Math.max(...times));
  // The next midnight: a day isn't always 24 hours (daylight saving).
  return [dayStart(Math.min(...times)), dayStart(last + dayMs * 1.5)];
}

// The logs that go in, oldest first. The event's days are every team's.
export function logsForEventZip(logs: SignalLogFile[], options: EventZipOptions): SignalLogFile[] {
  const kinds = new Set(options.kinds);
  const days = kinds.has('none') ? eventDays(logs, options.event) : null;
  return logs
    .filter((log) => {
      if (options.robot && log.robot !== options.robot) return false;
      if (log.match) return sameEvent(log, options.event) && kinds.has(log.match.type);
      if (!days) return false;
      const recorded = Date.parse(log.recorded);
      return recorded >= days[0] && recorded < days[1];
    })
    .sort((a, b) => Date.parse(a.recorded) - Date.parse(b.recorded));
}

export interface EventZipFile {
  // Below the data folder, with / between folders.
  path: string;
  size: number;
}

// Every file of those logs, once each (a Driver Station log can be shared by
// two): the data log, then its Hoot logs and Driver Station logs if wanted.
// A data log's size is the session's less its other files'.
export function eventZipFiles(logs: SignalLogFile[], options: Pick<EventZipOptions, 'hoots' | 'driverStation'>): EventZipFile[] {
  const files = new Map<string, number>();
  for (const log of logs) {
    const hootBytes = log.hoots.reduce((total, hoot) => total + hoot.size, 0);
    const dsBytes = log.dsLogs.reduce((total, ds) => total + ds.size, 0);
    if (log.localPath) files.set(log.localPath, Math.max(0, log.size - hootBytes - dsBytes));
    if (options.hoots) for (const hoot of log.hoots) files.set(hoot.localPath, hoot.size);
    if (options.driverStation) {
      for (const ds of log.dsLogs) {
        files.set(ds.localPath, ds.size);
        if (ds.eventsPath && !files.has(ds.eventsPath)) files.set(ds.eventsPath, 0);
      }
    }
  }
  return [...files].map(([path, size]) => ({ path, size }));
}

// The zip's name, and the folder in it that holds the logs: the event's,
// and the team's when it's one team's (MTTD-frc973-logs).
const safe = (text: string) => text.replace(/[^A-Za-z0-9_-]/g, '');
export const eventZipFolder = (event: string, robot: string | null = null) =>
  [safe(event.toUpperCase()) || 'event', ...(robot && safe(robot) ? [safe(robot)] : []), 'logs'].join('-');
export const eventZipName = (event: string, robot: string | null = null) => `${eventZipFolder(event, robot)}.zip`;

// Where a data folder file goes in the zip: below the zip's folder, without
// the data folder's logs/ (MTTD-frc973-logs/frc973/2026-11-07/roborio/a.wpilog).
export function eventZipEntryName(event: string, robot: string | null, path: string): string {
  const parts = path.split('/').filter((part) => part && part !== '.' && part !== '..');
  if (parts[0] === 'logs') parts.shift();
  return [eventZipFolder(event, robot), ...parts].join('/');
}

// How a zip went.
export interface EventZipProgress {
  filesDone: number;
  filesTotal: number;
  // Bytes read from the logs so far, of all of them.
  bytesDone: number;
  bytesTotal: number;
  current: string;
}

export interface EventZipSummary {
  path: string;
  files: number;
  // The logs' bytes, and the zip's.
  bytesIn: number;
  bytesOut: number;
  finishedAt: string;
  cancelled: boolean;
  // Why it stopped, if it didn't finish.
  problem?: string;
  // Files that couldn't be read (gone since the list was made): left out.
  missing: string[];
}

export interface EventZipStatus {
  running: boolean;
  progress: EventZipProgress | null;
  last: EventZipSummary | null;
}
