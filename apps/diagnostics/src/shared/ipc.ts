// What the window can ask the main process to do. The preload script exposes
// one function per entry as `window.diagnostics`; the main process handles
// each on the channel of the same name.

import type { HootLogStatus, HootProgress, OwletStatus } from './hoot';
import type { MatchInfo, OffloadedFile, OffloadStatus } from './offload';
import type { Settings, SettingsErrors } from './settings';
import type { GroupedSignals, SignalInfo, SignalRange, SignalSeries } from './signals';

export interface AppInfo {
  version: string;
  // 'win32', 'linux', 'darwin'
  platform: string;
}

export interface SaveSettingsResult {
  // The settings now in effect: the new ones, or the old ones if there were errors.
  settings: Settings;
  errors: SettingsErrors;
}

export interface StorageFolderInfo {
  name: string;
  purpose: string;
  files: number;
  bytes: number;
}

export interface StorageInfo {
  // The data folder in use, as a full path.
  directory: string;
  // Whether that's the default folder rather than one picked in Settings.
  isDefault: boolean;
  folders: StorageFolderInfo[];
  // Why the folder couldn't be created or read, or '' when all is well.
  error: string;
}

export interface PortCheck {
  port: number;
  // What listens there on a robot.
  service: string;
  open: boolean;
  // How long the connection took, when it worked.
  milliseconds: number | null;
  // Why it failed, when it didn't.
  error: string;
}

export interface AddressCheck {
  label: string;
  host: string;
  ports: PortCheck[];
}

export interface ConnectionReport {
  checkedAt: string;
  // True when any address answered on any port.
  reachable: boolean;
  addresses: AddressCheck[];
}

export interface OffloadedFiles {
  total: number;
  // The most recently changed, newest first.
  recent: OffloadedFile[];
}

export interface SessionHoot {
  localPath: string;
  name: string;
  bus: string;
  label: string;
  size: number;
}

// One recording to read signals from: a WPILib data log and the CTRE Hoot
// logs from the same match or time, or Hoot logs on their own.
export interface SignalLogFile {
  // Names the session: its data log's path, or its first Hoot log's.
  id: string;
  // The data log, below the data folder; null for Hoot logs on their own.
  localPath: string | null;
  name: string;
  robot: string;
  // Of all its files.
  size: number;
  // When recording started (ISO), as near as is known.
  recorded: string;
  match: MatchInfo | null;
  hoots: SessionHoot[];
}

export interface HootSessionStatus {
  hoots: HootLogStatus[];
  progress: HootProgress | null;
  // The session's time span in seconds, which grows once Hoot logs are
  // lined up (they often start before the data log).
  start: number;
  end: number;
}

export interface SignalLogSummary {
  id: string;
  // Seconds from the first value to the last.
  duration: number;
  // When the log started, by the clock (ISO), if the log says.
  startedAt: string | null;
  // Whether the end of the file was cut off.
  truncated: boolean;
  signals: SignalInfo[];
  groups: GroupedSignals[];
  // Things about the log worth knowing before trusting it (values the
  // logger dropped, ...).
  warnings: string[];
}

export interface DiagnosticsApi {
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<SaveSettingsResult>;
  // Shows a folder picker. Resolves to the chosen folder, or null if cancelled.
  chooseDataDirectory(): Promise<string | null>;
  getStorageInfo(): Promise<StorageInfo>;
  // Opens the data folder in the file manager. Resolves to an error message, or ''.
  openDataDirectory(): Promise<string>;
  checkConnection(): Promise<ConnectionReport>;
  getOffloadStatus(): Promise<OffloadStatus>;
  // Starts an offload and resolves when it's done, to why it didn't start or ''.
  startOffload(): Promise<string>;
  getOffloadedFiles(): Promise<OffloadedFiles>;
  getSignalLogs(): Promise<SignalLogFile[]>;
  // Opens a session for reading signals; rejects if it can't be read.
  openSignalLog(id: string): Promise<SignalLogSummary>;
  // Null if the session has no such signal. A Hoot signal not read before is
  // exported first, which can take a while for a big log.
  readSignal(id: string, key: string, range: SignalRange): Promise<SignalSeries | null>;
  getHootStatus(id: string): Promise<HootSessionStatus>;
  getOwletStatus(): Promise<OwletStatus>;
  // Records that CTRE's licence was accepted, and gets owlet.
  acceptCtreLicense(): Promise<OwletStatus>;
  // Checks CTRE for owlet again.
  downloadOwlet(): Promise<OwletStatus>;
}

export const ipcChannels: (keyof DiagnosticsApi)[] = [
  'getAppInfo',
  'getSettings',
  'saveSettings',
  'chooseDataDirectory',
  'getStorageInfo',
  'openDataDirectory',
  'checkConnection',
  'getOffloadStatus',
  'startOffload',
  'getOffloadedFiles',
  'getSignalLogs',
  'openSignalLog',
  'readSignal',
  'getHootStatus',
  'getOwletStatus',
  'acceptCtreLicense',
  'downloadOwlet'
];
