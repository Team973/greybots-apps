// Downloading logs: files are pulled while folders are still being listed,
// each folder is listed once, what's here already (or too old) is skipped,
// and finding the robot doesn't wait on addresses that don't answer.

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { Readable } from 'node:stream';
import { findRobot } from '@main/offload/find-robot';
import { offloadLogs, type OffloadJob } from '@main/offload/offload';
import type { FileReader, FoundFile, OnFiles } from '@main/offload/readers';
import { robotLogLocations, type OffloadProgress } from '@shared/offload';
import { defaultSettings } from '@shared/settings';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A robot in memory: folders, and files of `size` bytes. Each listing takes
// `listMs`, one folder at a time, so a test can tell what happened when.
class FakeRobot implements FileReader {
  connected = true;
  listed: string[] = [];
  lastListingAt = 0;
  firstReadAt = 0;
  reads = 0;
  // Drops the connection after this many reads.
  dropAfter = Infinity;

  constructor(private folders: Record<string, { folders?: string[]; files?: { name: string; size: number; modified: string }[] }>,
    private links: Record<string, string> = {}, private listMs = 25) {}

  async walk(directory: string, extensions: string[], depth: number, onFiles: OnFiles): Promise<void> {
    const waiting = [{ folder: directory, depth }];
    while (waiting.length) {
      const { folder, depth: left } = waiting.shift()!;
      await sleep(this.listMs);
      if (!this.connected) throw new Error('not connected');
      this.listed.push(folder);
      this.lastListingAt = performance.now();
      const here = this.folders[folder] ?? {};
      if (left > 0) waiting.push(...(here.folders ?? []).map((name) => ({ folder: posix.join(folder, name), depth: left - 1 })));
      const files: FoundFile[] = (here.files ?? [])
        .filter((file) => extensions.includes(posix.extname(file.name).toLowerCase()))
        .map((file) => ({ path: posix.join(folder, file.name), name: file.name, size: file.size, modified: new Date(file.modified) }));
      await onFiles(files);
    }
  }

  async realpath(directory: string): Promise<string | null> {
    if (this.links[directory]) return this.links[directory];
    return this.folders[directory] ? directory : null;
  }

  read(path: string, start: number, end: number): Readable {
    this.reads += 1;
    if (!this.firstReadAt) this.firstReadAt = performance.now();
    if (this.reads > this.dropAfter) this.connected = false;
    return Readable.from([Buffer.alloc(end - start, 7)]);
  }

  close() {}
}

const day = '2026-11-07T03:10:00.000Z';
const tree = () => ({
  '/home/lvuser': { folders: ['logs'], files: [{ name: 'FRC_UserProgram.log', size: 5, modified: day }] },
  '/home/lvuser/logs': {
    folders: ['s1', 's2', 's3'],
    files: [
      { name: 'FRC_20261107_030907_mttd_P5.wpilog', size: 100, modified: day },
      { name: 'FRC_20261107_011228.wpilog', size: 50, modified: '2026-11-07T01:30:00.000Z' },
      { name: 'FRC_TBD_123.wpilog', size: 9, modified: day }
    ]
  },
  '/home/lvuser/logs/s1': { files: [{ name: 'mttd_P5_rio_2026-11-07_03-08-40.hoot', size: 300, modified: day }] },
  '/home/lvuser/logs/s2': { files: [{ name: 'rio_2026-11-07_01-12-26.hoot', size: 200, modified: '2026-11-07T01:30:00.000Z' }] },
  '/home/lvuser/logs/s3': { files: [{ name: 'notes.txt', size: 1, modified: day }] }
});

