import { createWriteStream, promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { isUnnamedLog, parseLogName, type OffloadedFile, type OffloadProgress, type RobotLogLocation } from '@shared/offload';
import { logPathSegments } from '@shared/storage-layout';
import { indexKey, loadIndex, storeIndex } from './offload-index';
import type { FileReader, FoundFile } from './readers';

// One place to offload from: the robot, or a folder on this computer.
export interface OffloadJob {
  reader: FileReader;
  origin: OffloadedFile['origin'];
  robot: string;
  locations: RobotLogLocation[];
}

export interface OffloadResult {
  copied: number;
  skipped: number;
  bytes: number;
  errors: string[];
}

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

// Pulls every log from the job's locations that isn't already in the data
// folder. A file is pulled again if it has changed size or time since (a log
// that was still being written). A download that is cut off
// carries on from where it stopped next time, if the file hasn't changed.
export async function offloadLogs(
  dataDirectory: string,
  job: OffloadJob,
  onProgress: (progress: OffloadProgress) => void,
  now = new Date()
): Promise<OffloadResult> {
  const result: OffloadResult = { copied: 0, skipped: 0, bytes: 0, errors: [] };
  const index = await loadIndex(dataDirectory);
  const absolute = (localPath: string) => join(dataDirectory, ...localPath.split('/'));

  for (const location of job.locations) {
    // /u is a link to the USB drive, so the same folder can be listed twice.
    const seen = new Set<string>();
    const files: FoundFile[] = [];
    for (const directory of location.directories) {
      const real = await job.reader.realpath(directory);
      if (real === null || seen.has(real)) continue;
      seen.add(real);
      const found = await job.reader.find(directory, location.extensions, location.depth);
      files.push(...found.filter((file) => !isUnnamedLog(file.name)));
    }
    // Newest first: the match that just finished is the one wanted soonest.
    files.sort((a, b) => b.modified.getTime() - a.modified.getTime());

    for (const file of files) {
      if (!job.reader.connected) {
        result.errors.push('Lost the connection to the robot.');
        return result;
      }

      // A file that changes over days (the robot program log) gets a copy
      // per day, each with its own entry in the index.
      const localPath = logPathSegments(job.robot, recordedTime(file, now), location.source, file.name).join('/');
      const target = absolute(localPath);
      const key = indexKey(job.origin, file.path, localPath);
      const modified = file.modified.toISOString();
      const known = index.files[key];

      const record = () => {
        index.files[key] = {
          robot: job.robot,
          source: location.source,
          origin: job.origin,
          originPath: file.path,
          size: file.size,
          modified,
          localPath,
          offloadedAt: new Date().toISOString(),
          match: parseLogName(file.name).match
        };
      };

      const onDisk = await sizeOf(target);
      if (onDisk === file.size && (!known || (known.size === file.size && known.modified === modified))) {
        // Already here. Without an index entry (a lost index), it's taken
        // to be the same file, since logs never change once finished.
        if (!known) {
          record();
          await storeIndex(dataDirectory, index);
        }
        result.skipped += 1;
        continue;
      }

      try {
        const part = `${target}.part`;
        const partial = index.partials[key];
        let start = 0;
        if (partial && partial.size === file.size && partial.modified === modified) {
          start = Math.min((await sizeOf(part)) ?? 0, file.size);
        }

        index.partials[key] = { size: file.size, modified };
        await storeIndex(dataDirectory, index);
        await fs.mkdir(dirname(target), { recursive: true });

        let done = start;
        const progress = () => onProgress({ label: location.label, file: file.name, bytesDone: done, bytesTotal: file.size });
        progress();

        if (start < file.size) {
          await pipeline(
            job.reader.read(file.path, start, file.size),
            counter((count) => {
              done += count;
              result.bytes += count;
              progress();
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
        record();
        await storeIndex(dataDirectory, index);
        result.copied += 1;
      } catch (error) {
        // The partial download is kept, for the next run to finish.
        result.errors.push(`${file.path}: ${(error as Error).message}`);
      }
    }
  }
  return result;
}
