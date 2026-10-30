import { createReadStream, promises as fs } from 'node:fs';
import { extname, join, posix } from 'node:path';
import type { Readable } from 'node:stream';
import { Client, type FileEntryWithStats, type SFTPWrapper } from 'ssh2';

import { robotSshUser } from '@shared/offload';

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
  // below it. A folder that isn't there has no files.
  find(directory: string, extensions: string[], depth: number): Promise<FoundFile[]>;
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

const sshTimeoutMs = 5000;

export class SftpReader implements FileReader {
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

  async find(directory: string, extensions: string[], depth: number): Promise<FoundFile[]> {
    let entries;
    try {
      entries = await this.readdir(directory);
    } catch (error) {
      if (!this.connected) throw error;
      return [];
    }

    const found: FoundFile[] = [];
    for (const entry of entries) {
      const path = posix.join(directory, entry.filename);
      if (entry.attrs.isDirectory()) {
        if (depth > 0) found.push(...(await this.find(path, extensions, depth - 1)));
      } else if (entry.attrs.isFile() && matches(entry.filename, extensions)) {
        found.push({ path, name: entry.filename, size: entry.attrs.size, modified: new Date(entry.attrs.mtime * 1000) });
      }
    }
    return found;
  }

  realpath(directory: string): Promise<string | null> {
    return new Promise((resolve) => this.sftp.realpath(directory, (error, path) => resolve(error ? null : path)));
  }

  read(path: string, start: number, end: number): Readable {
    // ssh2's `end` is inclusive.
    return this.sftp.createReadStream(path, { start, end: end - 1 });
  }

  close() {
    this.client.end();
  }
}

export class LocalReader implements FileReader {
  readonly connected = true;

  async find(directory: string, extensions: string[], depth: number): Promise<FoundFile[]> {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }

    const found: FoundFile[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) found.push(...(await this.find(path, extensions, depth - 1)));
      } else if (entry.isFile() && matches(entry.name, extensions)) {
        const stat = await fs.stat(path);
        found.push({ path, name: entry.name, size: stat.size, modified: stat.mtime });
      }
    }
    return found;
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
