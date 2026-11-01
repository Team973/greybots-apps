import { app } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import { hootBus, hootBusLabel, hootStartTime, type HootAlignment, type HootLogStatus, type HootProgress, type OwletStatus } from '@shared/hoot';
import type { HootSessionStatus, SessionHoot, SignalLogFile, SignalLogSummary } from '@shared/ipc';
import { parseLogName, type MatchInfo } from '@shared/offload';
import type { Settings } from '@shared/settings';
import { groupSignals, splitName, unitFor, type SignalInfo, type SignalKind, type SignalRange, type SignalSeries } from '@shared/signals';
import { exportedName, HootLog } from './hoot/hoot-log';
import { hootCompliancy, Owlet } from './hoot/owlet';
import { loadIndex } from './offload/offload-index';
import { loadSettings, storeSettings } from './settings-store';
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

// Every recording in the data folder's logs/, newest first: data logs with
// the Hoot logs that go with them, and Hoot logs on their own. Offloaded
// or put there by hand; the offload index adds the match where it knows it.
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
    const name = path[path.length - 1];
    const bus = hootBus(name);
    return {
      localPath: path.join('/'),
      name,
      robot: robotOf(path),
      size,
      bus,
      label: `Hoot ${hootBusLabel(bus)}`,
      start: hootStartTime(name) ?? modified,
      match: parseLogName(name).match
    };
  });

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
    return {
      id: log.localPath,
      localPath: log.localPath,
      name: log.name,
      robot: log.robot,
      size: log.size + logHoots.reduce((total, hoot) => total + hoot.size, 0),
      recorded: log.start.toISOString(),
      match: log.match,
      hoots: logHoots
    };
  });

  // Hoot logs with no data log: one session per robot and start time
  // (the rio and CANivore logs of one run start together).
  alone.sort((a, b) => a.start.getTime() - b.start.getTime());
  const groups: (typeof alone)[] = [];
  for (const hoot of alone) {
    const group = groups.find((g) => g[0].robot === hoot.robot && Math.abs(g[0].start.getTime() - hoot.start.getTime()) <= pairingWindowMs);
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
      recorded: group[0].start.toISOString(),
      match: group.find((hoot) => hoot.match)?.match ?? null,
      hoots: group.map(({ localPath, name, bus, label, size }) => ({ localPath, name, bus, label, size }))
    });
  }

  sessions.sort((a, b) => b.recorded.localeCompare(a.recorded));
  return sessions;
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

// Hoot logs, by path: their scans and exports are worth keeping across
// sessions (the same log can be looked at again).
const hootLogs = new Map<string, HootLog>();
let progress: HootProgress | null = null;

// So Hoot logs that couldn't be read are tried again, with the licence or
// owlet there is now. Those already being read are left alone: they may be
// part way through an export.
function forgetHootLogs() {
  for (const [path, hoot] of hootLogs) if (hoot.state !== 'ready') hootLogs.delete(path);
  open = null;
}

interface Placement {
  hoot: HootLog;
  alignment: HootAlignment | null;
  offset: number | null;
  // Resolves once the offset is known.
  aligned: Promise<void>;
}

interface Session {
  id: string;
  file: SignalLogFile;
  version: string;
  dataLog: LogSignalSource | null;
  placements: Placement[];
  start: number;
  end: number;
}

// The session open for reading. One at a time: a data log is held in
// memory whole, and a big one is tens of MB.
let open: Session | null = null;

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
  if (open?.id === id && (!open.file.localPath || open.version === (await fileVersion(absolute(open.file.localPath))))) return open;

  // Only logs in the data folder: the window names the session, and it
  // mustn't be able to have any file on the computer read.
  const file = (await signalLogs(settings)).find((session) => session.id === id);
  if (!file) throw new Error('That log is not in the data folder.');

  let dataLog: LogSignalSource | null = null;
  if (file.localPath) {
    const bytes = await fs.readFile(absolute(file.localPath));
    open = null;
    dataLog = new LogSignalSource(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }

  const placements: Placement[] = [];
  for (const entry of file.hoots) {
    let hoot = hootLogs.get(entry.localPath);
    if (!hoot) {
      // Short on purpose: owlet can't write past Windows' 260-character path
      // limit, and Hoot log names are long.
      const cache = join(directory, 'results', 'hoot', createHash('sha1').update(entry.localPath).digest('hex').slice(0, 16));
      hoot = new HootLog(owlet(), entry.localPath, absolute(entry.localPath), cache, (percent, signals) => {
        progress = percent === null ? null : { label: hoot!.label, signals, percent };
      });
      hootLogs.set(entry.localPath, hoot);
    }
    if (hoot.state !== 'ready') await hoot.open(settings.ctreLicenseAccepted);
    placements.push({ hoot, alignment: null, offset: null, aligned: Promise.resolve() });
  }

  const session: Session = {
    id,
    file,
    version: file.localPath ? await fileVersion(absolute(file.localPath)) : '',
    dataLog,
    placements,
    start: 0,
    end: dataLog ? dataLog.lastTime - dataLog.firstTime : 0
  };
  for (const placement of placements) placement.aligned = align(session, placement).catch(() => {});
  open = session;
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

export async function openSignalLog(settings: Settings, id: string): Promise<SignalLogSummary> {
  const session = await openSession(settings, id);
  const signals = [
    ...(session.dataLog?.catalog() ?? []),
    ...session.placements.flatMap((placement) => (placement.hoot.state === 'ready' ? hootCatalog(placement.hoot) : []))
  ];
  return {
    id,
    duration: session.end - session.start,
    startedAt: session.dataLog?.startedAt ?? null,
    truncated: session.dataLog?.truncated ?? false,
    signals,
    groups: groupSignals(signals),
    warnings: session.dataLog ? dogLogWarnings(session.dataLog) : []
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
  const session = await openSession(settings, id);
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
