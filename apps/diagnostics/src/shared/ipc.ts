// What the window can ask the main process to do. The preload script exposes
// one function per entry as `window.diagnostics`; the main process handles
// each on the channel of the same name.

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

// An offloaded data log that signals can be read from.
export interface SignalLogFile {
  // Below the data folder, as in the offload index.
  localPath: string;
  name: string;
  robot: string;
  size: number;
  // When recording started (ISO), as near as is known.
  recorded: string;
  match: MatchInfo | null;
}

export interface SignalLogSummary {
  localPath: string;
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
  // Opens a log for reading signals; rejects if it can't be read.
  openSignalLog(localPath: string): Promise<SignalLogSummary>;
  // Null if the log has no such signal.
  readSignal(localPath: string, key: string, range: SignalRange): Promise<SignalSeries | null>;
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
  'readSignal'
];
