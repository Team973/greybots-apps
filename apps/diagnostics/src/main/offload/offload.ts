import { createWriteStream, promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
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
}

// Pulls every log from the job's locations that isn't already in the data
// folder, several at once. A file is pulled again if it has changed size or
// time since (a log that was still being written). A download that is cut
// off carries on from where it stopped next time, if the file hasn't changed.
export async function offloadLogs(
  dataDirectory: string,
  job: OffloadJob,
  onProgress: (progress: OffloadProgress) => void,
  now = new Date()
): Promise<OffloadResult> {
  const result: OffloadResult = { copied: 0, skipped: 0, tooOld: 0, bytes: 0, errors: [] };
  const index = await loadIndex(dataDirectory);
  const writer = indexWriter(dataDirectory, index);
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

  // Everything there is, by location in the job's order, then newest first:
  // the match that just finished is the one wanted soonest.
  const found: { file: FoundFile; location: RobotLogLocation; order: number }[] = [];
  for (const [order, location] of job.locations.entries()) {
    // /u is a link to the USB drive, so the same folder can be listed twice.
    const seen = new Set<string>();
    for (const directory of location.directories) {
      const real = await job.reader.realpath(directory);
      if (real === null || seen.has(real)) continue;
      seen.add(real);
      for (const file of await job.reader.find(directory, location.extensions, location.depth)) {
        if (!isUnnamedLog(file.name)) found.push({ file, location, order });
      }
    }
  }
  found.sort((a, b) => a.order - b.order || b.file.modified.getTime() - a.file.modified.getTime());

  // What isn't here yet.
  const downloads: Download[] = [];
  const claimed = new Set<string>();
  for (const { file, location } of found) {
    // A file that changes over days (the robot program log) gets a copy per
    // day, each with its own entry in the index.
    const recorded = recordedTime(file, now);
    if (job.since && recorded < job.since) {
      result.tooOld += 1;
      continue;
    }
    const localPath = logPathSegments(job.robot, recorded, location.source, file.name).join('/');
    const download = { file, location, localPath, key: indexKey(job.origin, file.path, localPath) };
    const known = index.files[download.key];

    if (claimed.has(localPath)) {
      // Two files with the same name, from the same day and source. Pulled
      // at once they'd write over each other.
      result.errors.push(`${file.path}: another file has the same name; not pulled.`);
      continue;
    }
    claimed.add(localPath);

    const onDisk = await sizeOf(absolute(localPath));
    if (onDisk === file.size && (!known || (known.size === file.size && known.modified === file.modified.toISOString()))) {
      // Already here. Without an index entry (a lost index), it's taken to
      // be the same file, since logs never change once finished.
      if (!known) record(download);
      result.skipped += 1;
    } else {
      downloads.push(download);
    }
  }

  const progress: OffloadProgress = {
    label: job.label,
    filesDone: 0,
    filesTotal: downloads.length,
    bytesDone: 0,
    bytesTotal: downloads.reduce((total, { file }) => total + file.size, 0),
    active: []
  };
  const report = () => onProgress({ ...progress, active: [...progress.active] });
  report();

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
    delete index.partials[key];
    record(download);
    result.copied += 1;
  };

  // A few workers taking the next file off the list until it's empty.
  let next = 0;
  let lostConnection = false;
  const worker = async () => {
    while (next < downloads.length) {
      if (!job.reader.connected) {
        lostConnection = true;
        return;
      }
      const download = downloads[next++];
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
  await Promise.all(Array.from({ length: parallelFiles }, worker));

  if (lostConnection) result.errors.push('Lost the connection to the robot.');
  await writer.flush();
  return result;
}
