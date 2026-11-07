import { createWriteStream, promises as fs } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { isUnnamedLog, parseLogName, type OffloadedFile, type OffloadProgress, type RobotLogLocation } from '@shared/offload';
import { logPathSegments } from '@shared/storage-layout';
import { indexKey, loadIndex, storeIndex, type OffloadIndex } from './offload-index';
import type { FileReader, FoundFile } from './readers';

// One place to offload from: the robot, or a folder on this computer.
export interface OffloadJob {
  // What the progress bar calls it.
  label: string;
  reader: FileReader;
  origin: OffloadedFile['origin'];
  robot: string;
  // Pulled in this order.
  locations: RobotLogLocation[];
  // Files recorded before this are left where they are. Null for all.
  since: Date | null;
}

export interface OffloadResult {
  copied: number;
  skipped: number;
  tooOld: number;
  bytes: number;
  errors: string[];
  // Files pulled again because they'd changed on the robot since (a log
  // still being written, that grew): their reports are run again.
  changed: string[];
}

// How many files are pulled at once. Each file from the robot already keeps
// many reads in flight (see SftpReader), so this mostly saves the round
// trips spent opening and closing many small files.
const parallelFiles = 4;

// The index is written at most this often while files are coming in, and
// once at the end. Rewriting it after every file got slow with hundreds of
// files. If the app stops in between, the next run finds the files on disk
// by size, and restarts any download it can't tell was in progress.
const indexWriteIntervalMs = 1000;

// A robot that hasn't been told the time by a Driver Station thinks it's
// 1970 or so; a file time from before this is no use for filing.
const earliestBelievableTime = Date.UTC(2020, 0, 1);

function recordedTime(file: FoundFile, now: Date): Date {
  const named = parseLogName(file.name).recorded;
  if (named) return named;
  return file.modified.getTime() >= earliestBelievableTime ? file.modified : now;
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await fs.stat(path)).size;
  } catch {
    return null;
  }
}

// Counts the bytes going past, for the progress bar.
function counter(onBytes: (count: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      onBytes(chunk.length);
      callback(null, chunk);
    }
  });
}

// Writes the index now and then rather than on every change.
function indexWriter(dataDirectory: string, index: OffloadIndex) {
  let dirty = false;
  let lastWrite = 0;
  let writing: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    writing = writing
      .catch(() => {})
      .then(async () => {
        if (!dirty) return;
        dirty = false;
        lastWrite = Date.now();
        await storeIndex(dataDirectory, index);
      });
    return writing;
  };

  return {
    changed() {
      dirty = true;
      // A failed write here shows up in the final flush.
      if (Date.now() - lastWrite >= indexWriteIntervalMs) flush().catch(() => {});
    },
    flush
  };
}

interface Download {
  file: FoundFile;
  location: RobotLogLocation;
  localPath: string;
  key: string;
  // The location's place in the job's order: earlier ones are pulled first.
  order: number;
  // It was here already, and has changed since.
  replaces?: boolean;
}

// The index of what's been pulled, and its writer, shared by jobs that run
// at once (the robot and Driver Station logs) so neither writes over the
// other's entries.
export interface IndexStore {
  index: OffloadIndex;
  writer: ReturnType<typeof indexWriter>;
}

export async function openIndexStore(dataDirectory: string): Promise<IndexStore> {
  const index = await loadIndex(dataDirectory);
  return { index, writer: indexWriter(dataDirectory, index) };
}

// How deep a file is below `root`: 0 for a file in it.
function depthBelow(root: string, path: string): number {
  return path.slice(root.length).split(/[\\/]/).filter(Boolean).length - 1;
}

