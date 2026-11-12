// Downloading logs: files are pulled while folders are still being listed,
// each folder is listed once, what's here already (or too old) is skipped,
// and finding the robot doesn't wait on addresses that don't answer.

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { Readable } from 'node:stream';
import { clearLogs, recentMs, type ClearCandidate, type RobotEntry, type RobotFiles } from '@main/offload/clear';
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
    // Each, as it was on the robot: what may be cleared off it afterwards.
    assert.equal(first.pulled.length, 5);
    assert.ok(first.pulled.every((f) => f.path.startsWith('/home/lvuser/') && f.localPath.startsWith('logs/frc973/')));
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
    const io: { op: string; outcome: string; path?: string; message?: string }[] = [];
    const again = await offloadLogs(directory, { ...job(new FakeRobot(tree(), { '/u/logs': '/home/lvuser/logs' })), onIo: (e) => io.push(e) }, () => {}, now);
    assert.equal(again.copied, 0);
    assert.equal(again.skipped, 5);
    // Each one in the transfer log, and why it was skipped.
    assert.equal(io.filter((e) => e.outcome === 'skip' && e.message?.startsWith('already here')).length, 5);

    // --- A log that grew since: pulled again, and named as changed ---
    const grown = tree();
    grown['/home/lvuser/logs'].files[0] = { ...grown['/home/lvuser/logs'].files[0], size: 160, modified: '2026-11-07T03:20:00.000Z' };
    const grownIo: { op: string; outcome: string; path?: string; bytes?: number; message?: string }[] = [];
    const regrown = await offloadLogs(directory, { ...job(new FakeRobot(grown, { '/u/logs': '/home/lvuser/logs' })), onIo: (e) => grownIo.push(e) }, () => {}, now);
    assert.equal(regrown.copied, 1);
    const pulledIo = grownIo.filter((e) => e.outcome === 'ok');
    assert.equal(pulledIo.length, 1);
    assert.equal(pulledIo[0].bytes, 160);
    assert.ok(pulledIo[0].message?.includes('again: it changed'));
    assert.equal(regrown.changed.length, 1);
    assert.ok(regrown.changed[0].endsWith('FRC_20261107_030907_mttd_P5.wpilog'));
    assert.deepEqual(first.changed, [], 'nothing was here before the first run');
    assert.equal(first.interrupted, false);

    // --- Newest first, whatever kind; each match's files announced once all here ---
    {
      const matchesDir = await fs.mkdtemp(join(tmpdir(), 'diagnostics-offload-'));
      try {
        const at = (time: string) => `2026-11-07T${time}:00.000Z`;
        const robotTree = {
          '/home/lvuser/logs': {
            files: [
              { name: 'FRC_20261107_010000_mttd_Q2.wpilog', size: 10, modified: at('01:05') },
              { name: 'mttd_Q2_rio_2026-11-07_01-00-01.hoot', size: 10, modified: at('01:05') },
              { name: 'FRC_20261107_030000_mttd_Q10.wpilog', size: 10, modified: at('03:05') },
              { name: 'mttd_Q10_rio_2026-11-07_03-00-01.hoot', size: 10, modified: at('03:05') },
              { name: 'FRC_20261107_032000_mttd_Q11.wpilog', size: 10, modified: at('03:25') },
              // Named by the roboRIO's unset clock, written during Q11.
              { name: 'rio_2024-12-18_14-02-24.hoot', size: 10, modified: at('03:25') }
            ]
          }
        };
        const reader = new FakeRobot(robotTree);
        const done: { match: string; files: number; matches: number }[] = [];
        // The order files were taken to be pulled.
        const taken: string[] = [];
        const result = await offloadLogs(matchesDir, {
          ...job(reader),
          onMatchDone: ({ match, localPaths, matches }) => done.push({ match: `${match.type[0].toUpperCase()}${match.number}`, files: localPaths.length, matches })
        }, (progress) => { for (const file of progress.active) if (!taken.includes(file)) taken.push(file); }, now);
        assert.deepEqual(result.errors, []);
        assert.deepEqual(taken.slice(0, 2).sort(), ['FRC_20261107_032000_mttd_Q11.wpilog', 'rio_2024-12-18_14-02-24.hoot'], 'the newest match first');
        assert.ok(taken.indexOf('FRC_20261107_030000_mttd_Q10.wpilog') < taken.indexOf('FRC_20261107_010000_mttd_Q2.wpilog'));
        assert.ok(taken.indexOf('mttd_Q10_rio_2026-11-07_03-00-01.hoot') < taken.indexOf('FRC_20261107_010000_mttd_Q2.wpilog'), 'Hoot logs do not wait behind older data logs');
        assert.deepEqual(done.map((d) => d.match).sort(), ['Q10', 'Q11', 'Q2']);
        assert.ok(done.every((d) => d.matches === 3));
        assert.deepEqual(done.find((d) => d.match === 'Q10')!.files, 2);
      } finally {
        await fs.rm(matchesDir, { recursive: true, force: true });
      }
    }

    // A match isn't announced while the robot's gone part way.
    {
      const cutDir = await fs.mkdtemp(join(tmpdir(), 'diagnostics-offload-'));
      try {
        const reader = new FakeRobot(tree());
        reader.dropAfter = 1;
        const done: string[] = [];
        await offloadLogs(cutDir, { ...job(reader), onMatchDone: ({ match }) => done.push(String(match.number)) }, () => {}, now);
        assert.deepEqual(done, []);
      } finally {
        await fs.rm(cutDir, { recursive: true, force: true });
      }
    }

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
      assert.equal(result.interrupted, true, 'said once, as an interruption');
      assert.equal(result.errors.filter((e) => e !== 'Lost the connection to the robot.').length, 0, 'not an error a file');
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