async function main() {
  const directory = await fs.mkdtemp(join(tmpdir(), 'diagnostics-offload-'));
  try {
    const job = (reader: FileReader, since: Date | null = null): OffloadJob =>
      ({ label: 'From the robot', reader, origin: 'robot', robot: 'frc973', locations: robotLogLocations, since });
    const now = new Date('2026-11-07T04:00:00Z');

    // --- Pulled as found ---
    // /u/logs is a link to the logs folder: listed once, not twice.
    const robot = new FakeRobot(tree(), { '/u/logs': '/home/lvuser/logs' });
    const seen: OffloadProgress[] = [];
    const first = await offloadLogs(directory, job(robot), (progress) => seen.push(progress), now);
    assert.deepEqual(first.errors, []);
    // Two data logs, the program log and two Hoot logs; FRC_TBD_ and .txt aren't pulled.
    assert.equal(first.copied, 5);
    assert.equal(first.bytes, 100 + 50 + 5 + 300 + 200);
    // Each folder listed once (the logs folders hold data logs and Hoot logs both).
    assert.equal(robot.listed.filter((f) => f === '/home/lvuser/logs').length, 1);
    assert.ok(!robot.listed.includes('/u/logs'));
    assert.equal(new Set(robot.listed).size, robot.listed.length);
    // The first file was being pulled before the last folder was listed.
    assert.ok(robot.firstReadAt > 0 && robot.firstReadAt < robot.lastListingAt, 'pulling started while still listing');
    // Progress said it was searching, then that it was done, with growing totals.
    assert.ok(seen.some((p) => p.searching && p.filesTotal > 0));
    const last = seen[seen.length - 1];
    assert.equal(last.searching, false);
    assert.equal(last.filesDone, 5);
    assert.equal(last.filesFound, 5);
    // The files are where they belong, at their full size.
    const wpilog = join(directory, 'logs', 'frc973');
    assert.ok((await fs.readdir(wpilog, { recursive: true })).some((p) => String(p).endsWith('FRC_20261107_030907_mttd_P5.wpilog')));

    // --- Already here ---
    const again = await offloadLogs(directory, job(new FakeRobot(tree(), { '/u/logs': '/home/lvuser/logs' })), () => {}, now);
    assert.equal(again.copied, 0);
    assert.equal(again.skipped, 5);

    // --- A log that grew since: pulled again, and named as changed ---
    const grown = tree();
    grown['/home/lvuser/logs'].files[0] = { ...grown['/home/lvuser/logs'].files[0], size: 160, modified: '2026-11-07T03:20:00.000Z' };
    const regrown = await offloadLogs(directory, job(new FakeRobot(grown, { '/u/logs': '/home/lvuser/logs' })), () => {}, now);
    assert.equal(regrown.copied, 1);
    assert.equal(regrown.changed.length, 1);
    assert.ok(regrown.changed[0].endsWith('FRC_20261107_030907_mttd_P5.wpilog'));
    assert.deepEqual(first.changed, [], 'nothing was here before the first run');

    // --- Too old ---
    const old = await offloadLogs(directory, job(new FakeRobot(tree()), new Date('2026-12-01T00:00:00Z')), () => {}, now);
    assert.equal(old.copied, 0);
    assert.equal(old.tooOld, 5);

    // --- Two files with the same name, day and kind ---
    const twins = tree();
    twins['/home/lvuser/logs/s3'] = { files: [{ name: 'rio_2026-11-07_01-12-26.hoot', size: 200, modified: '2026-11-07T01:30:00.000Z' }] };
    const fresh = await fs.mkdtemp(join(tmpdir(), 'diagnostics-offload-'));
    try {
      const result = await offloadLogs(fresh, job(new FakeRobot(twins)), () => {}, now);
      assert.equal(result.errors.filter((e) => e.includes('another file has the same name')).length, 1);
      assert.equal(result.copied, 5);
    } finally {
      await fs.rm(fresh, { recursive: true, force: true });
    }

    // --- Losing the robot part way ---
    const dropped = await fs.mkdtemp(join(tmpdir(), 'diagnostics-offload-'));
    try {
      const flaky = new FakeRobot(tree());
      flaky.dropAfter = 1;
      const result = await offloadLogs(dropped, job(flaky), () => {}, now);
      assert.ok(result.errors.includes('Lost the connection to the robot.'), result.errors.join('; '));
      assert.ok(result.copied < 5);
    } finally {
      await fs.rm(dropped, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }

  // --- Finding the robot ---
  const answers = (times: Record<string, [number, boolean]>) => async (host: string) => {
    const [ms, open] = times[host] ?? [0, false];
    await sleep(ms);
    return open;
  };
  const team = { ...defaultSettings, teamNumber: 973, addressMode: 'team' as const, mdnsEnabled: true };
  // On USB: no waiting for the radio's address to time out.
  let started = performance.now();
  assert.equal(await findRobot(team, answers({ '10.9.73.2': [1500, false], 'roboRIO-973-FRC.local': [1500, false], '172.22.11.2': [5, true] })), '172.22.11.2');
  assert.ok(performance.now() - started < 500, 'USB answer came without waiting');
  // USB is preferred when both answer.
  assert.equal(await findRobot(team, answers({ '10.9.73.2': [1, true], '172.22.11.2': [20, true] })), '172.22.11.2');
  // Over the radio: the first address, in order, that answers.
  assert.equal(await findRobot(team, answers({ '10.9.73.2': [10, true], 'roboRIO-973-FRC.local': [5, true] })), '10.9.73.2');
  started = performance.now();
  assert.equal(await findRobot(team, answers({})), null);
  // A manual address is the only one tried.
  assert.equal(await findRobot({ ...team, addressMode: 'manual', manualAddress: '10.0.0.5' }, answers({ '10.0.0.5': [1, true], '172.22.11.2': [1, true] })), '10.0.0.5');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
