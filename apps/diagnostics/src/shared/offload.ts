// Log offload: where logs are found on the robot and this computer, what the
// index of offloaded files looks like, and the status the window shows.
// Used by both sides, so nothing here may touch Node or the DOM.

import type { LogSource } from './storage-layout';
import type { Settings } from './settings';

// A place on the roboRIO that logs are pulled from.
export interface RobotLogLocation {
  source: LogSource;
  label: string;
  // Folders searched, `depth` levels down, for files with these extensions.
  directories: string[];
  extensions: string[];
  depth: number;
}

// WPILib's DataLogManager and CTRE's SignalLogger both write to a USB drive
// when one is plugged in (/u, a link to /media/sda1) and to /home/lvuser/logs
// otherwise. Hoot files go in a folder per session, hence the depth.
const robotLogDirectories = ['/home/lvuser/logs', '/u/logs'];

export const robotLogLocations: RobotLogLocation[] = [
  { source: 'roborio', label: 'WPILib data logs', directories: robotLogDirectories, extensions: ['.wpilog'], depth: 2 },
  { source: 'ctre-hoot', label: 'CTRE Hoot logs', directories: robotLogDirectories, extensions: ['.hoot'], depth: 2 },
  // stdout and stderr of the robot program.
  { source: 'roborio', label: 'Robot program log', directories: ['/home/lvuser'], extensions: ['.log'], depth: 0 }
];

// The Driver Station writes its logs here when this computer is the driver
// station. Only on Windows, the only system the Driver Station runs on.
export const driverStationLogDirectory = 'C:\\Users\\Public\\Documents\\FRC\\Log Files';
export const driverStationExtensions = ['.dslog', '.dsevents'];

// The roboRIO's SSH login. Every roboRIO has this user, with no password.
export const robotSshUser = 'lvuser';

// The folder under logs/ that a robot's files go in.
export function robotFolderName(settings: Settings): string {
  return settings.addressMode === 'manual' ? settings.manualAddress.trim() : `frc${settings.teamNumber}`;
}

export type MatchType = 'practice' | 'qualification' | 'elimination';

export interface MatchInfo {
  // The event name FMS gave the robot (e.g. CASJ), not a TBA key.
  event: string;
  type: MatchType;
  number: number;
}

export interface LogNameInfo {
  // When recording started, if the name says.
  recorded: Date | null;
  match: MatchInfo | null;
}

const matchTypes: Record<string, MatchType> = { P: 'practice', Q: 'qualification', E: 'elimination' };

// DataLogManager names its files FRC_<yyyyMMdd>_<HHmmss>.wpilog, in UTC, once
// the Driver Station has set the robot's clock, and adds _<event>_<Q42> once
// FMS has said which match it is. Before the clock is set it's FRC_TBD_<id>.
export function parseLogName(fileName: string): LogNameInfo {
  const found = /^FRC_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_(.+)_([PQE])(\d+))?\.wpilog$/i.exec(fileName);
  if (!found) return { recorded: null, match: null };

  const [year, month, day, hour, minute, second] = found.slice(1, 7).map(Number);
  const recorded = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const match = found[7]
    ? { event: found[7], type: matchTypes[found[8].toUpperCase()], number: Number(found[9]) }
    : null;
  return { recorded, match };
}

// A data log still named FRC_TBD_ is either still being written (it's
// renamed once the Driver Station sets the clock) or from a boot that never
// saw a Driver Station, with no times and no match in it. Not worth pulling:
// the first would be pulled again under its new name.
export function isUnnamedLog(fileName: string): boolean {
  return /^FRC_TBD_.*\.wpilog$/i.test(fileName);
}

export function describeMatch(match: MatchInfo): string {
  return `${match.event} ${match.type[0].toUpperCase()}${match.number}`;
}

// One file that has been offloaded, as recorded in index/offloaded.json.
export interface OffloadedFile {
  robot: string;
  source: LogSource;
  // Where it came from: a path on the robot, or on this computer for
  // Driver Station logs.
  origin: 'robot' | 'local';
  originPath: string;
  size: number;
  // When it last changed where it came from, as an ISO time.
  modified: string;
  // Where it is now, below the data folder, with / between folders.
  localPath: string;
  offloadedAt: string;
  match: MatchInfo | null;
}

export interface OffloadRunSummary {
  startedAt: string;
  finishedAt: string;
  // The robot address used, or '' when only local files were looked at.
  host: string;
  // Whether this run started by itself when the robot appeared.
  automatic: boolean;
  copied: number;
  skipped: number;
  bytes: number;
  errors: string[];
}

export interface OffloadProgress {
  label: string;
  file: string;
  bytesDone: number;
  bytesTotal: number;
}

export interface OffloadStatus {
  running: boolean;
  autoOffload: boolean;
  // Where the robot answered on its last check, or null if it didn't.
  robotHost: string | null;
  current: OffloadProgress | null;
  lastRun: OffloadRunSummary | null;
}
