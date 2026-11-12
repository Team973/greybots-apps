// Importing logs: files, folders or zip files from anywhere (a teammate's
// laptop, a USB drive, a download) filed into the archive where offload
// would have put them: logs/frc<team>/<day>/<source>/<file>.
//
// Which team's robot a log is from, in order of trust:
//   1. the path says (frc973, roboRIO-973-FRC, team973, in a folder or zip name);
//   2. the log does: addresses on a robot's network are 10.TE.AM.x, and robot
//      code logs its cameras' and the Driver Station's;
//   3. for a Hoot log, its CANivore was seen in that team's logs (here, or
//      in this import), or another Hoot log started with it (a robot's rio
//      and CANivore logs start together) and says;
//   4. otherwise, the team the person gave (Settings' to start with), and
//      the result says it was assumed.

import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { hootBus, hootStartTime } from '@shared/hoot';
import type { ImportedFile, ImportProgress, TeamSource } from '@shared/import';
import { parseLogName } from '@shared/offload';
import { logPathSegments, type LogSource } from '@shared/storage-layout';
import { indexKey, loadIndex, storeIndex } from '../offload/offload-index';
import { listZip, openZipEntry, type ZipEntry } from './zip';

const sources: Record<string, LogSource> = {
  '.wpilog': 'roborio',
  '.hoot': 'ctre-hoot',
  '.dslog': 'driver-station',
  '.dsevents': 'driver-station'
};
export const importExtensions = Object.keys(sources);

// What can be read for a team number (Hoot logs are binary through and through).
const searchedExtensions = new Set(['.wpilog', '.dslog', '.dsevents']);

const maxDepth = 8;
const earliestBelievableTime = Date.UTC(2020, 0, 1);

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
};

// One log found to import, wherever it is.
interface Candidate {
  name: string;
  // For people: where it was (`C:\...\logs.zip › logs/FRC_....wpilog`).
  from: string;
  // Its path from what was dropped on (the dropped folder's or zip's own
  // name), for a team in the path. Not the folders above that: a person's
  // own folders (C:\Users\me\team973\...) say nothing about the log.
  pathText: string;
  size: number;
  modified: Date;
  open(): Promise<Readable>;
}

// --- Finding logs in what was dropped ---

async function walk(directory: string, depth: number, out: string[]) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && depth < maxDepth) await walk(path, depth + 1, out);
    else if (entry.isFile()) out.push(path);
  }
}

async function candidatesIn(paths: string[], problems: string[], pathBase?: string): Promise<Candidate[]> {
  // Each file, with its path from what was dropped.
  const files: { path: string; shown: string }[] = [];
  for (const dropped of paths) {
    const stat = await fs.stat(dropped).catch(() => null);
    if (!stat) {
      problems.push(`${dropped}: not found.`);
      continue;
    }
    const inside: string[] = [];
    if (stat.isDirectory()) await walk(dropped, 0, inside);
    else inside.push(dropped);
    for (const path of inside) files.push({ path, shown: relative(pathBase ?? dirname(dropped), path).split(sep).join('/') });
  }

  const found: Candidate[] = [];
  for (const { path, shown } of files) {
    const extension = extensionOf(path);
    if (extension === '.zip') {
      let entries: ZipEntry[];
      try {
        entries = await listZip(path);
      } catch (error) {
        problems.push(`${basename(path)}: ${(error as Error).message}`);
        continue;
      }
      for (const entry of entries) {
        if (!sources[extensionOf(entry.name)]) continue;
        found.push({
          name: entry.name.slice(entry.name.lastIndexOf('/') + 1),
          from: `${path} › ${entry.name}`,
          pathText: `${shown}/${entry.name}`,
          size: entry.size,
          modified: entry.modified,
          open: () => openZipEntry(path, entry)
        });
      }
    } else if (sources[extension]) {
      const stat = await fs.stat(path);
      found.push({
        name: basename(path),
        from: path,
        pathText: shown,
        size: stat.size,
        modified: stat.mtime,
        open: async () => createReadStream(path)
      });
    }
  }
  return found;
}

// --- Which team ---