// Pulls every log from the job's locations that isn't already in the data
// folder, several at once, starting as soon as the first are found: folders
// are listed (several at once) while files are pulled, rather than every
// folder first. A file is pulled again if it has changed size or time since
// (a log that was still being written). A download that is cut off carries
// on from where it stopped next time, if the file hasn't changed.
export async function offloadLogs(
  dataDirectory: string,
  job: OffloadJob,
  onProgress: (progress: OffloadProgress) => void,
  now = new Date(),
  store?: IndexStore
): Promise<OffloadResult> {
  const result: OffloadResult = { copied: 0, skipped: 0, tooOld: 0, bytes: 0, errors: [], changed: [] };
  const own = !store;
  const { index, writer } = store ?? (await openIndexStore(dataDirectory));
  const absolute = (localPath: string) => join(dataDirectory, ...localPath.split('/'));

  const record = ({ file, location, localPath, key }: Download) => {
    index.files[key] = {
      robot: job.robot,
      source: location.source,
      origin: job.origin,
      originPath: file.path,
      size: file.size,
      modified: file.modified.toISOString(),
      localPath,
      offloadedAt: new Date().toISOString(),
      match: parseLogName(file.name).match
    };
    writer.changed();
  };

  const progress: OffloadProgress = {
    label: job.label,
    searching: true,
    foldersListed: 0,
    filesFound: 0,
    filesDone: 0,
    filesTotal: 0,
    bytesDone: 0,
    bytesTotal: 0,
    active: []
  };
  const report = () => onProgress({ ...progress, active: [...progress.active] });
  report();

  // --- What to pull, as it's found ---

  // Pulled in the job's location order, newest first within each, among
  // what's been found so far: the match that just finished is the one wanted
  // soonest, and data logs shouldn't wait behind Hoot logs.
  const queue: Download[] = [];
  let searching = true;
  let waiting: (() => void)[] = [];
  const wake = () => {
    const ready = waiting;
    waiting = [];
    for (const resolve of ready) resolve();
  };
  const enqueue = (download: Download) => {
    const at = queue.findIndex((other) => other.order > download.order ||
      (other.order === download.order && other.file.modified.getTime() < download.file.modified.getTime()));
    queue.splice(at === -1 ? queue.length : at, 0, download);
    progress.filesTotal += 1;
    progress.bytesTotal += download.file.size;
  };
  // The next file to pull, waiting for the search if there's none yet; null
  // once the search is over and nothing is left.
  const take = async (): Promise<Download | null> => {
    for (;;) {
      if (queue.length > 0) return queue.shift()!;
      if (!searching) return null;
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
  };

  // Each folder once, for every location that lists it (the logs folders
  // hold data logs and Hoot logs both), and a file goes with the first
  // location, in the job's order, that wants it.
  const roots = new Map<string, { extensions: Set<string>; depth: number }>();
  for (const location of job.locations) {
    for (const directory of location.directories) {
      const root = roots.get(directory) ?? { extensions: new Set<string>(), depth: 0 };
      for (const extension of location.extensions) root.extensions.add(extension);
      root.depth = Math.max(root.depth, location.depth);
      roots.set(directory, root);
    }
  }
  const locationOf = (root: string, file: FoundFile) => {
    const extension = extname(file.name).toLowerCase();
    const depth = depthBelow(root, file.path);
    for (const [order, location] of job.locations.entries()) {
      if (location.directories.includes(root) && location.extensions.includes(extension) && depth <= location.depth) return { location, order };
    }
    return null;
  };

  const claimed = new Set<string>();
  const handle = async (root: string, files: FoundFile[]) => {
    progress.foldersListed += 1;
    const candidates: Download[] = [];
    for (const file of files) {
      if (isUnnamedLog(file.name)) continue;
      const where = locationOf(root, file);
      if (!where) continue;
      progress.filesFound += 1;
      // A file that changes over days (the robot program log) gets a copy per
      // day, each with its own entry in the index.
      const recorded = recordedTime(file, now);
      if (job.since && recorded < job.since) {
        result.tooOld += 1;
        continue;
      }
      const localPath = logPathSegments(job.robot, recorded, where.location.source, file.name).join('/');
      if (claimed.has(localPath)) {
        // Two files with the same name, from the same day and source. Pulled
        // at once they'd write over each other.
        result.errors.push(`${file.path}: another file has the same name; not pulled.`);
        continue;
      }
      claimed.add(localPath);
      candidates.push({ file, location: where.location, localPath, key: indexKey(job.origin, file.path, localPath), order: where.order });
    }

    // What isn't here yet. Every file's size on disk at once.
    const onDisk = await Promise.all(candidates.map((download) => sizeOf(absolute(download.localPath))));
    candidates.forEach((download, i) => {
      const known = index.files[download.key];
      if (onDisk[i] === download.file.size && (!known || (known.size === download.file.size && known.modified === download.file.modified.toISOString()))) {
        // Already here. Without an index entry (a lost index), it's taken to
        // be the same file, since logs never change once finished.
        if (!known) record(download);
        result.skipped += 1;
      } else {
        enqueue({ ...download, replaces: onDisk[i] !== null || !!known });
      }
    });
    report();
    wake();
  };

  let lostConnection = false;
  const search = (async () => {
    try {
      // /u is a link to the USB drive, so the same folder can be there twice.
      const directories = [...roots.keys()];
      const reals = await Promise.all(directories.map((directory) => job.reader.realpath(directory)));
      const seen = new Set<string>();
      const walks: Promise<void>[] = [];
      directories.forEach((directory, i) => {
        const real = reals[i];
        if (real === null || seen.has(real)) return;
        seen.add(real);
        const root = roots.get(directory)!;
        walks.push(job.reader.walk(directory, [...root.extensions], root.depth, (files) => handle(directory, files)));
      });
      await Promise.all(walks);
    } catch (error) {
      if (job.reader.connected) result.errors.push(`Looking for logs: ${(error as Error).message}`);
      else lostConnection = true;
    } finally {
      searching = false;
      progress.searching = false;
      report();
      wake();
    }
  })();

  // --- Pulling ---

  const pull = async (download: Download) => {
    const { file, key } = download;
    const target = absolute(download.localPath);
    const part = `${target}.part`;
    const modified = file.modified.toISOString();

    const partial = index.partials[key];
    let start = 0;
    if (partial && partial.size === file.size && partial.modified === modified) {
      start = Math.min((await sizeOf(part)) ?? 0, file.size);
    }
    index.partials[key] = { size: file.size, modified };
    writer.changed();
    await fs.mkdir(dirname(target), { recursive: true });

    // Bytes already in the .part file count as done.
    progress.bytesDone += start;
    report();

    if (start < file.size) {
      await pipeline(
        job.reader.read(file.path, start, file.size),
        counter((count) => {
          progress.bytesDone += count;
          result.bytes += count;
          report();
        }),
        createWriteStream(part, { flags: start > 0 ? 'a' : 'w' })
      );
    } else if (start === 0) {
      // An empty file.
      await fs.writeFile(part, '');
    }

    const written = await sizeOf(part);
    if (written !== file.size) throw new Error(`got ${written ?? 0} of ${file.size} bytes`);

    await fs.rename(part, target);
    // The robot's time for the file, not when it was pulled: logs with no time
    // in their name are ordered by it.
    await fs.utimes(target, file.modified, file.modified).catch(() => undefined);
    delete index.partials[key];
    record(download);
    result.copied += 1;
    if (download.replaces) result.changed.push(download.localPath);
  };

  // A few workers taking the next file as it's found, until the search is
  // over and nothing is left.
  const worker = async () => {
    for (;;) {
      const download = await take();
      if (!download) return;
      if (!job.reader.connected) {
        lostConnection = true;
        return;
      }
      progress.active.push(download.file.name);
      report();
      try {
        await pull(download);
      } catch (error) {
        // The partial download is kept, for the next run to finish.
        result.errors.push(`${download.file.path}: ${(error as Error).message}`);
      } finally {
        progress.active.splice(progress.active.indexOf(download.file.name), 1);
        progress.filesDone += 1;
        report();
      }
    }
  };
  await Promise.all([search, ...Array.from({ length: parallelFiles }, worker)]);

  if (lostConnection) result.errors.push('Lost the connection to the robot.');
  if (own) await writer.flush();
  return result;
}
