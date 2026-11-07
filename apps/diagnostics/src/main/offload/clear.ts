// Clearing logs off the robot (#139): only logs this app has just downloaded,
// only once someone has said so twice, and never one that may still be being
// written. Logs pile up on the roboRIO (and its USB drive) over an event;
// these are the ones safely on this laptop.
//
// A log is left on the robot when:
// - it's still named FRC_TBD_ (a data log not yet named for its match), or
//   isn't a match log (the robot program's own .log is always open);
// - it's the newest log in its folder, or changed within `recentMs` of the
//   newest anything on the robot (the robot's clock may be unset, so its
//   own latest file stands for "now"): either may still be open. A Hoot
//   session is a folder of logs written together: there the newest session
//   is kept whole, rather than the newest file in each (which would leave a
//   file in every old session for good);
// - it has changed on the robot since it was downloaded, or is gone;
// - the copy here is missing or a different size.
// Hoot logs are in a folder per session: one left empty is removed too.

import { posix } from 'node:path';

import { isUnnamedLog } from '@shared/offload';

// What clearing needs from the robot: SftpReader has these.
export interface RobotFiles {
  // A folder's entries, or null if it isn't there.
  list(folder: string): Promise<RobotEntry[] | null>;
  remove(path: string): Promise<void>;
  removeFolder(path: string): Promise<void>;
}

export interface RobotEntry {
  name: string;
  folder: boolean;
  size: number;
  modified: Date;
}

// A file just downloaded from the robot, as it was then.
export interface ClearCandidate {
  path: string;
  name: string;
  size: number;
  // ISO time, as the robot had it.
  modified: string;
  // Where the copy is, below the data folder.
  localPath: string;
}

export interface ClearKept {
  name: string;
  reason: string;
}

export interface ClearOutcome {
  deleted: string[];
  kept: ClearKept[];
  foldersRemoved: string[];
  errors: string[];
}

// Logs only: data logs and Hoot logs.
export const clearableExtensions = ['.wpilog', '.hoot'];
// A log changed this recently may still be being written.
export const recentMs = 5 * 60 * 1000;

const isLog = (name: string) => clearableExtensions.includes(posix.extname(name).toLowerCase());

// Which of the candidates can go, and why the rest stay. Lists each folder
// they're in once, and the robot's log folders (`roots`), to know the newest.
export async function planClear(
  candidates: ClearCandidate[],
  robot: RobotFiles,
  localSize: (localPath: string) => Promise<number | null>,
  roots: string[]
): Promise<{ remove: ClearCandidate[]; kept: ClearKept[] }> {
  const folders = [...new Set([...roots, ...candidates.map((c) => posix.dirname(c.path))])];
  const listings = new Map<string, RobotEntry[] | null>();
  await Promise.all(folders.map(async (folder) => listings.set(folder, await robot.list(folder))));
  // The robot's "now": its newest log anywhere looked at.
  let robotNow = 0;
  for (const entries of listings.values()) {
    for (const entry of entries ?? []) if (!entry.folder && isLog(entry.name)) robotNow = Math.max(robotNow, entry.modified.getTime());
  }

  // Below a log folder, a file's folder is a session: its newest log, and
  // the newest of any session beside it (each listed once).
  const isRoot = (folder: string) => roots.includes(folder);
  const newestIn = (entries: RobotEntry[] | null | undefined) =>
    Math.max(-Infinity, ...(entries ?? []).filter((e) => !e.folder && isLog(e.name)).map((e) => e.modified.getTime()));
  const newestSession = new Map<string, number>();
  for (const parent of new Set(candidates.map((c) => posix.dirname(c.path)).filter((f) => !isRoot(f)).map((f) => posix.dirname(f)))) {
    if (!listings.has(parent)) listings.set(parent, await robot.list(parent));
    const sessions = (listings.get(parent) ?? []).filter((e) => e.folder).map((e) => posix.join(parent, e.name));
    await Promise.all(sessions.filter((f) => !listings.has(f)).map(async (f) => listings.set(f, await robot.list(f))));
    newestSession.set(parent, Math.max(-Infinity, ...sessions.map((f) => newestIn(listings.get(f)))));
  }

  const remove: ClearCandidate[] = [];
  const kept: ClearKept[] = [];
  const keep = (c: ClearCandidate, reason: string) => kept.push({ name: c.name, reason });
  for (const c of candidates) {
    if (isUnnamedLog(c.name) || /^FRC_TBD_/i.test(c.name)) {
      keep(c, 'not named for its match yet (FRC_TBD_): may still be being written');
      continue;
    }
    if (!isLog(c.name)) {
      keep(c, 'not a match log');
      continue;
    }
    const entries = listings.get(posix.dirname(c.path)) ?? null;
    const entry = entries?.find((e) => !e.folder && e.name === c.name) ?? null;
    if (!entry) {
      keep(c, 'no longer on the robot');
      continue;
    }
    if (entry.size !== c.size || entry.modified.toISOString() !== c.modified) {
      keep(c, 'changed on the robot since it was downloaded: may still be being written');
      continue;
    }
    const folder = posix.dirname(c.path);
    if (isRoot(folder)) {
      if (entry.modified.getTime() >= newestIn(entries)) {
        keep(c, 'the newest log in its folder: may still be being written');
        continue;
      }
    } else if (newestIn(entries) >= (newestSession.get(posix.dirname(folder)) ?? Infinity)) {
      keep(c, 'in the newest Hoot session: may still be being written');
      continue;
    }
    if (robotNow - entry.modified.getTime() < recentMs) {
      keep(c, 'changed in the last 5 minutes: may still be being written');
      continue;
    }
    if ((await localSize(c.localPath)) !== c.size) {
      keep(c, 'the copy on this laptop is missing or a different size');
      continue;
    }
    remove.push(c);
  }
  return { remove, kept };
}

// Deletes what planClear allows, then any folder that leaves empty (a Hoot
// session's), up to but not including the log folders themselves.
export async function clearLogs(
  candidates: ClearCandidate[],
  robot: RobotFiles,
  localSize: (localPath: string) => Promise<number | null>,
  roots: string[]
): Promise<ClearOutcome> {
  const outcome: ClearOutcome = { deleted: [], kept: [], foldersRemoved: [], errors: [] };
  const { remove, kept } = await planClear(candidates, robot, localSize, roots);
  outcome.kept = kept;
  const emptied = new Set<string>();
  for (const c of remove) {
    try {
      await robot.remove(c.path);
      outcome.deleted.push(c.name);
      emptied.add(posix.dirname(c.path));
    } catch (error) {
      outcome.errors.push(`${c.name}: ${(error as Error).message}`);
    }
  }
  const isRoot = (folder: string) => roots.includes(folder) || !roots.some((root) => folder.startsWith(`${root}/`));
  // Deepest first, so a folder emptied by removing one below it goes too.
  const waiting = [...emptied].sort((a, b) => b.length - a.length);
  while (waiting.length) {
    const folder = waiting.shift()!;
    if (isRoot(folder)) continue;
    const entries = await robot.list(folder);
    if (!entries || entries.length > 0) continue;
    try {
      await robot.removeFolder(folder);
      outcome.foldersRemoved.push(folder);
      const parent = posix.dirname(folder);
      if (!waiting.includes(parent)) waiting.push(parent);
    } catch (error) {
      outcome.errors.push(`${folder}: ${(error as Error).message}`);
    }
  }
  return outcome;
}