export function teamFromPath(path: string): number | null {
  for (const pattern of [/roborio-(\d{1,5})-frc/i, /(?:^|[^a-z])frc[_ -]?(\d{1,5})(?![\d])/i, /team[_ -]?#?(\d{1,5})(?![\d])/i]) {
    const found = pattern.exec(path);
    // frc2026 is more likely a season than team 2026; a robot's folder is
    // frc973, frc254, ...
    if (found && Number(found[1]) > 0 && !(/frc/i.test(found[0]) && /^20[1-4]\d$/.test(found[1]))) return Number(found[1]);
  }
  return null;
}

// Addresses on a robot's network (10.TE.AM.x) in a log's bytes, as team
// numbers, with how often each was seen.
export function teamsInText(text: string, counts = new Map<number, number>()): Map<number, number> {
  const pattern = /(?<![\d.])10\.(\d{1,3})\.(\d{1,2})\.(\d{1,3})(?![\d])|roborio-(\d{1,5})-frc/gi;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(text))) {
    let team: number;
    if (found[4]) {
      team = Number(found[4]);
    } else {
      const [te, am, host] = [Number(found[1]), Number(found[2]), Number(found[3])];
      if (te > 255 || host === 0 || host > 254) continue;
      team = te * 100 + am;
    }
    if (team > 0) counts.set(team, (counts.get(team) ?? 0) + 1);
  }
  return counts;
}

// The team most often seen in a file, reading it in pieces.
async function teamInFile(path: string): Promise<number | null> {
  const counts = new Map<number, number>();
  let carry = '';
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    const text = carry + (chunk as Buffer).toString('latin1');
    teamsInText(text.slice(0, Math.max(0, text.length - 24)), counts);
    // An address split across two pieces is found in the next.
    carry = text.slice(-24);
  }
  teamsInText(carry, counts);
  let best: number | null = null;
  for (const [team, count] of counts) if (best === null || count > counts.get(best)!) best = team;
  return best;
}

// CANivores seen in Hoot logs already here, and whose robot they were on.
async function knownCanivores(dataDirectory: string): Promise<Map<string, string>> {
  const known = new Map<string, string>();
  const logs = join(dataDirectory, 'logs');
  for (const robot of await fs.readdir(logs).catch(() => [] as string[])) {
    const files: string[] = [];
    await walk(join(logs, robot), 0, files);
    for (const file of files) {
      if (extensionOf(file) !== '.hoot') continue;
      const bus = hootBus(basename(file));
      if (bus !== 'rio' && !known.has(bus)) known.set(bus, robot);
    }
  }
  return known;
}

// --- When it was recorded ---

// The Driver Station names its logs by the computer's local time:
// 2026_10_17 17_38_12 Fri.dslog.
function driverStationTime(name: string): Date | null {
  const found = /^(\d{4})_(\d{2})_(\d{2}) (\d{2})_(\d{2})_(\d{2})/.exec(name);
  if (!found) return null;
  const [year, month, day, hour, minute, second] = found.slice(1).map(Number);
  return new Date(year, month - 1, day, hour, minute, second);
}

function recordedTime(candidate: Candidate, now: Date): Date {
  const named = parseLogName(candidate.name).recorded ?? hootStartTime(candidate.name) ?? driverStationTime(candidate.name);
  if (named) return named;
  return candidate.modified.getTime() >= earliestBelievableTime ? candidate.modified : now;
}

// --- Importing ---

export interface ImportOptions {
  // For logs that don't say which team's they are.
  fallbackTeam: number;
  onProgress(progress: ImportProgress): void;
  // Each file once it's filed (or not), for the transfer log.
  onFile?(file: ImportedFile): void;
  // What a team in the path is looked for from, when not what was dropped
  // (single files picked out of a USB drive's folders: the drive's root).
  pathBase?: string;
}

// Hoot logs started within this long of each other are from one robot: its
// rio and CANivore logs start together.
const sameStartMs = 2000;

interface Staged {
  candidate: Candidate;
  result: ImportedFile;
  part: string;
}

