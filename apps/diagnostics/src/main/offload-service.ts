import type { OffloadedFiles, OffloadedFilesQuery } from '@shared/ipc';
import {
  driverStationExtensions,
  driverStationLogDirectory,
  parseLogName,
  robotFolderName,
  robotLogLocations,
  type OffloadedFile,
  type OffloadRunSummary,
  type OffloadStatus,
  type RobotLogLocation
} from '@shared/offload';
import { robotAddresses, usbAddress } from '@shared/robot-address';
import type { Settings } from '@shared/settings';
import { checkPort } from './connection-check';
import { loadIndex } from './offload/offload-index';
import { offloadLogs, type OffloadResult } from './offload/offload';
import { LocalReader, SftpReader } from './offload/readers';
import { loadSettings } from './settings-store';
import { dataDirectory, ensureStorageLayout } from './storage';

// How often to look for the robot. Each look is one SSH port check per
// address, at once, so it costs at most the connection timeout.
const watchIntervalMs = 10_000;

// How many offloaded files the window is sent: the newest.

const driverStationLocations: RobotLogLocation[] = [
  {
    source: 'driver-station',
    label: 'Driver Station logs',
    directories: [driverStationLogDirectory],
    extensions: driverStationExtensions,
    depth: 1
  }
];

const status: OffloadStatus = {
  running: false,
  autoOffload: true,
  robotHost: null,
  current: null,
  lastRun: null
};

export function offloadStatus(): OffloadStatus {
  return structuredClone(status);
}

// Where the robot answers on the SSH port, or null. USB if it answers
// there: a cable is faster and steadier than the radio. Otherwise the first
// address, in the order they're listed.
async function findRobot(settings: Settings): Promise<string | null> {
  const hosts = await Promise.all(
    robotAddresses(settings).map(async ({ host }) => ((await checkPort(host, 22, 'SSH')).open ? host : null))
  );
  if (hosts.includes(usbAddress)) return usbAddress;
  return hosts.find((host) => host !== null) ?? null;
}

function addResult(summary: OffloadRunSummary, result: OffloadResult) {
  summary.copied += result.copied;
  summary.skipped += result.skipped;
  summary.tooOld += result.tooOld;
  summary.bytes += result.bytes;
  summary.errors.push(...result.errors);
}

// Offloads from the robot, if it can be found, and from the Driver Station's
// folder, if this computer has one. Resolves to why it didn't start, or ''.
// `host` skips looking for the robot when the caller just found it.
export async function runOffload(automatic: boolean, host?: string | null): Promise<string> {
  if (status.running) return 'An offload is already running.';
  status.running = true;

  const summary: OffloadRunSummary = {
    startedAt: new Date().toISOString(),
    finishedAt: '',
    host: '',
    automatic,
    copied: 0,
    skipped: 0,
    tooOld: 0,
    bytes: 0,
    errors: []
  };
  const onProgress = (progress: OffloadStatus['current']) => { status.current = progress; };

  try {
    const settings = await loadSettings();
    const directory = dataDirectory(settings);
    await ensureStorageLayout(directory);
    const robot = robotFolderName(settings);
    const since = settings.offloadDays > 0 ? new Date(Date.now() - settings.offloadDays * 24 * 60 * 60 * 1000) : null;

    const robotHost = host === undefined ? await findRobot(settings) : host;
    status.robotHost = robotHost;
    if (robotHost) {
      summary.host = robotHost;
      let reader: SftpReader | null = null;
      try {
        reader = await SftpReader.connect(robotHost);
        const job = { label: 'From the robot', reader, origin: 'robot' as const, robot, locations: robotLogLocations, since };
        addResult(summary, await offloadLogs(directory, job, onProgress));
      } catch (error) {
        summary.errors.push(`${reader ? 'Offload from' : "Couldn't log in to"} the robot at ${robotHost}: ${(error as Error).message}`);
      } finally {
        reader?.close();
      }
    } else if (!automatic) {
      summary.errors.push('No robot found. Check connection on the Offload page shows where it was looked for.');
    }

    if (process.platform === 'win32') {
      const reader = new LocalReader();
      const job = { label: 'Driver Station logs', reader, origin: 'local' as const, robot, locations: driverStationLocations, since };
      addResult(summary, await offloadLogs(directory, job, onProgress));
    }
  } catch (error) {
    summary.errors.push((error as Error).message);
  } finally {
    summary.finishedAt = new Date().toISOString();
    status.lastRun = summary;
    status.current = null;
    status.running = false;
  }
  return '';
}

// Looks for the robot every few seconds and, when it appears and automatic
// offload is on, offloads from it. Only on appearing: a robot that stays
// connected isn't offloaded from again until it goes and comes back, or
// someone asks.
export function watchForRobot() {
  const look = async () => {
    const settings = await loadSettings();
    status.autoOffload = settings.autoOffload;
    if (status.running) return;

    const host = await findRobot(settings);
    const appeared = host !== null && status.robotHost === null;
    status.robotHost = host;
    if (appeared && settings.autoOffload) await runOffload(true, host);
  };

  const tick = () => look().catch((error) => console.error(error));
  tick();
  setInterval(tick, watchIntervalMs);
}

const matchTypeOrder = { practice: 0, qualification: 1, elimination: 2 };

// By match: event, then practice, qualification, elimination, then number
// and .N; files from no match after all of those. Then by time.
function byMatch(a: OffloadedFile, b: OffloadedFile): number {
  if (!a.match || !b.match) return (a.match ? 0 : 1) - (b.match ? 0 : 1);
  return a.match.event.localeCompare(b.match.event) ||
    matchTypeOrder[a.match.type] - matchTypeOrder[b.match.type] ||
    a.match.number - b.match.number ||
    (a.match.suffix ?? 0) - (b.match.suffix ?? 0);
}

export async function offloadedFiles(settings: Settings, query: OffloadedFilesQuery): Promise<OffloadedFiles> {
  // One row per file here: a file offloaded and also imported is one file.
  const byPath = new Map<string, OffloadedFile>();
  for (const file of Object.values((await loadIndex(dataDirectory(settings))).files)) {
    if (byPath.has(file.localPath)) continue;
    byPath.set(file.localPath, {
      ...file,
      // Files offloaded before the app could read their match from the name.
      match: file.match ?? parseLogName(file.localPath.slice(file.localPath.lastIndexOf('/') + 1)).match
    });
  }
  const files = [...byPath.values()];
  const direction = query.descending ? -1 : 1;
  files.sort((a, b) => {
    const order = query.sort === 'match' ? byMatch(a, b) : 0;
    // Files from no match stay last either way.
    if (order !== 0 && (!a.match || !b.match)) return order;
    return direction * (order || a.modified.localeCompare(b.modified));
  });
  const pageSize = Math.max(1, Math.min(100, Math.trunc(query.pageSize) || 10));
  const page = Math.max(0, Math.trunc(query.page) || 0);
  return { total: files.length, files: files.slice(page * pageSize, (page + 1) * pageSize) };
}
