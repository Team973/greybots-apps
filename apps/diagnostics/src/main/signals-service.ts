import { app, shell } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import type { LogEvent, MatchPhase, SessionEvents } from '@shared/events';
import { hootBus, hootBusLabel, hootStartTime, type HootAlignment, type HootLogStatus, type HootProgress, type OwletStatus } from '@shared/hoot';
import type { DsAlignment, DsLogStatus, HootSessionStatus, SessionDsLog, SessionHoot, SignalLogFile, SignalLogSummary } from '@shared/ipc';
import { isLiveId } from '@shared/live';
import { filesToDelete } from '@shared/log-filter';
import { notesPathSegments } from '@shared/storage-layout';
import type { SignalRecords } from '@shared/plots';
import { parseLogName, trustedTime, type MatchInfo } from '@shared/offload';
import type { Settings } from '@shared/settings';
import {
  groupSignals,
  splitName,
  unitFor,
  valueAtTime,
  type SignalInfo,
  type SignalKind,
  type SignalRange,
  type SignalSeries,
  type SignalValue
} from '@shared/signals';
import { exportedName, HootLog } from './hoot/hoot-log';
import { hootCompliancy, Owlet } from './hoot/owlet';
import { openLive, readLive, readLiveRecords } from './live-service';
import { loadNotes } from './notes-store';
import { loadIndex, storeIndex } from './offload/offload-index';
import { loadSettings, storeSettings } from './settings-store';
import {
  dataLogEvents,
  dataLogModes,
  eventsFrom,
  faultSeverity,
  faultTitle,
  dsLogEvents,
  hasConsole,
  hasDriverStationEnable,
  hootModes,
  enabledSpans,
  matchPhases,
  modeEvents,
  spansWhere,
  type ModeChange
} from './signals/events';
import { dsLogHead, readDsEvents, readDsLog, type DsEvents, type DsLog, type DsRecordHead } from './signals/ds-log';
import { LogSignalSource } from './signals/log-source';
import { dataDirectory } from './storage';

// --- Finding logs ---

interface FoundFile {
  path: string[];
  size: number;
  modified: Date;
}

// How deep under logs/ to look: logs/<robot>/<day>/<source>/<file>, and a
// little more for files put there by hand.
const maxDepth = 6;

