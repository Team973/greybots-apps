// Narrowing the list of logs to pick from (Signals' log picker), and what
// deleting a log removes. Shared by the window and the main process.

import type { SignalLogFile } from './ipc';

export interface LogFilter {
  // An FMS event code (as in a log's name, e.g. MTTD), or null for all.
  event: string | null;
  // Only logs from a match on the field (practice, qualification or
  // playoff): ones FMS named. Pit, test and practice-field runs aren't.
  realMatches: boolean;
  // One robot's (team's) logs, frc973, or null for every robot's. Left out
  // by filters saved before there was one: every robot's.
  robot?: string | null;
}

export const noLogFilter: LogFilter = { event: null, realMatches: false, robot: null };

const sameEvent = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

export function filterLogs(logs: SignalLogFile[], filter: LogFilter): SignalLogFile[] {
  return logs.filter((log) => {
    if (filter.robot && log.robot !== filter.robot) return false;
    if ((filter.realMatches || filter.event) && !log.match) return false;
    if (filter.event && !sameEvent(log.match!.event, filter.event)) return false;
    return true;
  });
}

// The robots (teams) the logs are of: teams by number, then any other name.
export function robotsIn(logs: { robot: string }[]): string[] {
  const team = (robot: string) => Number(/^frc(\d+)$/i.exec(robot)?.[1] ?? Infinity);
  return [...new Set(logs.map((log) => log.robot).filter(Boolean))].sort((a, b) => team(a) - team(b) || (team(a) === Infinity ? a.localeCompare(b) : 0));
}

// A robot as people say it: frc973 is Team 973.
export function robotLabel(robot: string): string {
  const team = /^frc(\d+)$/i.exec(robot);
  return team ? `Team ${team[1]}` : robot;
}

// The events the logs are from, upper-cased, in order.
export function eventsIn(logs: SignalLogFile[]): string[] {
  return [...new Set(logs.map((log) => log.match?.event.toUpperCase()).filter((event): event is string => !!event))].sort();
}

// The files deleting a log removes (data folder paths): its data log, Hoot
// logs and Driver Station logs. A Driver Station log another log also has
// (one Driver Station log can span several robot logs) is kept for it.
export function filesToDelete(log: SignalLogFile, all: SignalLogFile[]): { remove: string[]; kept: string[] } {
  const usedElsewhere = new Set(all.filter((other) => other.id !== log.id).flatMap((other) => other.dsLogs.map((ds) => ds.localPath)));
  const remove: string[] = [];
  const kept: string[] = [];
  if (log.localPath) remove.push(log.localPath);
  for (const hoot of log.hoots) remove.push(hoot.localPath);
  for (const ds of log.dsLogs) {
    const paths = [ds.localPath, ...(ds.eventsPath ? [ds.eventsPath] : [])];
    (usedElsewhere.has(ds.localPath) ? kept : remove).push(...paths);
  }
  return { remove: [...new Set(remove)], kept };
}