export async function importLogs(dataDirectory: string, paths: string[], options: ImportOptions): Promise<{ files: ImportedFile[]; problems: string[] }> {
  const problems: string[] = [];
  const candidates = await candidatesIn(paths, problems, options.pathBase);
  const canivores = await knownCanivores(dataDirectory);
  const index = await loadIndex(dataDirectory);
  const staging = join(dataDirectory, 'index', 'importing');
  await fs.mkdir(staging, { recursive: true });
  const now = new Date();

  const progress: ImportProgress = {
    filesDone: 0,
    filesTotal: candidates.length,
    bytesDone: 0,
    bytesTotal: candidates.reduce((total, c) => total + c.size, 0),
    current: ''
  };
  options.onProgress({ ...progress });

  try {
    // 1. Each copied in (a zip's files can only be read through once), and
    // its path and contents looked at for a team.
    const staged: Staged[] = [];
    for (const [i, candidate] of candidates.entries()) {
      progress.current = candidate.name;
      options.onProgress({ ...progress });
      const result: ImportedFile = {
        name: candidate.name,
        from: candidate.from,
        localPath: null,
        team: options.fallbackTeam,
        teamFrom: 'assumed',
        outcome: 'copied',
        message: ''
      };
      const part = join(staging, `${i}.part`);
      try {
        await pipeline(await candidate.open(), createWriteStream(part));
        const fromPath = teamFromPath(candidate.pathText);
        const fromLog = fromPath === null && searchedExtensions.has(extensionOf(candidate.name)) ? await teamInFile(part) : null;
        if (fromPath !== null) Object.assign(result, { team: fromPath, teamFrom: 'path' });
        else if (fromLog !== null) Object.assign(result, { team: fromLog, teamFrom: 'log' });
        staged.push({ candidate, result, part });
      } catch (error) {
        Object.assign(result, { outcome: 'error', message: (error as Error).message });
      }
      if (result.outcome === 'error') staged.push({ candidate, result, part: '' });
      progress.filesDone += 1;
      progress.bytesDone += candidate.size;
      options.onProgress({ ...progress });
    }

    // 2. Hoot logs that didn't say: by a CANivore known here or in this
    // import, then by another Hoot log of the same start (a robot's rio and
    // CANivore logs start together).
    const hoots = staged.filter((s) => s.part && extensionOf(s.candidate.name) === '.hoot');
    for (const { candidate, result } of hoots) {
      if (result.teamFrom !== 'assumed') canivores.set(hootBus(candidate.name), `frc${result.team}`);
    }
    for (const { candidate, result } of hoots) {
      const known = result.teamFrom === 'assumed' ? /^frc(\d+)$/.exec(canivores.get(hootBus(candidate.name)) ?? '') : null;
      if (known) Object.assign(result, { team: Number(known[1]), teamFrom: 'canivore' });
    }
    for (const { candidate, result } of hoots) {
      if (result.teamFrom !== 'assumed') continue;
      const start = hootStartTime(candidate.name)?.getTime();
      const partner = start === undefined ? undefined : hoots.find((other) => {
        const otherStart = hootStartTime(other.candidate.name)?.getTime();
        return other.result.teamFrom !== 'assumed' && otherStart !== undefined && Math.abs(otherStart - start) <= sameStartMs;
      });
      if (partner) Object.assign(result, { team: partner.result.team, teamFrom: 'hoot-partner' });
    }

    // 3. Each to where it goes.
    for (const { candidate, result, part } of staged) {
      if (!part) {
        options.onFile?.(result);
        continue;
      }
      try {
        const source = sources[extensionOf(candidate.name)];
        const robot = `frc${result.team}`;
        const localPath = logPathSegments(robot, recordedTime(candidate, now), source, candidate.name).join('/');
        const target = join(dataDirectory, ...localPath.split('/'));
        const size = (await fs.stat(part)).size;
        const there = await fs.stat(target).catch(() => null);
        result.localPath = localPath;
        if (there && there.size === size) {
          result.outcome = 'already-here';
        } else if (there) {
          result.outcome = 'conflict';
          result.message = 'A different file by this name is already there; left as it was.';
          options.onFile?.(result);
          continue;
        } else {
          await fs.mkdir(dirname(target), { recursive: true });
          await fs.rename(part, target);
        }
        index.files[indexKey('import', candidate.from, localPath)] = {
          robot,
          source,
          origin: 'import',
          originPath: candidate.from,
          size,
          modified: candidate.modified.toISOString(),
          localPath,
          offloadedAt: new Date().toISOString(),
          match: parseLogName(candidate.name).match
        };
      } catch (error) {
        Object.assign(result, { outcome: 'error', message: (error as Error).message });
      }
      options.onFile?.(result);
    }
    await storeIndex(dataDirectory, index);
    return { files: staged.map((s) => s.result), problems };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