async function findFiles(directory: string, relative: string[], depth: number, extension: string): Promise<FoundFile[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: FoundFile[] = [];
  for (const entry of entries) {
    const path = [...relative, entry.name];
    if (entry.isDirectory() && depth < maxDepth) {
      found.push(...(await findFiles(join(directory, entry.name), path, depth + 1, extension)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
      const stat = await fs.stat(join(directory, entry.name)).catch(() => null);
      if (stat) found.push({ path, size: stat.size, modified: stat.mtime });
    }
  }
  return found;
}

// logs/<robot>/..., or '' for a file right in logs/.
const robotOf = (path: string[]) => (path.length > 2 ? path[1] : '');

const sameMatch = (a: MatchInfo | null, b: MatchInfo | null) =>
  !!a && !!b && a.event === b.event && a.type === b.type && a.number === b.number;

// A Hoot log goes with a data log of the same robot and match, or, outside
// a match, one whose name time is this close to its own.
const pairingWindowMs = 2 * 60 * 1000;
// Same match, but how far apart the starts can be (a match's logs start
// minutes apart at most; this keeps out the same match number another day).
const sameMatchWindowMs = 60 * 60 * 1000;

// A Driver Station log goes with a data log that started while it was
// being written (or this much before: clocks differ a little).
const dsLeadMs = 60 * 1000;

// Each Driver Station log's start, length and whether a robot was there,
// by path: reading them means reading them whole, so once per version.
const dsHeads = new Map<string, { version: string; head: DsRecordHead | null }>();

async function dsHeadOf(path: string, version: string): Promise<DsRecordHead | null> {
  const known = dsHeads.get(path);
  if (known?.version === version) return known.head;
  const head = await fs.readFile(path).then((bytes) => dsLogHead(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))).catch(() => null);
  dsHeads.set(path, { version, head });
  return head;
}

// Every recording in the data folder's logs/, newest first: data logs with
// the Hoot logs and Driver Station logs that go with them, and Hoot logs or
// Driver Station logs on their own. Offloaded or put there by hand; the
// offload index adds the match where it knows it.
export async function signalLogs(settings: Settings): Promise<SignalLogFile[]> {
  const directory = dataDirectory(settings);
  const index = await loadIndex(directory);
  const offloaded = new Map(Object.values(index.files).map((file) => [file.localPath, file]));
  const logsDirectory = join(directory, 'logs');

  const dataLogs = (await findFiles(logsDirectory, ['logs'], 0, '.wpilog')).map(({ path, size, modified }) => {
    const localPath = path.join('/');
    const name = path[path.length - 1];
    const parsed = parseLogName(name);
    const known = offloaded.get(localPath);
    return {
      localPath,
      name,
      robot: known?.robot ?? robotOf(path),
      size,
      start: parsed.recorded ?? (known ? new Date(known.modified) : modified),
      match: known?.match ?? parsed.match
    };
  });

  const hoots = (await findFiles(logsDirectory, ['logs'], 0, '.hoot')).map(({ path, size, modified }) => {
    const localPath = path.join('/');
    const name = path[path.length - 1];
    const bus = hootBus(name);
    const named = hootStartTime(name);
    const known = offloaded.get(localPath);
    return {
      localPath,
      name,
      robot: robotOf(path),
      size,
      bus,
      label: `Hoot ${hootBusLabel(bus)}`,
      // For pairing with a data log, as the names line up with it.
      start: named ?? modified,
      // For ordering, and grouping Hoot logs on their own: the name's time
      // can be the robot's unset clock (see trustedTime).
      recorded: trustedTime(named, known ? new Date(known.modified) : null, modified),
      match: parseLogName(name).match
    };
  });

  // Driver Station logs a robot was connected to: most are the Driver
  // Station open with no robot, and are left out.
  const dsEvents = new Set((await findFiles(logsDirectory, ['logs'], 0, '.dsevents')).map(({ path }) => path.join('/')));
  const dsLogs = (await Promise.all((await findFiles(logsDirectory, ['logs'], 0, '.dslog')).map(async ({ path, size, modified }) => {
    const head = await dsHeadOf(join(directory, ...path), `${size}:${modified.getTime()}`);
    if (!head?.connected) return null;
    const localPath = path.join('/');
    const eventsPath = localPath.replace(/\.dslog$/i, '.dsevents');
    return {
      localPath,
      eventsPath: dsEvents.has(eventsPath) ? eventsPath : null,
      name: path[path.length - 1],
      robot: robotOf(path),
      size,
      start: head.startedAt,
      end: head.startedAt + head.duration * 1000
    };
  }))).filter((log): log is NonNullable<typeof log> => log !== null);
  const dsUsed = new Set<string>();
  const dsEntry = (log: (typeof dsLogs)[number], label: string): SessionDsLog =>
    ({ localPath: log.localPath, eventsPath: log.eventsPath, name: log.name, label, size: log.size });

  // Each Hoot log to the nearest data log it goes with.
  const paired = new Map<string, SessionHoot[]>();
  const alone: typeof hoots = [];
  for (const hoot of hoots) {
    let best: (typeof dataLogs)[number] | null = null;
    for (const log of dataLogs) {
      if (log.robot !== hoot.robot) continue;
      const apart = Math.abs(log.start.getTime() - hoot.start.getTime());
      const fits = hoot.match ? sameMatch(log.match, hoot.match) && apart < sameMatchWindowMs : apart <= pairingWindowMs;
      // Ties (Q27 and Q27.2 share a name time) go to the first log of the match.
      if (fits && (!best || apart < Math.abs(best.start.getTime() - hoot.start.getTime()) ||
        (apart === Math.abs(best.start.getTime() - hoot.start.getTime()) && (log.match?.suffix ?? 0) < (best.match?.suffix ?? 0)))) {
        best = log;
      }
    }
    const entry = { localPath: hoot.localPath, name: hoot.name, bus: hoot.bus, label: hoot.label, size: hoot.size };
    if (best) paired.set(best.localPath, [...(paired.get(best.localPath) ?? []), entry]);
    else alone.push(hoot);
  }

  const sessions: SignalLogFile[] = dataLogs.map((log) => {
    const logHoots = paired.get(log.localPath) ?? [];
    const started = log.start.getTime();
    const logDs = dsLogs.filter((ds) => ds.robot === log.robot && started >= ds.start - dsLeadMs && started <= ds.end);
    for (const ds of logDs) dsUsed.add(ds.localPath);
    return {
      id: log.localPath,
      localPath: log.localPath,
      name: log.name,
      robot: log.robot,
      size: log.size + [...logHoots, ...logDs].reduce((total, other) => total + other.size, 0),
      recorded: log.start.toISOString(),
      match: log.match,
      hoots: logHoots,
      dsLogs: logDs.map((ds, i) => dsEntry(ds, logDs.length > 1 ? `DS log ${i + 1}` : 'DS log'))
    };
  });

  // Driver Station logs with no data log.
  for (const ds of dsLogs) {
    if (dsUsed.has(ds.localPath)) continue;
    sessions.push({
      id: ds.localPath,
      localPath: null,
      name: ds.name,
      robot: ds.robot,
      size: ds.size,
      recorded: new Date(ds.start).toISOString(),
      match: null,
      hoots: [],
      dsLogs: [dsEntry(ds, 'DS log')]
    });
  }

  // Hoot logs with no data log: one session per robot and start time
  // (the rio and CANivore logs of one run start together).
  // By when they were recorded: Hoot logs from different days can have the
  // same (unset-clock) name time.
  alone.sort((a, b) => a.recorded.getTime() - b.recorded.getTime());
  const groups: (typeof alone)[] = [];
  for (const hoot of alone) {
    const group = groups.find((g) => g[0].robot === hoot.robot && Math.abs(g[0].recorded.getTime() - hoot.recorded.getTime()) <= pairingWindowMs);
    if (group) group.push(hoot);
    else groups.push([hoot]);
  }
  for (const group of groups) {
    sessions.push({
      id: group[0].localPath,
      localPath: null,
      name: group[0].name,
      robot: group[0].robot,
      size: group.reduce((total, hoot) => total + hoot.size, 0),
      recorded: group[0].recorded.toISOString(),
      match: group.find((hoot) => hoot.match)?.match ?? null,
      hoots: group.map(({ localPath, name, bus, label, size }) => ({ localPath, name, bus, label, size })),
      dsLogs: []
    });
  }

  sessions.sort((a, b) => b.recorded.localeCompare(a.recorded));
  return sessions;
}

// Deletes a log from the data folder: its files go to the Recycle Bin (or
// the Trash), and its notes, cached Hoot exports and index entries go too.
// Nothing remembers it, so if it's still on the robot the next download
// brings it back. A Driver Station log another log also has is kept.
export async function deleteLog(settings: Settings, id: string): Promise<{ removed: string[]; kept: string[] }> {
  if (isLiveId(id)) throw new Error('A live session has nothing to delete.');
  const all = await signalLogs(settings);
  const log = all.find((l) => l.id === id);
  if (!log) throw new Error('That log is not in the data folder.');
  const directory = dataDirectory(settings);
  const absolute = (localPath: string) => join(directory, ...localPath.split('/'));
  const { remove, kept } = filesToDelete(log, all);

  // Let go of it first: nothing should be reading the files.
  openSessions.delete(id);
  opening.delete(id);
  for (const hoot of log.hoots) hootLogs.delete(hoot.localPath);

  const removed: string[] = [];
  for (const localPath of remove) {
    const path = absolute(localPath);
    if (!(await fs.stat(path).catch(() => null))) continue;
    await shell.trashItem(path);
    dsHeads.delete(path);
    removed.push(localPath);
  }

  await fs.rm(join(directory, ...notesPathSegments(id)), { force: true });
  for (const hoot of log.hoots) await fs.rm(hootCacheOf(directory, hoot.localPath), { recursive: true, force: true });

  const gone = new Set(remove);
  const index = await loadIndex(directory);
  let changed = false;
  for (const [key, file] of Object.entries(index.files)) {
    if (gone.has(file.localPath)) {
      delete index.files[key];
      changed = true;
    }
  }
  for (const key of Object.keys(index.partials)) {
    if (gone.has(key.slice(key.lastIndexOf('|') + 1))) {
      delete index.partials[key];
      changed = true;
    }
  }
  if (changed) await storeIndex(directory, index);
  return { removed, kept };
}

// --- Owlet ---

let owletInstance: Owlet | null = null;
const owlet = () => (owletInstance ??= new Owlet(join(app.getPath('userData'), 'owlet')));

// Compliancies of the Hoot logs here, so a beta one's owlet is got too.
async function neededCompliancies(settings: Settings): Promise<number[]> {
  const directory = dataDirectory(settings);
  const hoots = await findFiles(join(directory, 'logs'), ['logs'], 0, '.hoot');
  const found = new Set<number>();
  for (const hoot of hoots) {
    const compliancy = await hootCompliancy(join(directory, ...hoot.path)).catch(() => null);
    if (compliancy !== null) found.add(compliancy);
  }
  return [...found];
}

export async function owletStatus(): Promise<OwletStatus> {
  return owlet().status((await loadSettings()).ctreLicenseAccepted);
}

export async function downloadOwlet(): Promise<OwletStatus> {
  const settings = await loadSettings();
  if (settings.ctreLicenseAccepted) await owlet().download(await neededCompliancies(settings));
  return owletStatus();
}

export async function acceptCtreLicense(): Promise<OwletStatus> {
  const settings = await loadSettings();
  await storeSettings({ ...settings, ctreLicenseAccepted: true });
  // Hoot logs that couldn't be read before can be now.
  forgetHootLogs();
  return downloadOwlet();
}

// Keeps owlet current while the app runs: CTRE publishes new builds with
// each Phoenix release. Offline, it tries again later.
export function watchOwlet() {
  const check = async () => {
    const settings = await loadSettings();
    if (!settings.ctreLicenseAccepted) return;
    const before = (await owlet().installed()).map((v) => `${v.compliancy}:${v.version}`).join();
    await owlet().download(await neededCompliancies(settings)).catch(() => {});
    const after = (await owlet().installed()).map((v) => `${v.compliancy}:${v.version}`).join();
    // New builds: Hoot logs open again with them.
    if (before !== after) forgetHootLogs();
  };
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}

// --- Sessions ---

// Where a Hoot log's scan and exports are kept. Short on purpose: owlet
// can't write past Windows' 260-character path limit, and Hoot log names
// are long.
const hootCacheOf = (directory: string, localPath: string) =>
  join(directory, 'results', 'hoot', createHash('sha1').update(localPath).digest('hex').slice(0, 16));

// Hoot logs, by path: their scans and exports are worth keeping across
// sessions (the same log can be looked at again).
const hootLogs = new Map<string, HootLog>();
let progress: HootProgress | null = null;

// Files pulled again because they changed (a log that grew): what's held
// of them in memory goes, so they're read afresh. Their Hoot exports on disk
// are checked against the file's size and time when next opened.
export function forgetFiles(localPaths: string[]) {
  const changed = new Set(localPaths);
  for (const path of changed) hootLogs.delete(path);
  for (const [id, session] of openSessions) {
    const files = [session.file.localPath, ...session.file.hoots.map((h) => h.localPath), ...session.file.dsLogs.map((d) => d.localPath)];
    if (files.some((path) => path !== null && changed.has(path))) openSessions.delete(id);
  }
}

// So Hoot logs that couldn't be read are tried again, with the licence or
// owlet there is now. Those already being read are left alone: they may be
// part way through an export.
function forgetHootLogs() {
  for (const [path, hoot] of hootLogs) if (hoot.state !== 'ready') hootLogs.delete(path);
  openSessions.clear();
}

interface Placement {
  hoot: HootLog;
  alignment: HootAlignment | null;
  offset: number | null;
  // Resolves once the offset is known.
  aligned: Promise<void>;
}

// A Driver Station log, read whole (they're small), and where it goes on
// the session's timeline.
interface DsPlacement {
  entry: SessionDsLog;
  log: DsLog;
  events: DsEvents;
  offset: number;
  alignment: DsAlignment;
}

interface Session {
  id: string;
  file: SignalLogFile;
  version: string;
  dataLog: LogSignalSource | null;
  placements: Placement[];
  dsLogs: DsPlacement[];
  start: number;
  end: number;
  // Found once, when first asked for.
  events?: FoundEvents;
}

// The sessions open for reading, most recently used last. A few at once, so
// reports on several logs can be made side by side without each reloading
// its log; not many, since a data log is held in memory whole and a big one
// is tens of MB.
const openSessions = new Map<string, Session>();
const keptSessions = 3;

async function fileVersion(path: string): Promise<string> {
  const stat = await fs.stat(path).catch(() => null);
  return stat ? `${stat.size}:${stat.mtimeMs}` : '';
}

// Sessions being opened: the window asks for a session's catalog, status and
// signals at once, and they share one open.
const opening = new Map<string, Promise<Session>>();

function openSession(settings: Settings, id: string): Promise<Session> {
  let promise = opening.get(id);
  if (!promise) {
    promise = openSessionOnce(settings, id).finally(() => opening.delete(id));
    opening.set(id, promise);
  }
  return promise;
}

async function openSessionOnce(settings: Settings, id: string): Promise<Session> {
  const directory = dataDirectory(settings);
  const absolute = (localPath: string) => join(directory, ...localPath.split('/'));

  // The session already open, its data log unchanged: every read lands here.
  const kept = openSessions.get(id);
  if (kept && (!kept.file.localPath || kept.version === (await fileVersion(absolute(kept.file.localPath))))) {
    openSessions.delete(id);
    openSessions.set(id, kept);
    return kept;
  }

  // Only logs in the data folder: the window names the session, and it
  // mustn't be able to have any file on the computer read.
  const file = (await signalLogs(settings)).find((session) => session.id === id);
  if (!file) throw new Error('That log is not in the data folder.');

  let dataLog: LogSignalSource | null = null;
  if (file.localPath) {
    const bytes = await fs.readFile(absolute(file.localPath));
    // Its older version, if it changed, goes.
    openSessions.delete(id);
    dataLog = new LogSignalSource(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }

  const placements: Placement[] = [];
  for (const entry of file.hoots) {
    let hoot = hootLogs.get(entry.localPath);
    if (!hoot) {
      const cache = hootCacheOf(directory, entry.localPath);
      hoot = new HootLog(owlet(), entry.localPath, absolute(entry.localPath), cache, (percent, signals) => {
        progress = percent === null ? null : { label: hoot!.label, signals, percent };
      });
      hootLogs.set(entry.localPath, hoot);
    }
    if (hoot.state !== 'ready') await hoot.open(settings.ctreLicenseAccepted);
    placements.push({ hoot, alignment: null, offset: null, aligned: Promise.resolve() });
  }

  const readBytes = async (localPath: string) => {
    const bytes = await fs.readFile(absolute(localPath));
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  };
  const dsLogs: DsPlacement[] = [];
  for (const entry of file.dsLogs) {
    const log = readDsLog(await readBytes(entry.localPath));
    const none: DsEvents = { messages: [], match: null };
    const events = entry.eventsPath
      ? await readBytes(entry.eventsPath).then((bytes) => readDsEvents(bytes, log.startedAt)).catch(() => none)
      : none;
    dsLogs.push({ entry, log, events, ...alignDsLog(dataLog, file, log) });
  }

  const session: Session = {
    id,
    file,
    version: file.localPath ? await fileVersion(absolute(file.localPath)) : '',
    dataLog,
    placements,
    dsLogs,
    start: 0,
    // A Driver Station log on its own is the timeline. With a data log it
    // isn't let stretch it: it runs while the Driver Station's open, often
    // many minutes either side.
    end: dataLog ? dataLog.lastTime - dataLog.firstTime : placements.length === 0 ? Math.max(0, ...dsLogs.map((ds) => ds.log.duration)) : 0
  };
  for (const placement of placements) placement.aligned = align(session, placement).catch(() => {});
  openSessions.delete(id);
  openSessions.set(id, session);
  while (openSessions.size > keptSessions) openSessions.delete(openSessions.keys().next().value!);
  return session;
}

// --- Lining Hoot logs up ---

// The data log's enable signals, in the forms robot code logs them: WPILib's
// DriverStation log (DS:enabled), AdvantageKit (DriverStation/Enabled), and
// code's own (isAutoEnabled, isTeleopEnabled, ...).
const enablePattern = /(^|[/:])(ds:)?enabled$|driverstation\/enabled$|is(auto|teleop|test)?enabled$/i;

// When a boolean signal first turned true, in its series' times.
function firstTrue(series: SignalSeries | null): number | null {
  if (!series) return null;
  const values = series.values as Float64Array;
  for (let i = 0; i < values.length; i++) if (values[i] === 1) return series.times[i];
  return null;
}

function dataLogFirstEnable(source: LogSignalSource): number | null {
  let first: number | null = null;
  for (const signal of source.catalog()) {
    if (signal.kind !== 'boolean' || signal.count === 0 || !enablePattern.test(signal.key)) continue;
    const at = firstTrue(source.read(signal.key));
    if (at !== null && (first === null || at < first)) first = at;
  }
  return first;
}

async function hootFirstEnable(hoot: HootLog): Promise<number | null> {
  const signal = hoot.signals.find((s) => s.name === 'RobotEnable');
  if (!signal) return null;
  return firstTrue((await hoot.sourceFor(signal.id)).read('RobotEnable'));
}

// Enables more than this apart from what the file names say are taken to be
// different enables (one log started after the first), and the names win.
const maxDisagreementSeconds = 120;

// Seconds to add to a Driver Station log's times: by the first enable in
// both, if that's near what the clocks say; otherwise by the clocks.
function alignDsLog(dataLog: LogSignalSource | null, file: SignalLogFile, log: DsLog): { offset: number; alignment: DsAlignment } {
  if (!dataLog) return { offset: 0, alignment: 'base' };
  const baseStart = dataLog.startedAt ? Date.parse(dataLog.startedAt) : parseLogName(file.name).recorded?.getTime() ?? null;
  const byClock = baseStart === null ? null : (log.startedAt - baseStart) / 1000;
  const dataEnable = dataLogFirstEnable(dataLog);
  const dsEnable = log.modes.find((m) => m.mode !== 'disabled')?.time ?? null;
  const byEnable = dataEnable !== null && dsEnable !== null ? dataEnable - dsEnable : null;
  if (byEnable !== null && (byClock === null || Math.abs(byEnable - byClock) <= maxDisagreementSeconds)) return { offset: byEnable, alignment: 'enable' };
  return { offset: byClock ?? 0, alignment: 'clock' };
}

async function align(session: Session, placement: Placement) {
  const { hoot } = placement;
  const hootStart = hootStartTime(hoot.localPath.slice(hoot.localPath.lastIndexOf('/') + 1));
  const base = session.placements[0];

  if (!session.dataLog && placement === base) {
    placement.alignment = 'base';
    placement.offset = 0;
  } else if (hoot.state === 'ready') {
    // Seconds to add to the Hoot log's times, from the file names: when it
    // started, against when the session's timeline starts.
    const baseStart = session.dataLog
      ? (session.dataLog.startedAt ? new Date(session.dataLog.startedAt) : parseLogName(session.file.name).recorded)
      : hootStartTime(base.hoot.localPath.slice(base.hoot.localPath.lastIndexOf('/') + 1));
    const byName = hootStart && baseStart ? (hootStart.getTime() - baseStart.getTime()) / 1000 : null;

    const hootEnable = await hootFirstEnable(hoot).catch(() => null);
    let otherEnable: number | null = null;
    if (session.dataLog) {
      otherEnable = dataLogFirstEnable(session.dataLog);
    } else {
      await base.aligned;
      const baseEnable = base.hoot.state === 'ready' ? await hootFirstEnable(base.hoot).catch(() => null) : null;
      otherEnable = baseEnable;
    }
    const byEnable = hootEnable !== null && otherEnable !== null ? otherEnable - hootEnable : null;

    if (byEnable !== null && (byName === null || Math.abs(byEnable - byName) <= maxDisagreementSeconds)) {
      placement.alignment = 'enable';
      placement.offset = byEnable;
    } else {
      placement.alignment = 'name';
      placement.offset = byName ?? 0;
    }
  } else {
    return;
  }

  // The session's span grows to take in the Hoot log.
  const robotEnable = hoot.signals.find((s) => s.name === 'RobotEnable');
  if (robotEnable) {
    const source = await hoot.sourceFor(robotEnable.id).catch(() => null);
    if (source) {
      session.start = Math.min(session.start, placement.offset! + source.firstTime);
      session.end = Math.max(session.end, placement.offset! + source.lastTime);
    }
  }
}

// --- Catalog ---

// owlet's types aren't known until a signal is exported: a guess from the
// name, put right by the first read.
function hootKind(name: string): SignalKind {
  if (/(^|\/)(Sticky)?Fault_|IsProLicensed$|MotionMagicIs|MotionMagicAt|^DS:Is|BusIsUp$|^RobotEnable$/.test(name)) return 'boolean';
  if (/Mode$|ControlMode|BridgeOutput|ConnectedMotor|MotorOutputStatus|Polarity$|Limit$|DeviceEnable$|\/RobotEnable$|AllianceStation|Health$/.test(name)) return 'string';
  return 'number';
}

function hootCatalog(hoot: HootLog): SignalInfo[] {
  return hoot.signals.map((signal) => {
    const key = `${hoot.label}/${signal.name}`;
    const { subsystem, rest } = splitName(signal.name);
    const kind = hootKind(signal.name);
    return {
      key,
      name: rest.join(' / '),
      subsystem: subsystem ? `${hoot.label} ${subsystem}` : hoot.label,
      type: '',
      kind,
      unit: kind === 'number' ? unitFor(signal.name, {}) : '',
      count: -1,
      source: 'CTRE Hoot'
    };
  });
}

// DogLog queues values for a background thread to write. When the queue is
// full, new values are dropped, and DogLog logs how full it is: each time
// its free space reached 0 is a stretch where values are missing.
function dogLogWarnings(source: LogSignalSource): string[] {
  const key = source.catalog().find((s) => s.key.endsWith('DogLog/QueueRemainingCapacity'))?.key;
  const free = key ? source.read(key) : null;
  if (!free || !free.stats) return [];
  const values = free.values as Float64Array;
  let times = 0;
  for (let i = 0; i < values.length; i++) if (values[i] === 0 && (i === 0 || values[i - 1] !== 0)) times += 1;
  if (times === 0) return [];
  return [
    `DogLog's queue filled up ${times === 1 ? 'once' : `${times} times`} (it holds ${free.stats.max}), so some values were dropped then. ` +
      "A bigger logEntryQueueCapacity in the robot code's DogLogOptions stops this."
  ];
}

function dsCatalog(ds: DsPlacement): SignalInfo[] {
  return ds.log.source.catalog().map((signal) => ({ ...signal, key: `${ds.entry.label}/${signal.key}`, subsystem: ds.entry.label }));
}

export async function openSignalLog(settings: Settings, id: string): Promise<SignalLogSummary> {
  if (isLiveId(id)) return openLive(id);
  const session = await openSession(settings, id);
  const signals = [
    ...(session.dataLog?.catalog() ?? []),
    ...session.placements.flatMap((placement) => (placement.hoot.state === 'ready' ? hootCatalog(placement.hoot) : [])),
    ...session.dsLogs.flatMap(dsCatalog)
  ];
  const dsLogs: DsLogStatus[] = session.dsLogs.map((ds) => ({
    localPath: ds.entry.localPath,
    label: ds.entry.label,
    size: ds.entry.size,
    alignment: ds.alignment,
    offset: ds.offset,
    match: ds.events.match,
    truncated: ds.log.truncated
  }));
  // A Driver Station log on its own says when it started.
  const alone = !session.dataLog && session.placements.length === 0 ? session.dsLogs[0] : undefined;
  return {
    id,
    duration: session.end - session.start,
    startedAt: session.dataLog?.startedAt ?? (alone ? new Date(alone.log.startedAt).toISOString() : null),
    truncated: session.dataLog?.truncated ?? alone?.log.truncated ?? false,
    signals,
    groups: groupSignals(signals),
    warnings: session.dataLog ? dogLogWarnings(session.dataLog) : [],
    dsLogs
  };
}

export async function hootStatus(settings: Settings, id: string): Promise<HootSessionStatus> {
  const session = await openSession(settings, id);
  const hoots: HootLogStatus[] = session.placements.map(({ hoot, alignment, offset }) => ({
    localPath: hoot.localPath,
    bus: hoot.bus,
    label: hoot.label,
    size: session.file.hoots.find((h) => h.localPath === hoot.localPath)?.size ?? 0,
    state: hoot.state === 'ready' && offset === null ? 'opening' : hoot.state,
    message: hoot.message,
    pro: hoot.pro,
    alignment,
    offset
  }));
  return { hoots, progress, start: session.start, end: session.end };
}

export async function readSignal(settings: Settings, id: string, key: string, range: SignalRange): Promise<SignalSeries | null> {
  if (isLiveId(id)) return readLive(id, key, range);
  const session = await openSession(settings, id);
  const ds = session.dsLogs.find((p) => key.startsWith(`${p.entry.label}/`));
  if (ds) {
    const series = ds.log.source.read(key.slice(ds.entry.label.length + 1), {
      ...range,
      start: range.start === undefined ? undefined : range.start - ds.offset,
      end: range.end === undefined ? undefined : range.end - ds.offset
    });
    return series && { ...series, key, times: series.times.map((t) => t + ds.offset) };
  }
  const placement = session.placements.find((p) => key.startsWith(`${p.hoot.label}/`));
  if (!placement) return session.dataLog?.read(key, range) ?? null;

  const { hoot } = placement;
  const name = key.slice(hoot.label.length + 1);
  const signal = hoot.signals.find((s) => s.name === name);
  if (!signal) return null;
  await placement.aligned;
  const offset = placement.offset ?? 0;

  const source = await hoot.sourceFor(signal.id);
  const entry = exportedName(name);
  const series = source.read(entry, {
    ...range,
    start: range.start === undefined ? undefined : range.start - offset,
    end: range.end === undefined ? undefined : range.end - offset
  });
  if (!series) return null;
  return {
    ...series,
    key,
    times: series.times.map((t) => t + offset),
    unit: source.catalog().find((s) => s.key === entry)?.unit ?? ''
  };
}

// Exports every Hoot signal of `keys` that isn't yet, together. Each export
// reads the whole Hoot log (minutes for an hour-long one), so a report's
// dozens of signals asked for at once take one read, not one each: asked
// for within moments of each other, they go in one batch. Signals that
// aren't Hoot signals, or can't be read, are left for reading to report.
export async function prepareSignals(settings: Settings, id: string, keys: string[]): Promise<void> {
  if (isLiveId(id)) return;
  const session = await openSession(settings, id);
  await Promise.all(session.placements.map(({ hoot }) => {
    const ids = keys
      .filter((key) => key.startsWith(`${hoot.label}/`))
      .map((key) => hoot.signals.find((s) => s.name === key.slice(hoot.label.length + 1))?.id)
      .filter((signal): signal is string => !!signal && !hoot.isExported(signal));
    return Promise.all(ids.map((signal) => hoot.sourceFor(signal).catch(() => null)));
  }));
}

// Every value over a span, decoded whole, for poses and lists of them. Only
// data logs and live sessions have structs; Hoot and Driver Station signals
// are read as series.
export async function readRecords(settings: Settings, id: string, key: string, range: SignalRange, max: number): Promise<SignalRecords | null> {
  if (isLiveId(id)) return readLiveRecords(id, key, range, max);
  const session = await openSession(settings, id);
  if (session.dsLogs.some((p) => key.startsWith(`${p.entry.label}/`))) return null;
  if (session.placements.some((p) => key.startsWith(`${p.hoot.label}/`))) return null;
  return session.dataLog?.records(key, range, max) ?? null;
}

// Many signals' values at one time, for the signal list. Hoot signals not
// exported yet are left out (null): exporting is slow, and the list shows
// hundreds of signals.
export const maxValueKeys = 500;

export async function readValues(settings: Settings, id: string, keys: string[], time: number): Promise<Record<string, SignalValue>> {
  const session = isLiveId(id) ? null : await openSession(settings, id);
  const out: Record<string, SignalValue> = {};
  for (const key of keys.slice(0, maxValueKeys)) {
    const placement = session?.placements.find((p) => key.startsWith(`${p.hoot.label}/`));
    if (placement) {
      const signal = placement.hoot.signals.find((s) => s.name === key.slice(placement.hoot.label.length + 1));
      if (!signal || !placement.hoot.isExported(signal.id)) {
        out[key] = null;
        continue;
      }
    }
    const series = await readSignal(settings, id, key, { start: time, end: time }).catch(() => null);
    out[key] = series ? valueAtTime(series, time) : null;
  }
  return out;
}

// --- Events ---

interface FoundEvents {
  dataLog: LogEvent[];
  // From Driver Station logs, on the session's timeline.
  ds: LogEvent[];
  // From the data log, if it says; Hoot logs' RobotMode once read.
  modes: { changes: ModeChange[]; key: string | null } | null;
  hoot: LogEvent[];
  fmsAttached: boolean;
  // Looking through the Hoot logs, until done.
  scanning: boolean;
}

// What's exported from each Hoot log to find events: every device's
// faults (not the sticky ones: those stay set after the fault's gone), the
// robot's mode, and whether the Driver Station and CAN bus were there.
const hootEventSignal = /\/Fault_|^RobotMode$|^DS:IsDSAttached$|^DS:IsFMSAttached$|^CANBusIsUp$/;

async function scanHoots(session: Session, found: FoundEvents) {
  for (const placement of session.placements) {
    await placement.aligned;
    const { hoot } = placement;
    if (hoot.state !== 'ready') continue;
    const offset = placement.offset ?? 0;
    const end = session.end - offset;
    const wanted = hoot.signals.filter((s) => hootEventSignal.test(s.name));
    // Together, so owlet reads the log once for all of them.
    const read = await Promise.all(wanted.map(async (signal) => {
      const source = await hoot.sourceFor(signal.id).catch(() => null);
      return { signal, series: source?.read(exportedName(signal.name)) ?? null };
    }));
    const shifted = (spans: { start: number; end: number | null }[]) =>
      spans.map((span) => ({ start: span.start + offset, end: span.end === null ? null : span.end + offset }));
    for (const { signal, series } of read) {
      if (!series) continue;
      const key = `${hoot.label}/${signal.name}`;
      if (signal.name.includes('/Fault_')) {
        const spans = shifted(spansWhere(series, (v) => v > 0, end));
        found.hoot.push(...eventsFrom('fault', faultSeverity(signal.name), faultTitle(signal.name), spans, {
          key,
          detail: (count) => `${hoot.label}${count > 1 ? `, ${count} times` : ''}`
        }));
      } else if (signal.name === 'RobotMode' && !found.modes) {
        const changes = hootModes(series, offset);
        if (changes) found.modes = { changes, key };
      } else if (signal.name === 'DS:IsFMSAttached') {
        found.fmsAttached ||= (series.values as Float64Array).some((v) => v === 1);
      } else if (signal.name === 'DS:IsDSAttached') {
        // Only once it had been there: before that, it's the robot starting up.
        const first = (series.values as Float64Array).findIndex((v) => v === 1);
        if (first === -1) continue;
        const after = { ...series, times: series.times.slice(first), values: (series.values as Float64Array).slice(first) };
        found.hoot.push(...eventsFrom('network', 'error', 'Driver Station disconnected', shifted(spansWhere(after, (v) => v === 0, end)), { key }));
      } else if (signal.name === 'CANBusIsUp') {
        found.hoot.push(...eventsFrom('can', 'error', `${hoot.label}: CAN bus down`, shifted(spansWhere(series, (v) => v === 0, end)), { key }));
      }
    }
  }
}

const shiftedEvents = (events: LogEvent[], offset: number) =>
  events.map((event) => ({ ...event, start: event.start + offset, end: event.end === null ? null : event.end + offset }));

function findEvents(session: Session): FoundEvents {
  const dataLog = session.dataLog;
  const robotConsole = !!dataLog && hasConsole(dataLog);
  const ds = session.dsLogs.flatMap((placement) => shiftedEvents(
    dsLogEvents(placement.log, placement.events.messages, { robotConsole, key: (name) => `${placement.entry.label}/${name}` }),
    placement.offset
  ));
  // The Driver Station's own record wins (in the data log, or its own log);
  // robot code's flags only if there's nothing better once the Hoot logs
  // are read.
  const firstDs = session.dsLogs[0];
  const modes = dataLog && hasDriverStationEnable(dataLog)
    ? { changes: dataLogModes(dataLog)!, key: null }
    : firstDs
      ? { changes: firstDs.log.modes.map((m) => ({ ...m, time: m.time + firstDs.offset })), key: `${firstDs.entry.label}/Mode` }
      : null;
  const found: FoundEvents = {
    dataLog: dataLog ? dataLogEvents(dataLog) : [],
    ds,
    modes,
    hoot: [],
    fmsAttached: false,
    scanning: session.placements.length > 0
  };
  const fallback = () => {
    const changes = dataLog ? dataLogModes(dataLog) : null;
    if (!found.modes && changes) found.modes = { changes, key: null };
  };
  if (found.scanning) {
    scanHoots(session, found).catch(() => {}).finally(() => {
      fallback();
      found.scanning = false;
    });
  } else {
    fallback();
  }
  return found;
}

export async function sessionEvents(settings: Settings, id: string): Promise<SessionEvents> {
  if (isLiveId(id)) return { events: [], phases: [], enabled: [], notes: [], pending: '' };
  const session = await openSession(settings, id);
  const found = (session.events ??= findEvents(session));
  // While the Hoot logs are read, robot code's own flags stand in.
  const modes = found.modes ?? (found.scanning && session.dataLog ? { changes: dataLogModes(session.dataLog) ?? [], key: null } : null);
  const inMatch = !!session.file.match || found.fmsAttached || session.dsLogs.some((ds) => ds.events.match);
  const inSpan = (event: LogEvent) => event.start <= session.end && (event.end ?? event.start) >= session.start;
  const phases: MatchPhase[] = modes ? matchPhases(modes.changes, session.end, inMatch) : [];
  const enabled = modes ? enabledSpans(modes.changes, session.end) : [];
  const events = [
    ...(modes ? modeEvents(modes.changes, modes.key) : []).filter(inSpan),
    ...found.dataLog,
    ...found.hoot,
    // A Driver Station log runs longer than the rest: only what's in the span.
    ...found.ds.filter(inSpan)
  ].sort((a, b) => a.start - b.start);
  return {
    events,
    phases,
    enabled,
    notes: await loadNotes(settings, id),
    pending: found.scanning ? 'Looking for device faults in the Hoot logs…' : ''
  };
}
