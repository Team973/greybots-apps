// What the window can ask the main process to do. The preload script exposes
// one function per entry as `window.diagnostics`; the main process handles
// each on the channel of the same name.

import type { AccountStatus } from './account';
import type { HootLogStatus, HootProgress, OwletStatus } from './hoot';
import type { ImportStatus, ImportSummary } from './import';
import type { Annotation, SessionEvents } from './events';
import type { LibraryItem, LibraryItemOf, LibraryKind, Report, ReportSummary } from './library';
import type { EarlierRun, LiveStatus } from './live';
import type { MatchInfo, OffloadedFile, OffloadStatus } from './offload';
import type { RobotModel, SignalRecords } from './plots';
import type { PipelineRun, PipelineStatus } from './reports';
import type { Settings, SettingsErrors } from './settings';
import type { GroupedSignals, SignalInfo, SignalRange, SignalSeries, SignalValue } from './signals';

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

// The offloaded and imported files list, a page at a time.
export type OffloadedSort = 'changed' | 'match';

export interface OffloadedFilesQuery {
  // From 0.
  page: number;
  pageSize: number;
  sort: OffloadedSort;
  // Newest (or latest match) first when true.
  descending: boolean;
}

export interface OffloadedFiles {
  total: number;
  // The page asked for, sorted.
  files: OffloadedFile[];
}

export interface SessionHoot {
  localPath: string;
  name: string;
  bus: string;
  label: string;
  size: number;
}

// A Driver Station log (.dslog), and the .dsevents beside it if there is one.
export interface SessionDsLog {
  localPath: string;
  eventsPath: string | null;
  name: string;
  // "DS log", or "DS log 2" when a session has more than one.
  label: string;
  size: number;
}

// How a Driver Station log was put on the session's timeline: it is the
// timeline (on its own), by the first enable in both, or by the clock.
export type DsAlignment = 'base' | 'enable' | 'clock';

export interface DsLogStatus {
  localPath: string;
  label: string;
  size: number;
  alignment: DsAlignment;
  // Seconds added to its times.
  offset: number;
  // "Qualification 12", when the FMS was connected.
  match: string | null;
  truncated: boolean;
}

