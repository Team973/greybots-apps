// Logs to and from USB drives: which logs a filter picks, copying them to a
// drive (again only adds what's new), and importing them from the drive on
// another computer files each one where it was.

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importLogs } from '@main/import/importer';
import { copyLogsToDrive, estimateFileBytes, exportFolderIn } from '@main/usb/copy-to-drive';
import { addSeen, loadSeen, seenKey, storedKey, storedLogs } from '@main/usb/seen';
import type { SignalLogFile } from '@shared/ipc';
import { parseLogName } from '@shared/offload';
import { logPathSegments } from '@shared/storage-layout';
import type { ImportedFile, ImportSummary } from '@shared/import';
import { defaultUsbExportFilter, filesOfLogs, logsToExport, mergeExported, usbExportFolder, usbImportCounts } from '@shared/usb';

const now = new Date('2026-11-07T20:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

function log(id: string, recorded: string, match: SignalLogFile['match'], extra: Partial<SignalLogFile> = {}): SignalLogFile {
  return { id, localPath: id, name: id, robot: 'frc973', size: 10, recorded, match, hoots: [], dsLogs: [], ...extra };
}

const logs = [
  log('q4', daysAgo(1), { event: 'MTTD', type: 'qualification', number: 4 }),
  log('p2', daysAgo(1), { event: 'mttd', type: 'practice', number: 2 }),
  log('e1', daysAgo(30), { event: 'CAVEN', type: 'elimination', number: 1 }),
  log('pit', daysAgo(2), null)
];
const ids = (picked: SignalLogFile[]) => picked.map((l) => l.id);

// --- Which logs ---

assert.deepEqual(ids(logsToExport(logs, defaultUsbExportFilter, now)), ['q4', 'p2', 'e1', 'pit'], 'no filter: everything');
assert.deepEqual(ids(logsToExport(logs, { ...defaultUsbExportFilter, event: 'MtTd' }, now)), ['q4', 'p2'], 'an event, any case; not-a-match logs aren\'t from it');
assert.deepEqual(ids(logsToExport(logs, { ...defaultUsbExportFilter, kinds: ['qualification', 'elimination'] }, now)), ['q4', 'e1'], 'match types');
assert.deepEqual(ids(logsToExport(logs, { ...defaultUsbExportFilter, kinds: ['none'] }, now)), ['pit'], 'only runs that aren\'t matches');
assert.deepEqual(ids(logsToExport(logs, { ...defaultUsbExportFilter, days: 7 }, now)), ['q4', 'p2', 'pit'], 'the last 7 days');
assert.deepEqual(ids(logsToExport(logs, { ...defaultUsbExportFilter, kinds: [] }, now)), [], 'no kinds ticked: nothing');

// A session's files, a shared Driver Station log once.
const ds = { localPath: 'logs/frc973/d/driver-station/a.dslog', eventsPath: 'logs/frc973/d/driver-station/a.dsevents', name: 'a.dslog', label: 'DS log', size: 1 };
const withFiles = [
  log('logs/x.wpilog', daysAgo(1), null, { hoots: [{ localPath: 'logs/x.hoot', name: 'x.hoot', bus: 'rio', label: 'rio', size: 1 }], dsLogs: [ds] }),
  log('ds-only', daysAgo(1), null, { localPath: null, dsLogs: [{ ...ds, eventsPath: null }] })
];
assert.deepEqual(filesOfLogs(withFiles), ['logs/x.wpilog', 'logs/x.hoot', ds.localPath, ds.eventsPath]);

assert.equal(exportFolderIn(join('E:', 'stuff')), join('E:', 'stuff', usbExportFolder));
assert.equal(exportFolderIn(join('E:', usbExportFolder)), join('E:', usbExportFolder), 'the export folder itself picked');

// Recently exported: newest first, each file once per place it went.
{
  const at = (path: string, to = 'E:', when = '2026-11-08T10:00:00Z') => ({ localPath: path, size: 1, at: when, destination: to });
  const before = [at('logs/a.wpilog'), at('logs/b.wpilog'), at('logs/a.wpilog', 'F:')];
  const after = mergeExported(before, [at('logs/b.wpilog', 'E:', '2026-11-08T11:00:00Z'), at('logs/c.wpilog')]);
  assert.deepEqual(after.map((f) => `${f.destination}${f.localPath}`), ['E:logs/b.wpilog', 'E:logs/c.wpilog', 'E:logs/a.wpilog', 'F:logs/a.wpilog']);
  assert.equal(after[0].at, '2026-11-08T11:00:00Z', 'copied again: the newer time');
  assert.equal(mergeExported(before, [at('logs/d.wpilog')], 2).length, 2, 'only the newest kept');
}

// A drive's import as counts: loaded, skipped (here already, before or found so), failed.
{
  const file = (outcome: ImportedFile['outcome']) => ({ outcome }) as ImportedFile;
  const summary = { files: [file('copied'), file('copied'), file('already-here'), file('error'), file('conflict')] } as ImportSummary;
  assert.deepEqual(usbImportCounts(summary, 3), { loaded: 2, skipped: 4, failed: 2 });
}

// --- Copying to a drive, and importing from it elsewhere ---

async function copyAndImport() {
  const root = await fs.mkdtemp(join(tmpdir(), 'diagnostics-usb-'));
  try {
    const here = join(root, 'here');
    const drive = join(root, 'drive');
    const there = join(root, 'there');
    await fs.mkdir(drive);

    // Logs as an offload files them here.
    const wpilog = 'FRC_20261107_164852_MTTD_Q4.wpilog';
    const hoot = 'MTTD_Q4_rio_2026-11-07_16-48-50.hoot';
    const recorded = parseLogName(wpilog).recorded!;
    const files = [
      { path: logPathSegments('frc973', recorded, 'roborio', wpilog).join('/'), body: 'wpilog bytes' },
      { path: logPathSegments('frc973', recorded, 'ctre-hoot', hoot).join('/'), body: 'hoot bytes, a few more' }
    ];
    const oldTime = new Date('2026-11-07T16:50:00Z');
    for (const file of files) {
      const at = join(here, ...file.path.split('/'));
      await fs.mkdir(join(at, '..'), { recursive: true });
      await fs.writeFile(at, file.body);
      await fs.utimes(at, oldTime, oldTime);
    }

    const copied: string[] = [];
    const first = await copyLogsToDrive(here, [...files.map((f) => f.path), 'logs/gone.wpilog'], drive, () => {}, (path) => copied.push(path));
    assert.equal(first.copied, 2);
    assert.equal(first.skipped, 0);
    assert.deepEqual(first.failed.map((f) => f.path), ['logs/gone.wpilog'], 'a file no longer here is said, not fatal');
    assert.equal(first.problem, '');
    assert.deepEqual(copied, files.map((f) => `${usbExportFolder}/${f.path}`), 'paths below the drive, for remembering');
    const onDrive = join(drive, usbExportFolder, ...files[0].path.split('/'));
    assert.equal(await fs.readFile(onDrive, 'utf-8'), files[0].body);
    assert.equal((await fs.stat(onDrive)).mtime.getTime(), oldTime.getTime(), 'keeps its last-changed time');
    await fs.access(join(drive, usbExportFolder, 'README.txt'));

    const again = await copyLogsToDrive(here, files.map((f) => f.path), drive, () => {});
    assert.equal(again.copied, 0, 'copying again adds nothing');
    assert.equal(again.skipped, 2);

    // Another computer imports the drive's files one by one, as the drive
    // watcher does: the team comes from the folders above them on the drive.
    const found = files.map((f) => join(drive, usbExportFolder, ...f.path.split('/')));
    const imported = await importLogs(there, found, { fallbackTeam: 254, onProgress: () => {}, pathBase: drive });
    assert.deepEqual(imported.files.map((f) => [f.outcome, f.team, f.teamFrom]), [['copied', 973, 'path'], ['copied', 973, 'path']]);
    assert.deepEqual(imported.files.map((f) => f.localPath), files.map((f) => f.path), 'filed where it was');

    // Without the drive's root, a single file has no team in its path.
    const alone = await importLogs(join(root, 'alone'), [found[1]], { fallbackTeam: 254, onProgress: () => {} });
    assert.equal(alone.files[0].teamFrom, 'assumed');

    // Logs already in storage, by name and size wherever they're filed:
    // what a drive's import skips.
    const stored = await storedLogs(there);
    assert.ok(stored.has(storedKey(wpilog, files[0].body.length)), 'a log here');
    assert.ok(stored.has(storedKey(wpilog.toUpperCase(), files[0].body.length)), 'any case');
    assert.ok(!stored.has(storedKey(wpilog, files[0].body.length + 1)), 'a different size is a different log');
    assert.equal((await storedLogs(join(root, 'nowhere'))).size, 0);

    // What was seen on drives is remembered.
    await addSeen(there, [seenKey('A\\b.wpilog', 5), seenKey('c.hoot', 6)]);
    await addSeen(there, [seenKey('c.hoot', 6)]);
    assert.deepEqual([...(await loadSeen(there))].sort(), ['A/b.wpilog|5', 'c.hoot|6']);
    assert.equal((await loadSeen(join(root, 'nowhere'))).size, 0);

    // A big file comes through whole, and the progress only goes up and
    // ends true.
    const big = 'logs/frc973/2026-11-07/ctre-hoot/big.hoot';
    // Bytes that say where they belong, so one in the wrong place is caught.
    const size = 37 * 1024 * 1024 + 5;
    const bytes = Buffer.alloc(size);
    for (let i = 0; i < size; i += 4) bytes.writeUInt32LE(i, Math.min(i, size - 4));
    await fs.mkdir(join(here, 'logs', 'frc973', '2026-11-07', 'ctre-hoot'), { recursive: true });
    await fs.writeFile(join(here, ...big.split('/')), bytes);
    const seen: { done: number; copied: number; since: string | null }[] = [];
    const bigCopy = await copyLogsToDrive(here, [big], join(root, 'drive2'), (progress) => {
      seen.push({ done: progress.bytesDone, copied: progress.bytesCopied, since: progress.copyingSince });
    });
    assert.equal(bigCopy.copied, 1);
    const done = seen.map((s) => s.done);
    assert.deepEqual(done, [...done].sort((x, y) => x - y), 'only goes up');
    assert.deepEqual(seen.at(-1), { done: size, copied: size, since: seen.at(-1)!.since }, 'ends at the whole file, measured');
    assert.ok(seen.at(-1)!.since, 'when copying started');
    assert.ok((await fs.readFile(join(root, 'drive2', usbExportFolder, ...big.split('/')))).equals(bytes), 'every byte where it belongs');

    // Part way through a file, at the speed so far: never past (nearly) its
    // end, so it doesn't look done before it is.
    assert.equal(estimateFileBytes(500, 10_000_000, 100_000_000), 5_000_000);
    assert.equal(estimateFileBytes(60_000, 10_000_000, 100_000_000), 99_000_000);
    assert.equal(estimateFileBytes(-5, 10_000_000, 100), 0);

    // Cancelled part way through a file: it's stopped and its part removed,
    // the files done stay, and the rest aren't started.
    {
      const cancel = new AbortController();
      const started: string[] = [];
      const result = await copyLogsToDrive(here, files.map((f) => f.path), join(root, 'drive3'), () => {}, () => {}, {
        signal: cancel.signal,
        copyFile: async (from, to) => {
          started.push(to);
          if (started.length === 1) return fs.copyFile(from, to);
          // The second: half written, then stopped by the cancel.
          await fs.writeFile(to, 'half');
          await new Promise<void>((_, reject) => {
            cancel.signal.addEventListener('abort', () => reject(new Error('The copy was stopped.')));
            cancel.abort();
          });
        }
      });
      assert.equal(result.cancelled, true);
      assert.equal(result.copied, 1, 'the first file done');
      assert.deepEqual(result.failed, [], 'a cancel is not a failure');
      assert.equal(result.problem, '');
      await fs.access(join(root, 'drive3', usbExportFolder, ...files[0].path.split('/')));
      await assert.rejects(fs.access(started[1]), 'the part removed');
      await assert.rejects(fs.access(started[1].replace(/.part$/, '')), 'and not put in place');
    }

    // Cancelled before it starts: nothing copied.
    {
      const cancel = new AbortController();
      cancel.abort();
      const result = await copyLogsToDrive(here, files.map((f) => f.path), join(root, 'drive4'), () => {}, () => {}, { signal: cancel.signal });
      assert.equal(result.cancelled, true);
      assert.equal(result.copied, 0);
    }

    // An empty log is copied too.
    const empty = 'logs/frc973/2026-11-07/ctre-hoot/empty.hoot';
    await fs.writeFile(join(here, ...empty.split('/')), '');
    assert.equal((await copyLogsToDrive(here, [empty], join(root, 'drive2'), () => {})).copied, 1);
    assert.equal((await fs.stat(join(root, 'drive2', usbExportFolder, ...empty.split('/')))).size, 0);

    // A drive that's gone: said, not thrown.
    const gone = await copyLogsToDrive(here, files.map((f) => f.path), join(root, 'drive', 'missing', '\u0000bad'), () => {});
    assert.notEqual(gone.problem, '');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }

}

copyAndImport().then(() => console.log('usb: ok')).catch((error) => {
  console.error(error);
  process.exit(1);
});
