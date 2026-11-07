import { createReadStream, promises as fs } from 'node:fs';
import { extname, join, posix } from 'node:path';
import { Readable } from 'node:stream';
import { Client, type FileEntryWithStats, type SFTPWrapper } from 'ssh2';

import { robotSshUser } from '@shared/offload';
import type { RobotEntry, RobotFiles } from './clear';

export interface FoundFile {
  path: string;
  name: string;
  size: number;
  modified: Date;
}

// What the offload needs from wherever the files are: the robot over SFTP,
// or a folder on this computer. Kept this small so the offload logic doesn't
// know which it has.
export interface FileReader {
  // Files with one of `extensions`, in `directory` or up to `depth` folders
  // below it, handed to `onFiles` a folder at a time as each is listed
  // (several are listed at once), so they can be pulled while the rest are
  // still being listed. A folder that isn't there has no files. Resolves
  // once every folder is listed and handled.
  walk(directory: string, extensions: string[], depth: number, onFiles: OnFiles): Promise<void>;
  // The folder's real path, links followed, or null if it isn't there.
  realpath(directory: string): Promise<string | null>;
  // The bytes from `start` up to (not including) `end`.
  read(path: string, start: number, end: number): Readable;
  // False once the connection has dropped, when nothing more will work.
  readonly connected: boolean;
  close(): void;
}

function matches(name: string, extensions: string[]): boolean {
  return extensions.includes(extname(name).toLowerCase());
}

// A folder's files (and how many folders have been listed), as listed.
export type OnFiles = (files: FoundFile[]) => void | Promise<void>;

// One folder's contents: the folders in it and the files wanted.
interface Listing {
  folders: string[];
  files: FoundFile[];
}

// How many folders are listed at once. Over SFTP each listing is a round
// trip to the robot; one at a time, a robot with a folder per Hoot session
// spent seconds just listing.
const listingsInFlight = 6;

// Lists `root` and the folders below it, `depth` levels down, several at
// once, handing each folder's files on as it's listed.
function walkTree(root: string, depth: number, list: (folder: string) => Promise<Listing>, onFiles: OnFiles): Promise<void> {
  return new Promise((resolve, reject) => {
    const waiting: { folder: string; depth: number }[] = [{ folder: root, depth }];
    let running = 0;
    let failed = false;
    const pump = () => {
      if (failed) return;
      if (waiting.length === 0 && running === 0) {
        resolve();
        return;
      }
      while (running < listingsInFlight && waiting.length > 0) {
        const next = waiting.shift()!;
        running += 1;
        list(next.folder)
          .then(async ({ folders, files }) => {
            if (next.depth > 0) waiting.push(...folders.map((folder) => ({ folder, depth: next.depth - 1 })));
            await onFiles(files);
          })
          .then(() => {
            running -= 1;
            pump();
          }, (error) => {
            failed = true;
            reject(error);
          });
      }
    };
    pump();
  });
}

const sshTimeoutMs = 5000;

// What ssh2's fastGet uses: 32 KB reads (fits one SFTP packet on any
// server), many at a time.
const sftpChunkBytes = 32 * 1024;
const sftpReadsInFlight = 32;

export class SftpReader implements FileReader, RobotFiles {
  connected = true;

  private constructor(private client: Client, private sftp: SFTPWrapper) {
    client.on('close', () => { this.connected = false; });
  }

