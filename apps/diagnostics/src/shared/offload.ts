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

// Pulled in this order (newest first within each): the small files with
// the most in them first, so they aren't stuck behind Hoot logs, which can
// be hundreds of MB each.
export const robotLogLocations: RobotLogLocation[] = [
  { source: 'roborio', label: 'WPILib data logs', directories: robotLogDirectories, extensions: ['.wpilog'], depth: 2 },
  // stdout and stderr of the robot program.
  { source: 'roborio', label: 'Robot program log', directories: ['/home/lvuser'], extensions: ['.log'], depth: 0 },
  { source: 'ctre-hoot', label: 'CTRE Hoot logs', directories: robotLogDirectories, extensions: ['.hoot'], depth: 2 }
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
  // A replayed match's replay number (E13.2), as WPILib adds it. 0 or
  // missing for the first time a match is played.
  replay?: number;
}

export interface LogNameInfo {
  // When recording started, if the name says.
  recorded: Date | null;
  match: MatchInfo | null;
}

const matchTypes: Record<string, MatchType> = { P: 'practice', Q: 'qualification', E: 'elimination' };

function matchFrom(event: string, type: string, number: string, replay: string | undefined): MatchInfo {
  const match: MatchInfo = { event, type: matchTypes[type.toUpperCase()], number: Number(number) };
  if (replay !== undefined && Number(replay) > 0) match.replay = Number(replay);
  return match;
}

// DataLogManager names its files FRC_<yyyyMMdd>_<HHmmss>.wpilog, in UTC, once
// the Driver Station has set the robot's clock, and adds _<event>_<Q42> once
// FMS has said which match it is (_E13.2 for a replay). Before the clock is
// set it's FRC_TBD_<id>.
//
// CTRE's SignalLogger names Hoot logs <event>_<Q42>_<CAN bus>_<date>_<time>.hoot
// (the bus: rio, or a CANivore's name or id)
// in a match, which gives the match but not a time zone, so not the time.
export function parseLogName(fileName: string): LogNameInfo {
  const data = /^FRC_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_(.+)_([PQE])(\d+)(?:\.(\d+))?)?\.wpilog$/i.exec(fileName);
  if (data) {
    const [year, month, day, hour, minute, second] = data.slice(1, 7).map(Number);
    const recorded = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const match = data[7] ? matchFrom(data[7], data[8], data[9], data[10]) : null;
    return { recorded, match };
  }

  const hoot = /^(.+)_([PQE])(\d+)(?:\.(\d+))?_[^_]+_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.hoot$/i.exec(fileName);
  if (hoot) return { recorded: null, match: matchFrom(hoot[1], hoot[2], hoot[3], hoot[4]) };

  return { recorded: null, match: null };
}

// A data log still named FRC_TBD_ is either still being written (it's
// renamed once the Driver Station sets the clock) or from a boot that never
// saw a Driver Station, with no times and no match in it. Not worth pulling:
// the first would be pulled again under its new name.
export function isUnnamedLog(fileName: string): boolean {
  return /^FRC_TBD_.*\.wpilog$/i.test(fileName);
}

export function describeMatch(match: MatchInfo): string {
  const replay = match.replay ? ` (replay ${match.replay})` : '';
  return `${match.event} ${match.type[0].toUpperCase()}${match.number}${replay}`;
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
  // Not pulled because they're older than the Settings limit.
  tooOld: number;
  bytes: number;
  errors: string[];
}

// How the current part of an offload (the robot, or Driver Station logs) is
// going. Counts only the files being pulled, not those already here.
export interface OffloadProgress {
  label: string;
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  // The names of the files being pulled right now.
  active: string[];
}

export interface OffloadStatus {
  running: boolean;
  autoOffload: boolean;
  // Where the robot answered on its last check, or null if it didn't.
  robotHost: string | null;
  current: OffloadProgress | null;
  lastRun: OffloadRunSummary | null;
}