// One recording to read signals from: a WPILib data log with the CTRE Hoot
// logs and Driver Station logs from the same match or time, or Hoot logs
// or a Driver Station log on their own.
export interface SignalLogFile {
  // Names the session: its data log's path, or its first Hoot log's or its
  // Driver Station log's.
  id: string;
  // The data log, below the data folder; null without one.
  localPath: string | null;
  name: string;
  robot: string;
  // Of all its files.
  size: number;
  // When recording started (ISO), as near as is known.
  recorded: string;
  match: MatchInfo | null;
  hoots: SessionHoot[];
  dsLogs: SessionDsLog[];
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
  // Where the timeline starts, when not 0 (an earlier live run whose first
  // minutes were let go).
  start?: number;
  // When the log started, by the clock (ISO), if the log says.
  startedAt: string | null;
  // Whether the end of the file was cut off.
  truncated: boolean;
  signals: SignalInfo[];
  groups: GroupedSignals[];
  // Things about the log worth knowing before trusting it (values the
  // logger dropped, ...).
  warnings: string[];
  // Its Driver Station logs, and how they were lined up (none live).
  dsLogs?: DsLogStatus[];
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
  getOffloadedFiles(query: OffloadedFilesQuery): Promise<OffloadedFiles>;
  // Files a person dropped or picked (logs, folders, zip files), filed into
  // the archive. Resolves when done, to what happened or why it didn't start.
  importLogs(paths: string[], fallbackTeam: number): Promise<ImportSummary | string>;
  getImportStatus(): Promise<ImportStatus>;
  // A picker for logs and zip files, or for folders. [] if cancelled.
  chooseImport(folders: boolean): Promise<string[]>;
  getSignalLogs(): Promise<SignalLogFile[]>;
  // Opens a session for reading signals; rejects if it can't be read. A
  // live session's id (live.ts) connects to the robot or a simulator.
  openSignalLog(id: string): Promise<SignalLogSummary>;
  // Null if the session has no such signal. A Hoot signal not read before is
  // exported first, which can take a while for a big log.
  readSignal(id: string, key: string, range: SignalRange): Promise<SignalSeries | null>;
  // Each signal's value at one time (seconds, as in series), for the signal
  // list; null where there's none. Hoot signals not read yet are null.
  readValues(id: string, keys: string[], time: number): Promise<Record<string, SignalValue>>;
  // Every value of a signal over a range, decoded whole (structs, arrays),
  // for the field and the 3D robot (#144): at most `max`, the latest kept.
  // Null if the session has no such signal, or it's in a Hoot log or a
  // Driver Station log (those have none of these).
  readRecords(id: string, key: string, range: SignalRange, max: number): Promise<SignalRecords | null>;
  getHootStatus(id: string): Promise<HootSessionStatus>;
  // What happened in a log: events found in it, the match's phases, and
  // notes. `pending` says what's still being looked for; ask again.
  getEvents(id: string): Promise<SessionEvents>;
  // Adds a note to a log (no id) or changes one; blank text deletes it.
  // Resolves to the log's notes.
  saveNote(id: string, note: { id?: string; time: number; text: string }): Promise<Annotation[]>;
  deleteNote(id: string, noteId: string): Promise<Annotation[]>;
  // Puts a PNG on the clipboard. Resolves to an error message, or ''.
  copyImage(png: Uint8Array): Promise<string>;
  // A live session's connection, and how far its timeline goes. Asking keeps
  // it connected.
  getLiveStatus(id: string): Promise<LiveStatus>;
  // Runs recorded live and kept, newest first, to open like logs.
  getEarlierRuns(): Promise<EarlierRun[]>;
  getOwletStatus(): Promise<OwletStatus>;
  // Records that CTRE's licence was accepted, and gets owlet.
  acceptCtreLicense(): Promise<OwletStatus>;
  // Checks CTRE for owlet again.
  downloadOwlet(): Promise<OwletStatus>;
  // The library (#148): saved views, report templates, pipelines, robot
  // mappings. Saving one with no id (or an id not here) adds it.
  getLibrary<K extends LibraryKind>(kind: K): Promise<LibraryItemOf[K][]>;
  saveLibraryItem(item: LibraryItem): Promise<LibraryItem>;
  // Resolves to why it can't be deleted (someone else's in the cloud), or ''.
  deleteLibraryItem(kind: LibraryKind, id: string): Promise<string>;
  // Adds the starter views, templates and pipeline that aren't here yet.
  // Resolves to how many were added.
  addStarters(): Promise<number>;
  getReports(): Promise<ReportSummary[]>;
  getReport(id: string): Promise<Report | null>;
  // Makes a report from a template and a log, and keeps it.
  generateReport(templateId: string, logId: string): Promise<Report>;
  deleteReport(id: string): Promise<void>;
  // Runs a pipeline on logs by hand (whatever its triggers say).
  runPipeline(pipelineId: string, logIds: string[]): Promise<PipelineRun[]>;
  getPipelineStatus(): Promise<PipelineStatus>;
  // Saves the page as it's shown (a report) as a PDF, asking where.
  // Resolves to where it was saved, or '' if cancelled.
  savePdf(suggestedName: string): Promise<string>;
  // The greybots-apps account the library's shared with the team through.
  getAccount(): Promise<AccountStatus>;
  signIn(email: string, password: string): Promise<AccountStatus>;
  signOut(): Promise<AccountStatus>;
  // Syncs the library with the team's now. Resolves when it's done.
  syncLibrary(): Promise<AccountStatus>;
  // Robot models for the 3D robot plot, in the data folder's models/.
  getRobotModels(): Promise<RobotModel[]>;
  // Asks for a model's folder (AdvantageScope's: config.json, model.glb,
  // ...) and copies it in. Resolves to the model, why it can't, or null if
  // cancelled.
  addRobotModel(): Promise<RobotModel | string | null>;
  removeRobotModel(id: string): Promise<void>;
  readModelFile(id: string, file: string): Promise<Uint8Array>;
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
  'importLogs',
  'getImportStatus',
  'chooseImport',
  'getSignalLogs',
  'openSignalLog',
  'readSignal',
  'readValues',
  'readRecords',
  'getHootStatus',
  'getEvents',
  'saveNote',
  'deleteNote',
  'copyImage',
  'getLiveStatus',
  'getEarlierRuns',
  'getOwletStatus',
  'acceptCtreLicense',
  'downloadOwlet',
  'getLibrary',
  'saveLibraryItem',
  'deleteLibraryItem',
  'addStarters',
  'getReports',
  'getReport',
  'generateReport',
  'deleteReport',
  'runPipeline',
  'getPipelineStatus',
  'savePdf',
  'getAccount',
  'signIn',
  'signOut',
  'syncLibrary',
  'getRobotModels',
  'addRobotModel',
  'removeRobotModel',
  'readModelFile'
];
