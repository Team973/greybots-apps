// CTRE's owlet tool, which reads Hoot logs. Its licence doesn't allow
// putting it in our installer, so each computer downloads it from CTRE's
// own index, once the person has accepted CTRE's licence (Settings). One
// build per compliancy: a Hoot log can only be read by the owlet of the
// compliancy it was written with.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import type { OwletStatus, OwletVersion } from '@shared/hoot';

const indexUrl = 'https://redist.ctr-electronics.com/index.json';

interface RedistIndex {
  JsonVersion: string;
  ChannelCompliancy: { Compliancy: number; Name: string }[];
  Tools: { Name: string; Items: { Version: string; Compliancy: number; Urls: Record<string, string> }[] }[];
}

// CTRE's name for this computer's build.
function platformKey(): string | null {
  const arch = process.arch;
  switch (process.platform) {
    case 'win32':
      return 'windowsx86-64';
    case 'darwin':
      return 'macosuniversal';
    case 'linux':
      return arch === 'arm64' ? 'linuxarm64' : arch === 'arm' ? 'linuxarm32' : 'linuxx86-64';
    default:
      return null;
  }
}

// owlet-<version>-C<compliancy>[.exe]
const fileNamePattern = /^owlet-(.+)-C(\d+)(\.exe)?$/;

export class Owlet {
  private downloading = false;
  private checkedAt: string | null = null;
  private error = '';
  // One owlet at a time: each one reads a whole Hoot log and is heavy.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private directory: string) {}

  async installed(): Promise<OwletVersion[]> {
    const names = await fs.readdir(this.directory).catch(() => [] as string[]);
    return names
      .map((name) => fileNamePattern.exec(name))
      .filter((found): found is RegExpExecArray => found !== null)
      .map((found) => ({ version: found[1], compliancy: Number(found[2]) }))
      .sort((a, b) => b.compliancy - a.compliancy);
  }

  async status(licenseAccepted: boolean): Promise<OwletStatus> {
    return { licenseAccepted, installed: await this.installed(), downloading: this.downloading, checkedAt: this.checkedAt, error: this.error };
  }

  // The owlet that reads `compliancy`, or null if it hasn't been downloaded.
  async pathFor(compliancy: number): Promise<string | null> {
    const names = await fs.readdir(this.directory).catch(() => [] as string[]);
    const name = names.find((n) => fileNamePattern.exec(n)?.[2] === String(compliancy));
    return name ? join(this.directory, name) : null;
  }

  // Gets the latest owlet for every stable compliancy, and for `needed`
  // ones even if they're betas, from CTRE. What's already here and
  // current is kept; a failed download leaves the old one in place.
  async download(needed: number[] = []): Promise<void> {
    if (this.downloading) return;
    const platform = platformKey();
    if (!platform) {
      this.error = "CTRE doesn't make owlet for this computer.";
      return;
    }
    this.downloading = true;
    this.error = '';
    try {
      await fs.mkdir(this.directory, { recursive: true });
      const response = await fetch(indexUrl);
      if (!response.ok) throw new Error(`CTRE's download index answered ${response.status}.`);
      const index = (await response.json()) as RedistIndex;
      if (index.JsonVersion !== '1.0.0.0') throw new Error("CTRE's download index has changed format.");
      const owlet = index.Tools.find((tool) => tool.Name === 'owlet');
      if (!owlet) throw new Error("CTRE's download index has no owlet.");

      for (const channel of index.ChannelCompliancy) {
        const prerelease = /alpha|beta/i.test(channel.Name);
        if (prerelease && !needed.includes(channel.Compliancy)) continue;
        const versions = owlet.Items.filter((item) => item.Compliancy === channel.Compliancy && item.Urls[platform]);
        versions.sort((a, b) => b.Version.localeCompare(a.Version, undefined, { numeric: true }));
        const latest = versions[0];
        if (!latest) continue;
        await this.fetchBuild(latest.Version, latest.Compliancy, latest.Urls[platform], latest.Urls[`${platform}-sha1`]);
      }
      this.checkedAt = new Date().toISOString();
    } catch (error) {
      this.error = `Couldn't get owlet from CTRE: ${(error as Error).message}`;
    } finally {
      this.downloading = false;
    }
  }

  private async fetchBuild(version: string, compliancy: number, url: string, sha1: string | undefined) {
    const suffix = process.platform === 'win32' ? '.exe' : '';
    const name = `owlet-${version}-C${compliancy}${suffix}`;
    const target = join(this.directory, name);
    const sha1Of = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex');

    const existing = await fs.readFile(target).catch(() => null);
    if (existing && (!sha1 || sha1Of(existing) === sha1)) return;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`owlet ${version} answered ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (sha1 && sha1Of(bytes) !== sha1) throw new Error(`owlet ${version} didn't match CTRE's checksum.`);

    await fs.writeFile(`${target}.tmp`, bytes, { mode: 0o755 });
    await fs.rename(`${target}.tmp`, target);
    // Older builds for the same compliancy go.
    for (const other of await fs.readdir(this.directory)) {
      const found = fileNamePattern.exec(other);
      if (found && found[2] === String(compliancy) && other !== name) await fs.unlink(join(this.directory, other)).catch(() => {});
    }
  }

  // Runs owlet; resolves to what it printed. `onProgress` gets its percent.
  run(owletPath: string, args: string[], onProgress?: (percent: number) => void): Promise<string> {
    const job = this.queue.then(
      () =>
        new Promise<string>((resolve, reject) => {
          const child = spawn(owletPath, args, { windowsHide: true });
          let output = '';
          child.stdout.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            output += text;
            // Progress: [ 45%] [####......]
            const percents = [...text.matchAll(/Progress: \[\s*(\d+)%\]/g)];
            if (onProgress && percents.length) onProgress(Number(percents[percents.length - 1][1]));
          });
          child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
          child.once('error', reject);
          child.once('close', (code) => {
            if (code === 0) resolve(output);
            else reject(new Error(lastLine(output) || `owlet stopped with code ${code}.`));
          });
        })
    );
    this.queue = job.catch(() => {});
    return job;
  }
}

function lastLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.replace(/Progress: .*/, '').trim()).filter(Boolean).pop() ?? '';
}

// A Hoot log says which compliancy wrote it in its byte 70.
export async function hootCompliancy(path: string): Promise<number> {
  const file = await fs.open(path, 'r');
  try {
    const buffer = Buffer.alloc(1);
    const { bytesRead } = await file.read(buffer, 0, 1, 70);
    if (bytesRead !== 1) throw new Error("This Hoot log is too short to say what wrote it.");
    return buffer[0];
  } finally {
    await file.close();
  }
}