// --- Clearing downloaded logs off the robot (#139) ---

// A robot's files in memory, for clearing: folders of files, and what was
// deleted.
class FakeFiles implements RobotFiles {
  removed: string[] = [];
  foldersRemoved: string[] = [];
  constructor(public tree: Record<string, RobotEntry[]>) {}
  async list(folder: string) {
    return this.tree[folder] ? this.tree[folder].map((e) => ({ ...e })) : null;
  }
  async remove(path: string) {
    const folder = posix.dirname(path);
    this.tree[folder] = this.tree[folder].filter((e) => e.name !== posix.basename(path));
    this.removed.push(path);
  }
  async removeFolder(path: string) {
    if (this.tree[path]?.length) throw new Error('not empty');
    delete this.tree[path];
    const parent = posix.dirname(path);
    this.tree[parent] = this.tree[parent].filter((e) => e.name !== posix.basename(path));
    this.foldersRemoved.push(path);
  }
}

async function clearing() {
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 7, 4, 0) + minutes * 60_000);
  const file = (name: string, size: number, minutes: number): RobotEntry => ({ name, folder: false, size, modified: at(minutes) });
  const folder = (name: string): RobotEntry => ({ name, folder: true, size: 0, modified: at(0) });
  const L = '/home/lvuser/logs';
  const robot = new FakeFiles({
    [L]: [
      file('FRC_20261107_030000_mttd_Q1.wpilog', 100, 0),
      file('FRC_20261107_031000_mttd_Q2.wpilog', 100, 10),
      file('FRC_20261107_032000_mttd_Q3.wpilog', 100, 20),
      // Changed within 5 minutes of the newest (the robot's "now").
      file('FRC_20261107_033400_mttd_Q4.wpilog', 100, 37),
      // The newest: may still be open.
      file('FRC_20261107_034000_mttd_Q5.wpilog', 100, 40),
      file('FRC_TBD_123.wpilog', 100, 5),
      folder('session-a'),
      folder('session-b')
    ],
    [`${L}/session-a`]: [file('rio.hoot', 300, 1), file('canivore.hoot', 300, 1)],
    [`${L}/session-b`]: [file('rio.hoot', 300, 30), file('rio-2.hoot', 300, 40)]
  });
  const candidate = (path: string, size: number, minutes: number): ClearCandidate =>
    ({ path, name: posix.basename(path), size, modified: at(minutes).toISOString(), localPath: `logs/frc973/${posix.basename(path)}` });
  const candidates = [
    candidate(`${L}/FRC_20261107_030000_mttd_Q1.wpilog`, 100, 0),
    // It grew since it was downloaded.
    candidate(`${L}/FRC_20261107_031000_mttd_Q2.wpilog`, 90, 9),
    candidate(`${L}/FRC_20261107_032000_mttd_Q3.wpilog`, 100, 20),
    candidate(`${L}/FRC_20261107_033400_mttd_Q4.wpilog`, 100, 37),
    candidate(`${L}/FRC_20261107_034000_mttd_Q5.wpilog`, 100, 40),
    candidate(`${L}/FRC_TBD_123.wpilog`, 100, 5),
    candidate(`${L}/session-a/rio.hoot`, 300, 1),
    candidate(`${L}/session-a/canivore.hoot`, 300, 1),
    candidate(`${L}/session-b/rio.hoot`, 300, 30),
    // Gone from the robot already.
    candidate(`${L}/FRC_20261107_020000_mttd_P1.wpilog`, 100, -60)
  ];
  // The copies here: Q3's is short (a failed copy).
  const local = async (localPath: string) => (localPath.endsWith('Q3.wpilog') ? 50 : candidates.find((c) => c.localPath === localPath)!.size);

  const outcome = await clearLogs(candidates, robot, local, ['/home/lvuser/logs', '/u/logs']);
  assert.deepEqual(outcome.errors, []);
  // Q1, and the older Hoot session whole.
  assert.deepEqual(outcome.deleted.sort(), ['FRC_20261107_030000_mttd_Q1.wpilog', 'canivore.hoot', 'rio.hoot']);
  const why = Object.fromEntries(outcome.kept.map((k) => [k.name, k.reason]));
  assert.match(why['FRC_20261107_031000_mttd_Q2.wpilog'], /changed on the robot/);
  assert.match(why['FRC_20261107_032000_mttd_Q3.wpilog'], /copy on this laptop/);
  assert.match(why['FRC_20261107_033400_mttd_Q4.wpilog'], /last 5 minutes/);
  assert.match(why['FRC_20261107_034000_mttd_Q5.wpilog'], /newest log in its folder/);
  assert.match(why['FRC_TBD_123.wpilog'], /FRC_TBD_/);
  assert.match(why['FRC_20261107_020000_mttd_P1.wpilog'], /no longer on the robot/);
  // session-b is the newest session: kept whole, even its older log.
  assert.match(why['rio.hoot'], /newest Hoot session/);
  assert.deepEqual(robot.tree[`${L}/session-b`].map((e) => e.name), ['rio.hoot', 'rio-2.hoot']);
  // session-a was left empty: removed. The logs folder itself never is.
  assert.deepEqual(robot.foldersRemoved, [`${L}/session-a`]);
  assert.ok(robot.tree[L]);
  assert.equal(recentMs, 5 * 60 * 1000);

  // Nothing asked for, nothing deleted; and nothing else is ever touched.
  const untouched = new FakeFiles({ [L]: [file('FRC_20261107_030000_mttd_Q1.wpilog', 100, 0), file('FRC_20261107_031000_mttd_Q2.wpilog', 100, 10)] });
  assert.deepEqual((await clearLogs([], untouched, local, [L])).deleted, []);
  assert.equal(untouched.tree[L].length, 2);
}

main().then(clearing).catch((error) => {
  console.error(error);
  process.exit(1);
});
