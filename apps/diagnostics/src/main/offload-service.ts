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
import { robotAddresses } from '@shared/robot-address';
import type { Settings } from '@shared/settings';
import { findRobot } from './offload/find-robot';
import { loadIndex } from './offload/offload-index';
import { offloadLogs, openIndexStore, type OffloadResult } from './offload/offload';
import { LocalReader, SftpReader } from './offload/readers';
import { afterNewLogs, logIdsNow } from './reports';
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
  stage: 'idle',
  looking: [],
  jobs: [],
  lastRun: null
};

// Where the robot last answered when the watcher looked, and when: a
// download asked for right after goes straight there.
let lastFound: { host: string; at: number } | null = null;
const lastFoundMs = 10_000;

export function offloadStatus(): OffloadStatus {
  return structuredClone(status);
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
  if (status.running) return 'A download is already running.';
  status.running = true;
  status.stage = 'connecting';
  status.looking = [];
  status.jobs = [];

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
  // Each job's progress has its own row, in the order the jobs started.
  const onProgress = (progress: OffloadStatus['jobs'][number]) => {
    const at = status.jobs.findIndex((job) => job.label === progress.label);
    if (at === -1) status.jobs.push(progress);
    else status.jobs[at] = progress;
  };
  // The logs there before, so the pipelines run on the new ones after. A
  // scan of the whole data folder, so it goes on while the robot is found.
  let before: Promise<Set<string> | null> = Promise.resolve(null);

  try {
    const settings = await loadSettings();
    before = logIdsNow(settings).catch(() => null);
    const directory = dataDirectory(settings);
    await ensureStorageLayout(directory);
    const robot = robotFolderName(settings);
    const since = settings.offloadDays > 0 ? new Date(Date.now() - settings.offloadDays * 24 * 60 * 60 * 1000) : null;
    // One index for both jobs, so neither writes over the other's entries.
    const store = await openIndexStore(directory);

    // Driver Station logs are on this computer: they don't wait for the robot.
    const local = process.platform === 'win32'
      ? offloadLogs(directory, { label: 'Driver Station logs', reader: new LocalReader(), origin: 'local', robot, locations: driverStationLocations, since }, onProgress, new Date(), store)
        .then((result) => addResult(summary, result), (error: Error) => { summary.errors.push(`Driver Station logs: ${error.message}`); })
      : Promise.resolve();

    const fromRobot = (async () => {
      const recent = lastFound && Date.now() - lastFound.at < lastFoundMs ? lastFound.host : undefined;
      status.looking = robotAddresses(settings).map((address) => address.host);
      const robotHost = host !== undefined ? host : recent ?? (await findRobot(settings));
      status.looking = [];
      status.robotHost = robotHost;
      if (!robotHost) {
        status.stage = 'pulling';
        if (!automatic) summary.errors.push('No robot found. Check connection on the Download page shows where it was looked for.');
        return;
      }
      summary.host = robotHost;
      let reader: SftpReader | null = null;
      try {
        reader = await SftpReader.connect(robotHost);
        status.stage = 'pulling';
        const job = { label: 'From the robot', reader, origin: 'robot' as const, robot, locations: robotLogLocations, since };
        addResult(summary, await offloadLogs(directory, job, onProgress, new Date(), store));
      } catch (error) {
        status.stage = 'pulling';
        summary.errors.push(`${reader ? 'Download from' : "Couldn't log in to"} the robot at ${robotHost}: ${(error as Error).message}`);
      } finally {
        reader?.close();
      }
    })();

    await Promise.all([fromRobot, local]);
    await store.writer.flush();
  } catch (error) {
    summary.errors.push((error as Error).message);
  } finally {
    summary.finishedAt = new Date().toISOString();
    status.lastRun = summary;
    status.stage = 'idle';
    status.looking = [];
    status.jobs = [];
    status.running = false;
    if (summary.copied > 0) {
      before.then((ids) => (ids ? afterNewLogs(ids, 'offload') : undefined)).catch(() => {});
    }
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
    lastFound = host ? { host, at: Date.now() } : null;
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
