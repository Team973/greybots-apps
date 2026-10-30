import type { OffloadedFiles } from '@shared/ipc';
import {
  driverStationExtensions,
  driverStationLogDirectory,
  robotFolderName,
  robotLogLocations,
  type OffloadRunSummary,
  type OffloadStatus,
  type RobotLogLocation
} from '@shared/offload';
import { robotAddresses } from '@shared/robot-address';
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
const recentFileCount = 200;

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

// The first address where the robot answers on the SSH port, or null.
async function findRobot(settings: Settings): Promise<string | null> {
  const hosts = await Promise.all(
    robotAddresses(settings).map(async ({ host }) => ((await checkPort(host, 22, 'SSH')).open ? host : null))
  );
  return hosts.find((host) => host !== null) ?? null;
}

function addResult(summary: OffloadRunSummary, result: OffloadResult) {
  summary.copied += result.copied;
  summary.skipped += result.skipped;
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
    bytes: 0,
    errors: []
  };
  const onProgress = (progress: OffloadStatus['current']) => { status.current = progress; };

  try {
    const settings = await loadSettings();
    const directory = dataDirectory(settings);
    await ensureStorageLayout(directory);
    const robot = robotFolderName(settings);

    const robotHost = host === undefined ? await findRobot(settings) : host;
    status.robotHost = robotHost;
    if (robotHost) {
      summary.host = robotHost;
      let reader: SftpReader | null = null;
      try {
        reader = await SftpReader.connect(robotHost);
        addResult(summary, await offloadLogs(directory, { reader, origin: 'robot', robot, locations: robotLogLocations }, onProgress));
      } catch (error) {
        summary.errors.push(`${reader ? 'Offload from' : "Couldn't log in to"} the robot at ${robotHost}: ${(error as Error).message}`);
      } finally {
        reader?.close();
      }
    } else if (!automatic) {
      summary.errors.push('No robot found. Check connection on the Overview page shows where it was looked for.');
    }

    if (process.platform === 'win32') {
      const reader = new LocalReader();
      addResult(summary, await offloadLogs(directory, { reader, origin: 'local', robot, locations: driverStationLocations }, onProgress));
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

export async function offloadedFiles(settings: Settings): Promise<OffloadedFiles> {
  const files = Object.values((await loadIndex(dataDirectory(settings))).files);
  files.sort((a, b) => b.modified.localeCompare(a.modified));
  return { total: files.length, recent: files.slice(0, recentFileCount) };
}