  static connect(host: string, port = 22): Promise<SftpReader> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      client.once('error', reject);
      // The roboRIO has no password; depending on its image it asks for one
      // either way, or by keyboard-interactive.
      client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => finish(prompts.map(() => '')));
      client.once('ready', () => {
        client.sftp((error, sftp) => {
          if (error) {
            client.end();
            reject(error);
            return;
          }
          client.removeListener('error', reject);
          // Errors after this point show up as failed reads and `connected`.
          client.on('error', () => { /* handled through close */ });
          resolve(new SftpReader(client, sftp));
        });
      });
      client.connect({ host, port, username: robotSshUser, password: '', tryKeyboard: true, readyTimeout: sshTimeoutMs });
    });
  }

  private readdir(directory: string): Promise<FileEntryWithStats[]> {
    return new Promise((resolve, reject) => {
      this.sftp.readdir(directory, (error, list) => (error ? reject(error) : resolve(list)));
    });
  }

  walk(directory: string, extensions: string[], depth: number, onFiles: OnFiles): Promise<void> {
    return walkTree(directory, depth, async (folder) => {
      let entries;
      try {
        entries = await this.readdir(folder);
      } catch (error) {
        if (!this.connected) throw error;
        return { folders: [], files: [] };
      }
      const listing: Listing = { folders: [], files: [] };
      for (const entry of entries) {
        const path = posix.join(folder, entry.filename);
        if (entry.attrs.isDirectory()) listing.folders.push(path);
        else if (entry.attrs.isFile() && matches(entry.filename, extensions)) {
          // The listing has each file's size and time: no call per file.
          listing.files.push({ path, name: entry.filename, size: entry.attrs.size, modified: new Date(entry.attrs.mtime * 1000) });
        }
      }
      return listing;
    }, onFiles);
  }

  realpath(directory: string): Promise<string | null> {
    return new Promise((resolve) => this.sftp.realpath(directory, (error, path) => resolve(error ? null : path)));
  }

  // --- Clearing logs (clear.ts): only ever asked for after a download, and
  // only for what was downloaded ---

  async list(folder: string): Promise<RobotEntry[] | null> {
    try {
      const entries = await this.readdir(folder);
      return entries.map((entry) => ({
        name: entry.filename,
        folder: entry.attrs.isDirectory(),
        size: entry.attrs.size,
        modified: new Date(entry.attrs.mtime * 1000)
      }));
    } catch (error) {
      if (!this.connected) throw error;
      return null;
    }
  }

  remove(path: string): Promise<void> {
    return new Promise((resolve, reject) => this.sftp.unlink(path, (error) => (error ? reject(error) : resolve())));
  }

  removeFolder(path: string): Promise<void> {
    return new Promise((resolve, reject) => this.sftp.rmdir(path, (error) => (error ? reject(error) : resolve())));
  }

  // ssh2's own read stream asks for one chunk at a time and waits for it, so
  // every 32 KB costs a round trip to the robot, which is slow over the
  // radio. This keeps many reads in flight, like ssh2's fastGet, and hands
  // the chunks on in order.
  read(path: string, start: number, end: number): Readable {
    const sftp = this.sftp;
    const call = <T>(fn: (cb: (error: Error | null | undefined, value: T) => void) => void) =>
      new Promise<T>((resolve, reject) => fn((error, value) => (error ? reject(error) : resolve(value))));

    // Reads `length` bytes at `offset`. A server may send fewer than asked;
    // the rest is asked for again.
    const readAt = async (handle: Buffer, offset: number, length: number): Promise<Buffer> => {
      // Not zeroed: every byte is written before it's used.
      const buffer = Buffer.allocUnsafe(length);
      let got = 0;
      while (got < length) {
        const count = await call<number>((cb) =>
          sftp.read(handle, buffer, got, length - got, offset + got, (error, bytesRead) => cb(error, bytesRead))
        );
        if (count === 0) throw new Error('the file is shorter than it was');
        got += count;
      }
      return buffer;
    };

    async function* chunks() {
      const handle = await call<Buffer>((cb) => sftp.open(path, 'r', cb));
      try {
        const pending: Promise<Buffer>[] = [];
        let offset = start;
        while (offset < end || pending.length > 0) {
          while (pending.length < sftpReadsInFlight && offset < end) {
            const length = Math.min(sftpChunkBytes, end - offset);
            const read = readAt(handle, offset, length);
            // Awaited in order below; this only stops a failure further
            // along from being reported as unhandled if an earlier one ends
            // the download first.
            read.catch(() => {});
            pending.push(read);
            offset += length;
          }
          yield await pending.shift()!;
        }
      } finally {
        sftp.close(handle, () => {});
      }
    }

    return Readable.from(chunks(), { objectMode: false });
  }

  close() {
    this.client.end();
  }
}

export class LocalReader implements FileReader {
  readonly connected = true;

  walk(directory: string, extensions: string[], depth: number, onFiles: OnFiles): Promise<void> {
    return walkTree(directory, depth, async (folder) => {
      let entries;
      try {
        entries = await fs.readdir(folder, { withFileTypes: true });
      } catch {
        return { folders: [], files: [] };
      }
      const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => join(folder, entry.name));
      const wanted = entries.filter((entry) => entry.isFile() && matches(entry.name, extensions));
      // Every file's size and time at once, not one after another.
      const files = (await Promise.all(wanted.map(async (entry) => {
        const path = join(folder, entry.name);
        const stat = await fs.stat(path).catch(() => null);
        return stat ? { path, name: entry.name, size: stat.size, modified: stat.mtime } : null;
      }))).filter((file): file is FoundFile => file !== null);
      return { folders, files };
    }, onFiles);
  }

  realpath(directory: string): Promise<string | null> {
    return fs.realpath(directory).catch(() => null);
  }

  read(path: string, start: number, end: number): Readable {
    // Node's `end` is inclusive too.
    return createReadStream(path, { start, end: end - 1 });
  }

  close() {}
}
