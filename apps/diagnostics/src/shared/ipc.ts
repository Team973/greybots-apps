// What the window can ask the main process to do. The preload script exposes
// one function per entry as `window.diagnostics`; the main process handles
// each on the channel of the same name.

import type { Settings, SettingsErrors } from './settings';

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
}

export const ipcChannels: (keyof DiagnosticsApi)[] = [
  'getAppInfo',
  'getSettings',
  'saveSettings',
  'chooseDataDirectory',
  'getStorageInfo',
  'openDataDirectory',
  'checkConnection'
];
